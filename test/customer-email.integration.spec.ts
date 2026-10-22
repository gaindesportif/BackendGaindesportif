import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { SMTPServer } from 'smtp-server';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { configureApp } from '../src/bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { MailService } from '../src/mail/mail.service';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerManagementService } from '../src/customer/customer-management.service';
import { hashPassword } from '../src/admin/password';
const testUrl = process.env.DATABASE_TEST_URL;
const run = testUrl ? describe : describe.skip;
const password = 'local-mail-test-password-123';
run('E-mails clients : HTTP, PostgreSQL et véritable SMTP local', () => {
  let app: INestApplication,
    db: DatabaseService,
    mail: MailService,
    customers: CustomerService,
    management: CustomerManagementService,
    smtp: SMTPServer;
  const received: string[] = [];
  const ids: string[] = [];
  const admins: string[] = [];
  let rejected = false;
  const previous: Record<string, string | undefined> = {};
  beforeAll(async () => {
    const target = new URL(testUrl!);
    if (
      !['localhost', '127.0.0.1', '::1', 'postgres'].includes(target.hostname) ||
      !target.pathname.includes('test')
    )
      throw new Error('Base locale de test requise');
    const values: Record<string, string> = {
      NODE_ENV: 'test',
      DATABASE_URL: testUrl!,
      DIRECT_URL: testUrl!,
      MAIL_ENABLED: 'true',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      MAIL_FROM: 'sender@example.test',
      MAIL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      CUSTOMER_SITE_URL: 'http://localhost:3100',
    };
    for (const [key, value] of Object.entries(values)) {
      previous[key] = process.env[key];
      process.env[key] = value;
    }
    for (const key of ['SMTP_PASSWORD', 'SMTP_USER']) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['AUTH', 'STARTTLS'],
      logger: false,
      onData(stream, _session, callback) {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          if (rejected) {
            callback(new Error('temporary test rejection'));
            return;
          }
          received.push(
            Buffer.concat(chunks)
              .toString()
              .replace(/=\r?\n/g, '')
              .replace(/=3D/g, '='),
          );
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => smtp.listen(1025, '127.0.0.1', resolve));
    const { AppModule } = await import('../src/app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue(new DatabaseService(new ConfigService({ DATABASE_URL: testUrl })))
      .compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    mail = app.get(MailService);
    customers = app.get(CustomerService);
    management = app.get(CustomerManagementService);
  }, 30000);
  afterAll(async () => {
    if (db) {
      await db.customerAccount.deleteMany({ where: { id: { in: ids } } });
      await db.adminAccount.deleteMany({ where: { id: { in: admins } } });
    }
    await app?.close();
    if (smtp) await new Promise<void>((resolve) => smtp.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 30000);
  const create = async () => {
    const result = await customers.register({
      email: `email-${randomUUID()}@example.test`,
      displayName: 'Client recette locale',
      password,
      consent: true,
    });
    ids.push(result.user.id);
    return result;
  };
  const token = () => {
    const value = received.at(-1)?.match(/#token=([A-Za-z0-9_-]{43})/);
    if (!value) throw new Error('Lien local absent');
    return value[1];
  };
  it('expédie une confirmation chiffrée en file, sans exposer le jeton, puis confirme une seule fois', async () => {
    const account = await create();
    expect(account.verificationQueued).toBe(true);
    expect(account.user.emailVerifiedAt).toBeNull();
    const pending = await db.mailOutbox.findFirstOrThrow({ where: { accountId: account.user.id } });
    expect(pending.payload).not.toContain('token=');
    expect(pending.payload).not.toContain(account.user.email);
    await mail.verify();
    await Promise.all([mail.processPending(), mail.processPending()]);
    expect(received.at(-1)).toContain('/compte/confirmer-email#token=');
    const value = token();
    expect(JSON.stringify(account)).not.toContain(value);
    const stored = await db.customerEmailToken.findFirstOrThrow({
      where: { accountId: account.user.id },
    });
    expect(stored.tokenHash).toBe(createHash('sha256').update(value).digest('hex'));
    await request(app.getHttpServer())
      .post('/api/v1/customer/auth/verify')
      .send({ token: value })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/customer/auth/verify')
      .send({ token: value })
      .expect(400);
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: account.user.id } }))
        .emailVerifiedAt,
    ).not.toBeNull();
    expect(
      (await db.mailOutbox.findUniqueOrThrow({ where: { id: pending.id } })).payload,
    ).toBeNull();
  });
  it('oublie sans énumérer les comptes, limite les renvois, réinitialise et révoque toutes les sessions', async () => {
    const account = await create();
    await mail.processPending();
    expect(await customers.forgot('absent@example.test')).toEqual(
      await customers.forgot(account.user.email),
    );
    const count = await db.mailOutbox.count({
      where: { accountId: account.user.id, kind: 'reset_password' },
    });
    await customers.forgot(account.user.email);
    expect(
      await db.mailOutbox.count({ where: { accountId: account.user.id, kind: 'reset_password' } }),
    ).toBe(count);
    await mail.processPending();
    const value = token();
    expect(received.at(-1)).toContain('/compte/reinitialiser#token=');
    await request(app.getHttpServer())
      .post('/api/v1/customer/auth/reset')
      .send({ token: value, newPassword: 'another-local-password-456' })
      .expect(200);
    await expect(customers.authenticate(account.token)).rejects.toThrow();
    await expect(customers.resetPassword(value, password)).rejects.toThrow();
    await expect(
      customers.login(account.user.email, 'another-local-password-456'),
    ).resolves.toHaveProperty('token');
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: account.user.id } }))
        .emailVerifiedAt,
    ).not.toBeNull();
  });
  it('refuse liens expirés, mauvaise finalité et champs arbitraires sans modifier le mot de passe', async () => {
    const account = await create();
    await mail.processPending();
    const value = token();
    await expect(customers.resetPassword(value, password)).rejects.toThrow();
    await db.customerEmailToken.updateMany({
      where: { accountId: account.user.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(customers.verifyEmail(value)).rejects.toThrow();
    await request(app.getHttpServer())
      .post('/api/v1/customer/auth/reset')
      .send({ token: 'x'.repeat(43), newPassword: password, role: 'owner' })
      .expect(400);
    await expect(customers.login(account.user.email, password)).resolves.toHaveProperty('token');
  });
  it('remplace un lien précédent et invalide les liens de réinitialisation après changement du mot de passe', async () => {
    const account = await create();
    await customers.forgot(account.user.email);
    await mail.processPending();
    const first = token();
    await db.customerEmailToken.updateMany({
      where: { accountId: account.user.id, purpose: 'reset_password' },
      data: { createdAt: new Date(Date.now() - 120000) },
    });
    await customers.forgot(account.user.email);
    await mail.processPending();
    const second = token();
    expect(second).not.toBe(first);
    await expect(customers.resetPassword(first, password)).rejects.toThrow();
    await customers.changePassword(
      await customers.authenticate(account.token),
      password,
      'modified-local-password-456',
    );
    await expect(customers.resetPassword(second, password)).rejects.toThrow();
  });
  it('réessaie une panne SMTP, empêche les doublons et annule les messages expirés', async () => {
    const account = await create();
    rejected = true;
    await mail.processPending();
    rejected = false;
    const item = await db.mailOutbox.findFirstOrThrow({ where: { accountId: account.user.id } });
    expect(item.status).toBe('queued');
    expect(item.attempts).toBe(1);
    expect(item.lastError).toBe('smtp_delivery_failed');
    expect(item.payload).toBeTruthy();
    await db.mailOutbox.update({ where: { id: item.id }, data: { availableAt: new Date(0) } });
    const before = received.length;
    await mail.processPending();
    await mail.processPending();
    expect(received.length).toBe(before + 1);
    await customers.forgot(account.user.email);
    await db.mailOutbox.updateMany({
      where: { accountId: account.user.id, status: 'queued' },
      data: { expiresAt: new Date(0) },
    });
    await mail.processPending();
    expect(received.length).toBe(before + 1);
    expect(
      await db.mailOutbox.count({
        where: { accountId: account.user.id, status: 'cancelled', payload: null },
      }),
    ).toBe(1);
  });
  it('réserve les statuts à l’administration, exige la confirmation et la version, envoie au client vérifié', async () => {
    const account = await create();
    await mail.processPending();
    await customers.verifyEmail(token());
    const admin = await db.adminAccount.create({
      data: {
        username: `localmail-${randomUUID()}`,
        displayName: 'Équipe recette',
        passwordHash: await hashPassword(password),
        role: 'admin',
      },
    });
    admins.push(admin.id);
    const bearer = randomBytes(32).toString('base64url');
    const session = await db.adminSession.create({
      data: {
        accountId: admin.id,
        tokenHash: createHash('sha256').update(bearer).digest('hex'),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { user: admin, sessionId: session.id };
    const entry = await db.customerPreparedRequest.create({
      data: {
        accountId: account.user.id,
        requestKey: randomUUID(),
        payloadHash: 'a'.repeat(64),
        productName: 'Article synthétique',
        productSlug: 'recette-email',
        quantity: 1,
        priceXof: 1000,
      },
    });
    const url = `/api/v1/admin/customer-requests/${entry.id}/status`;
    await request(app.getHttpServer())
      .get('/api/v1/admin/customer-requests')
      .auth(account.token, { type: 'bearer' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(url)
      .auth(bearer, { type: 'bearer' })
      .send({ status: 'received', version: 0, confirmed: false })
      .expect(400);
    await expect(
      management.update(auth, entry.id, { status: 'delivered', version: 0, confirmed: true }),
    ).rejects.toThrow();
    const updated = await request(app.getHttpServer())
      .patch(url)
      .auth(bearer, { type: 'bearer' })
      .send({ status: 'received', version: 0, confirmed: true })
      .expect(200);
    expect(updated.body.notification).toBe('queued');
    await request(app.getHttpServer())
      .patch(url)
      .auth(bearer, { type: 'bearer' })
      .send({ status: 'received', version: 0, confirmed: true })
      .expect(409);
    await mail.processPending();
    expect(received.at(-1)).toContain(entry.id);
    const result = await management.update(auth, entry.id, {
      status: 'delivered',
      version: 1,
      confirmed: true,
    });
    expect(result.notification).toBe('queued');
    await mail.processPending();
    const history = await customers.preparedRequests(await customers.authenticate(account.token));
    expect(history.items[0].processingStatus).toBe('delivered');
    const unverified = await create();
    const other = await db.customerPreparedRequest.create({
      data: {
        accountId: unverified.user.id,
        requestKey: randomUUID(),
        payloadHash: 'b'.repeat(64),
        productName: 'Autre article synthétique',
        productSlug: 'autre-recette-email',
        quantity: 1,
        priceXof: 1000,
      },
    });
    expect(
      (await management.update(auth, other.id, { status: 'received', version: 0, confirmed: true }))
        .notification,
    ).toBe('unverified');
    expect(
      await db.mailOutbox.count({
        where: { accountId: unverified.user.id, kind: 'request_status' },
      }),
    ).toBe(0);
  });
  it('supprime les jetons et les e-mails en attente avec le compte', async () => {
    const account = await create();
    await customers.forgot(account.user.email);
    await customers.deleteProfile(await customers.authenticate(account.token), password);
    expect(await db.customerEmailToken.count({ where: { accountId: account.user.id } })).toBe(0);
    expect(await db.mailOutbox.count({ where: { accountId: account.user.id } })).toBe(0);
  });
  it('coupe tout envoi même avec un SMTP valide, tout en gardant inscription et suivi utilisables', async () => {
    const config = app.get(ConfigService);
    config.set('MAIL_ENABLED', false);
    try {
      const before = received.length;
      expect(
        (await request(app.getHttpServer()).get('/api/v1/customer/config').expect(200)).body,
      ).toEqual({ emailEnabled: false });
      const account = await create();
      expect(account.verificationQueued).toBe(false);
      const auth = await customers.authenticate(account.token);
      expect(auth.user.emailVerifiedAt).toBeNull();
      await customers.updateProfile(auth, 'Client sans e-mail');
      await request(app.getHttpServer())
        .post('/api/v1/customer/auth/forgot')
        .send({ email: account.user.email })
        .expect(503);
      expect(await db.customerEmailToken.count({ where: { accountId: account.user.id } })).toBe(0);
      expect(await db.mailOutbox.count({ where: { accountId: account.user.id } })).toBe(0);
      await mail.processPending();
      expect(received.length).toBe(before);
      await expect(customers.login(account.user.email, password)).resolves.toHaveProperty('token');
    } finally {
      config.set('MAIL_ENABLED', true);
    }
  });
});
