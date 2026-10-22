import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { configureApp } from '../src/bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { hashPassword } from '../src/admin/password';
import { CustomerService } from '../src/customer/customer.service';

const testUrl = process.env.DATABASE_TEST_URL;
const run = testUrl ? describe : describe.skip;
const password = 'local-customer-test-password-123';
const replacement = 'replacement-customer-password-456';
const proxySecret = 'local-customer-proxy-only-not-a-real-secret';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
run('Comptes clients HTTP ↔ PostgreSQL local isolé', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let customers: CustomerService;
  let tracker = 1;
  let previousSecret: string | undefined;
  const accountIds: string[] = [];
  const productIds: string[] = [];
  const adminIds: string[] = [];
  const publicProducts: string[] = [];
  let draftId: string;
  let incompleteId: string;
  const call = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', route: string) => {
    const ip = `192.0.2.${tracker}`;
    const timestamp = Date.now().toString();
    return request(app.getHttpServer())
      [method](`/api/v1/customer${route}`)
      .set('x-gainde-client-ip', ip)
      .set('x-gainde-timestamp', timestamp)
      .set(
        'x-gainde-signature',
        createHmac('sha256', proxySecret).update(`${ip}:${timestamp}`).digest('hex'),
      );
  };
  const createAccount = async () => {
    const result = await customers.register({
      email: `local-${randomUUID()}@example.test`,
      displayName: 'Client synthétique',
      password,
      consent: true,
    });
    accountIds.push(result.user.id);
    return result;
  };
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (
      !['localhost', '127.0.0.1', '::1', 'postgres'].includes(url.hostname) ||
      !url.pathname.includes('test')
    )
      throw new Error('Une base PostgreSQL locale de test distincte est requise.');
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = testUrl;
    process.env.DIRECT_URL = testUrl;
    previousSecret = process.env.CONTACT_PROXY_SECRET;
    process.env.CONTACT_PROXY_SECRET = proxySecret;
    const { AppModule } = await import('../src/app.module');
    const isolatedDb = new DatabaseService(new ConfigService({ DATABASE_URL: testUrl }));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue(isolatedDb)
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    customers = app.get(CustomerService);
    for (let index = 0; index < 33; index++) {
      const id = randomUUID();
      productIds.push(id);
      publicProducts.push(id);
      await db.product.create({
        data: {
          id,
          slug: `local-customer-${id}`,
          name: `Produit synthétique ${index}`,
          description: 'Recette locale isolée.',
          category: 'maillots',
          stockQuantity: 100,
          priceXof: 1000 + index,
          status: 'published',
          sizes: ['M', 'L'],
          colors: ['Vert'],
          media: {
            create: {
              publicId: `local-test/${id}`,
              resourceType: 'image',
              state: 'ready',
              secureUrl: `https://res.cloudinary.com/local-test/image/upload/${id}.webp`,
              expiresAt: new Date(Date.now() + 3600000),
            },
          },
        },
      });
    }
    draftId = randomUUID();
    incompleteId = randomUUID();
    productIds.push(draftId, incompleteId);
    for (const [id, status] of [
      [draftId, 'draft'],
      [incompleteId, 'published'],
    ] as const)
      await db.product.create({
        data: {
          id,
          slug: `local-hidden-${id}`,
          name: 'Produit synthétique privé',
          category: 'maillots',
          stockQuantity: 100,
          status,
        },
      });
  }, 30000);
  beforeEach(() => {
    tracker++;
  });
  afterAll(async () => {
    if (db) {
      await db.customerAccount.deleteMany({ where: { id: { in: accountIds } } });
      await db.productMedia.deleteMany({ where: { productId: { in: productIds } } });
      await db.product.deleteMany({ where: { id: { in: productIds } } });
      await db.adminAccount.deleteMany({ where: { id: { in: adminIds } } });
    }
    await app?.close();
    if (previousSecret === undefined) delete process.env.CONTACT_PROXY_SECRET;
    else process.env.CONTACT_PROXY_SECRET = previousSecret;
  });
  it('inscrit, normalise et ne renvoie aucun hash, rôle ni donnée privée', async () => {
    const email = `local-${randomUUID()}@example.test`;
    const result = await call('post', '/auth/register')
      .send({
        email: ` ${email.toUpperCase()} `,
        displayName: '  Client local ',
        password,
        consent: true,
      })
      .expect(201);
    accountIds.push(result.body.user.id);
    expect(Object.keys(result.body.user).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'emailVerifiedAt',
      'id',
    ]);
    expect(result.body.user.email).toBe(email);
    expect(result.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.body.verificationQueued).toBe(false);
    expect(result.headers['cache-control']).toBe('no-store');
    const account = await db.customerAccount.findUniqueOrThrow({
      where: { id: result.body.user.id },
    });
    const session = await db.customerSession.findFirstOrThrow({ where: { accountId: account.id } });
    expect(account.passwordHash).not.toBe(password);
    expect(account.emailVerifiedAt).toBeNull();
    expect(session.tokenHash).toBe(digest(result.body.token));
    expect(new Date(result.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
    await call('post', '/auth/register')
      .send({ email, displayName: 'Duplicate', password, consent: true })
      .expect(409);
    await call('post', '/auth/register')
      .send({
        email: `fresh-${email}`,
        displayName: 'Invalid',
        password,
        consent: false,
        role: 'owner',
      })
      .expect(400);
  });
  it('exige une session et sépare clients, administrateurs et autres clients', async () => {
    const a = await createAccount(),
      b = await createAccount();
    const admin = await db.adminAccount.create({
      data: {
        username: `test-${randomUUID().slice(0, 12)}`,
        displayName: 'Admin local',
        passwordHash: await hashPassword(password),
        role: 'owner',
      },
    });
    adminIds.push(admin.id);
    const logged = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ username: admin.username, password })
      .expect(200);
    await call('get', '/auth/me').expect(401);
    await call('get', '/auth/me').auth(logged.body.token, { type: 'bearer' }).expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/accounts')
      .auth(a.token, { type: 'bearer' })
      .expect(401);
    await call('patch', '/profile')
      .auth(a.token, { type: 'bearer' })
      .send({ displayName: 'Nom modifié', id: b.user.id })
      .expect(400);
    const updated = await call('patch', '/profile')
      .auth(a.token, { type: 'bearer' })
      .send({ displayName: 'Nom modifié' })
      .expect(200);
    expect(updated.body.user.id).toBe(a.user.id);
    expect(
      (await db.customerAccount.findUniqueOrThrow({ where: { id: b.user.id } })).displayName,
    ).toBe('Client synthétique');
    await call('get', '/auth/me').auth('not-a-session', { type: 'bearer' }).expect(401);
  });
  it('refuse mot de passe incorrect, session expirée puis révoque le logout', async () => {
    const account = await createAccount();
    const unknown = await call('post', '/auth/login')
      .send({ email: 'unknown-customer@example.test', password })
      .expect(401);
    const incorrect = await call('post', '/auth/login')
      .send({ email: account.user.email, password: 'incorrect' })
      .expect(401);
    expect(incorrect.body.message).toBe(unknown.body.message);
    const logged = await call('post', '/auth/login')
      .send({ email: account.user.email.toUpperCase(), password })
      .expect(200);
    await call('post', '/auth/logout').auth(logged.body.token, { type: 'bearer' }).expect(204);
    await call('get', '/auth/me').auth(logged.body.token, { type: 'bearer' }).expect(401);
    await db.customerSession.updateMany({
      where: { accountId: account.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await call('get', '/auth/me').auth(account.token, { type: 'bearer' }).expect(401);
  });
  it('limite réellement les tentatives de connexion et récupération', async () => {
    for (let attempt = 0; attempt < 5; attempt++)
      await call('post', '/auth/login')
        .send({ email: 'unknown-limit@example.test', password })
        .expect(401);
    await call('post', '/auth/login')
      .send({ email: 'unknown-limit@example.test', password })
      .expect(429);
    for (let attempt = 0; attempt < 3; attempt++)
      await call('post', '/auth/forgot').send({ email: 'unknown-limit@example.test' }).expect(503);
    await call('post', '/auth/forgot').send({ email: 'unknown-limit@example.test' }).expect(429);
  });
  it('change le mot de passe puis révoque toutes les sessions, y compris la session courante', async () => {
    const account = await createAccount();
    const second = await call('post', '/auth/login')
      .send({ email: account.user.email, password })
      .expect(200);
    await call('post', '/auth/password')
      .auth(account.token, { type: 'bearer' })
      .send({ currentPassword: 'incorrect', newPassword: replacement })
      .expect(400);
    await call('post', '/auth/password')
      .auth(account.token, { type: 'bearer' })
      .send({ currentPassword: password, newPassword: replacement })
      .expect(200);
    await call('get', '/auth/me').auth(account.token, { type: 'bearer' }).expect(401);
    await call('get', '/auth/me').auth(second.body.token, { type: 'bearer' }).expect(401);
    await call('post', '/auth/login').send({ email: account.user.email, password }).expect(401);
    await call('post', '/auth/login')
      .send({ email: account.user.email, password: replacement })
      .expect(200);
  });
  it('signale honnêtement le service e-mail non configuré sans faux envoi', async () => {
    expect((await call('get', '/config').expect(200)).body).toEqual({ emailEnabled: false });
    const account = await createAccount();
    expect(account.verificationQueued).toBe(false);
    for (const email of [account.user.email, 'absent@example.test'])
      await call('post', '/auth/forgot').send({ email }).expect(503);
    await call('post', '/auth/resend-verification')
      .auth(account.token, { type: 'bearer' })
      .send({})
      .expect(503);
    expect(await db.customerEmailToken.count({ where: { accountId: account.user.id } })).toBe(0);
  });
  it('garde les favoris privés, idempotents, à jour et sans brouillons ni prix injectés', async () => {
    const a = await createAccount(),
      b = await createAccount();
    for (let index = 0; index < 2; index++)
      await call('put', `/wishlist/${publicProducts[0]}`)
        .auth(a.token, { type: 'bearer' })
        .expect(204);
    expect(await db.customerWishlist.count({ where: { accountId: a.user.id } })).toBe(1);
    expect(
      (await call('get', '/wishlist').auth(b.token, { type: 'bearer' }).expect(200)).body.items,
    ).toHaveLength(0);
    await call('put', `/wishlist/${draftId}`).auth(a.token, { type: 'bearer' }).expect(404);
    await call('put', `/wishlist/${incompleteId}`).auth(a.token, { type: 'bearer' }).expect(404);
    await call('post', '/wishlist/merge')
      .auth(a.token, { type: 'bearer' })
      .send({
        productIds: [publicProducts[0], publicProducts[1], draftId, incompleteId, randomUUID()],
        priceXof: 1,
      })
      .expect(400);
    const merged = await call('post', '/wishlist/merge')
      .auth(a.token, { type: 'bearer' })
      .send({
        productIds: [publicProducts[0], publicProducts[1], draftId, incompleteId, randomUUID()],
      })
      .expect(200);
    expect(merged.body.items).toHaveLength(2);
    expect(merged.body.items.every((item: { status: string }) => item.status === 'published')).toBe(
      true,
    );
    await db.product.update({
      where: { id: publicProducts[0] },
      data: { priceXof: 7777, status: 'draft' },
    });
    const refreshed = await call('get', '/wishlist').auth(a.token, { type: 'bearer' }).expect(200);
    expect(refreshed.body.items.map((item: { id: string }) => item.id)).toEqual([
      publicProducts[1],
    ]);
    await db.product.update({ where: { id: publicProducts[0] }, data: { status: 'published' } });
    expect(
      (
        await call('get', '/wishlist').auth(a.token, { type: 'bearer' }).expect(200)
      ).body.items.find((item: { id: string }) => item.id === publicProducts[0]).priceXof,
    ).toBe(7777);
    await call('delete', `/wishlist/${publicProducts[0]}`)
      .auth(b.token, { type: 'bearer' })
      .expect(204);
    expect(await db.customerWishlist.count({ where: { accountId: a.user.id } })).toBe(2);
    await call('delete', `/wishlist/${publicProducts[0]}`)
      .auth(a.token, { type: 'bearer' })
      .expect(204);
  });
  it('borne aux 30 dernières consultations, actualise, efface et désactive la mémorisation', async () => {
    const account = await createAccount();
    await call('post', '/history').send({ productId: publicProducts[0] }).expect(401);
    await call('post', '/history')
      .auth(account.token, { type: 'bearer' })
      .send({ productId: draftId })
      .expect(404);
    for (const productId of publicProducts)
      await call('post', '/history')
        .auth(account.token, { type: 'bearer' })
        .send({ productId })
        .expect(204);
    expect(await db.customerProductView.count({ where: { accountId: account.user.id } })).toBe(30);
    await call('post', '/history')
      .auth(account.token, { type: 'bearer' })
      .send({ productId: publicProducts[0] })
      .expect(204);
    const history = await call('get', '/history')
      .auth(account.token, { type: 'bearer' })
      .expect(200);
    expect(history.body.items).toHaveLength(30);
    expect(history.body.items[0].product.id).toBe(publicProducts[0]);
    expect(history.body.items[0].viewedAt).toBeDefined();
    await call('patch', '/history/settings')
      .auth(account.token, { type: 'bearer' })
      .send({ enabled: false })
      .expect(200);
    await call('post', '/history')
      .auth(account.token, { type: 'bearer' })
      .send({ productId: publicProducts[0] })
      .expect(204);
    expect(
      (await call('get', '/history').auth(account.token, { type: 'bearer' }).expect(200)).body,
    ).toEqual({ items: [], enabled: false });
    expect(await db.customerProductView.count({ where: { accountId: account.user.id } })).toBe(0);
    await call('patch', '/history/settings')
      .auth(account.token, { type: 'bearer' })
      .send({ enabled: true })
      .expect(200);
    await call('post', '/history')
      .auth(account.token, { type: 'bearer' })
      .send({ productId: publicProducts[0] })
      .expect(204);
    await call('delete', '/history').auth(account.token, { type: 'bearer' }).expect(204);
    expect(
      (await call('get', '/history').auth(account.token, { type: 'bearer' }).expect(200)).body
        .items,
    ).toHaveLength(0);
  });
  it('enregistre uniquement une demande préparée, vérifie options/disponibilité et idempotence', async () => {
    const account = await createAccount(),
      other = await createAccount();
    const body = {
      productId: publicProducts[1],
      requestKey: randomUUID(),
      quantity: 2,
      size: 'M',
      color: 'Vert',
    };
    await call('post', '/requests')
      .auth(account.token, { type: 'bearer' })
      .send({ ...body, quantity: 0 })
      .expect(400);
    await call('post', '/requests')
      .auth(account.token, { type: 'bearer' })
      .send({ ...body, size: 'inventée' })
      .expect(400);
    await call('post', '/requests')
      .auth(account.token, { type: 'bearer' })
      .send({ ...body, priceXof: 1 })
      .expect(400);
    for (let index = 0; index < 2; index++)
      await call('post', '/requests')
        .auth(account.token, { type: 'bearer' })
        .send(body)
        .expect(204);
    expect(await db.customerPreparedRequest.count({ where: { accountId: account.user.id } })).toBe(
      1,
    );
    await call('post', '/requests')
      .auth(account.token, { type: 'bearer' })
      .send({ ...body, quantity: 3 })
      .expect(409);
    expect(
      (await call('get', '/requests').auth(other.token, { type: 'bearer' }).expect(200)).body.items,
    ).toHaveLength(0);
    await db.product.update({ where: { id: publicProducts[1] }, data: { status: 'draft' } });
    const list = await call('get', '/requests').auth(account.token, { type: 'bearer' }).expect(200);
    expect(list.body.items[0].product).toBeNull();
    expect(list.body.items[0].productName).toBe('Produit synthétique 1');
    expect(list.body.items[0].priceXof).toBe(1001);
    expect(list.body.items[0]).not.toHaveProperty('status');
    await db.product.update({
      where: { id: publicProducts[1] },
      data: { status: 'published', availability: 'unavailable' },
    });
    await call('post', '/requests')
      .auth(account.token, { type: 'bearer' })
      .send({ ...body, requestKey: randomUUID() })
      .expect(400);
    await db.product.update({
      where: { id: publicProducts[1] },
      data: { availability: 'on_request' },
    });
    await call('delete', '/requests').auth(account.token, { type: 'bearer' }).expect(204);
    expect(
      (await call('get', '/requests').auth(account.token, { type: 'bearer' }).expect(200)).body
        .items,
    ).toHaveLength(0);
  });
  it('borne les demandes préparées à 50 et conserve le snapshot après suppression produit', async () => {
    const account = await createAccount();
    const auth = await customers.authenticate(account.token);
    for (let index = 0; index < 52; index++)
      await customers.prepareRequest(auth, {
        productId: publicProducts[31],
        requestKey: randomUUID(),
        quantity: 1,
        size: 'M',
        color: 'Vert',
      });
    expect(await db.customerPreparedRequest.count({ where: { accountId: account.user.id } })).toBe(
      50,
    );
    await db.productMedia.deleteMany({ where: { productId: publicProducts[31] } });
    await db.product.delete({ where: { id: publicProducts[31] } });
    const result = await customers.preparedRequests(auth);
    expect(result.items).toHaveLength(50);
    expect(result.items[0].product).toBeNull();
    expect(result.items[0].productName).toBe('Produit synthétique 31');
  }, 20000);
  it('supprime le compte seulement après vérification et cascade sessions/favoris/historiques', async () => {
    const account = await createAccount(),
      auth = await customers.authenticate(account.token);
    await customers.addWishlist(auth, publicProducts[0]);
    await customers.recordView(auth, publicProducts[0]);
    await customers.prepareRequest(auth, {
      productId: publicProducts[0],
      requestKey: randomUUID(),
      quantity: 1,
      size: 'M',
      color: 'Vert',
    });
    await call('delete', '/profile')
      .auth(account.token, { type: 'bearer' })
      .send({ password: 'incorrect' })
      .expect(400);
    await call('delete', '/profile')
      .auth(account.token, { type: 'bearer' })
      .send({ password })
      .expect(204);
    await call('get', '/auth/me').auth(account.token, { type: 'bearer' }).expect(401);
    expect(await db.customerAccount.count({ where: { id: account.user.id } })).toBe(0);
    expect(await db.customerSession.count({ where: { accountId: account.user.id } })).toBe(0);
    expect(await db.customerWishlist.count({ where: { accountId: account.user.id } })).toBe(0);
    expect(await db.customerProductView.count({ where: { accountId: account.user.id } })).toBe(0);
    expect(await db.customerPreparedRequest.count({ where: { accountId: account.user.id } })).toBe(
      0,
    );
  });
});
