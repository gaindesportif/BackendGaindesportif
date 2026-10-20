import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import request from 'supertest';
import { configureApp } from '../src/bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { hashPassword } from '../src/admin/password';
import { CloudinaryService, MEDIA_LIMITS } from '../src/shop/cloudinary.service';
import { ShopService } from '../src/shop/shop.service';

const testUrl = process.env.DATABASE_TEST_URL;
const run = testUrl ? describe : describe.skip;
run('Boutique HTTP ↔ PostgreSQL local (Cloudinary simulé, aucune écriture Neon)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let shop: ShopService;
  let ownerId: string;
  let ownerToken: string;
  let adminToken: string;
  let adminId: string;
  let productId: string;
  let secondId: string;
  let mediaId: string;
  const usernames = [`test-owner-${Date.now()}`, `test-admin-${Date.now()}`];
  const ids: string[] = [];
  const cloud = {
    configuration: jest.fn().mockReturnValue({ configured: true, ...MEDIA_LIMITS }),
    signature: jest.fn().mockReturnValue({
      uploadUrl: 'https://api.cloudinary.com/v1_1/test/image/upload',
      fields: { api_key: '1234', signature: 'test-signature' },
      maxBytes: MEDIA_LIMITS.maxImageBytes,
    }),
    verify: jest.fn().mockImplementation(async (publicId: string) => ({
      secureUrl: `https://res.cloudinary.com/test/image/upload/${publicId}.webp`,
      bytes: 1000,
      format: 'webp',
      width: 600,
      height: 600,
      duration: null,
    })),
    destroy: jest.fn().mockResolvedValue(undefined),
    destroyRawPrefix: jest.fn().mockResolvedValue(undefined),
  };
  const productBody = {
    name: 'Produit technique de recette',
    description: 'Contenu synthétique réservé aux tests locaux.',
    category: 'equipements',
    priceXof: 12000,
    sizes: ['M', 'L'],
    colors: ['Vert'],
    availability: 'on_request',
  };
  const api = () => request(app.getHttpServer());
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
    const { AppModule } = await import('../src/app.module');
    const isolatedDb = new DatabaseService(new ConfigService({ DATABASE_URL: testUrl }));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue(isolatedDb)
      .overrideProvider(CloudinaryService)
      .useValue(cloud)
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    shop = app.get(ShopService);
    ownerId = (
      await db.adminAccount.create({
        data: {
          username: usernames[0],
          displayName: 'Propriétaire de recette',
          passwordHash: await hashPassword('local-test-password-123'),
          role: 'owner',
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (!db) return;
    await shop.runCleanup().catch(() => undefined);
    await db.productMedia.deleteMany({ where: { productId: { in: ids } } });
    await db.product.deleteMany({ where: { id: { in: ids } } });
    await db.adminAccount.deleteMany({ where: { username: { in: usernames } } });
    await app.close();
  });
  it('refuse accès anonyme, login invalide et champs de rôle inattendus', async () => {
    await api().get('/api/v1/admin/products').expect(401);
    await api()
      .post('/api/v1/admin/auth/login')
      .send({ username: usernames[0], password: 'incorrect' })
      .expect(401);
    const result = await api()
      .post('/api/v1/admin/auth/login')
      .send({ username: usernames[0], password: 'local-test-password-123' })
      .expect(200);
    ownerToken = result.body.token;
    expect(ownerToken).toMatch(/^[\w-]{43}$/);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.user).not.toHaveProperty('passwordHash');
    const stored = await db.adminSession.findFirstOrThrow({ where: { accountId: ownerId } });
    expect(stored.tokenHash).not.toBe(ownerToken);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    await api()
      .post('/api/v1/admin/accounts')
      .auth(ownerToken, { type: 'bearer' })
      .send({
        username: usernames[1],
        displayName: 'Admin recette',
        password: 'local-test-password-456',
        role: 'owner',
      })
      .expect(400);
  });
  it('gère les comptes sous contrôle du propriétaire et révoque les sessions désactivées', async () => {
    const created = await api()
      .post('/api/v1/admin/accounts')
      .auth(ownerToken, { type: 'bearer' })
      .send({
        username: usernames[1],
        displayName: 'Admin recette',
        password: 'local-test-password-456',
      })
      .expect(201);
    adminId = created.body.id;
    expect(created.body.role).toBe('admin');
    const logged = await api()
      .post('/api/v1/admin/auth/login')
      .send({ username: usernames[1], password: 'local-test-password-456' })
      .expect(200);
    adminToken = logged.body.token;
    await api().get('/api/v1/admin/accounts').auth(adminToken, { type: 'bearer' }).expect(403);
    await api()
      .patch(`/api/v1/admin/accounts/${ownerId}`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ active: false })
      .expect(403);
    const me = await api()
      .get('/api/v1/admin/auth/me')
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(me.body.user.id).toBe(adminId);
  });
  it('enregistre des brouillons réels, valide les prix et interdit une publication sans image', async () => {
    await api()
      .post('/api/v1/admin/products')
      .auth(adminToken, { type: 'bearer' })
      .send({ ...productBody, priceXof: -2 })
      .expect(400);
    await api()
      .post('/api/v1/admin/products')
      .auth(adminToken, { type: 'bearer' })
      .send({ ...productBody, name: '<b>test</b>' })
      .expect(400);
    const created = await api()
      .post('/api/v1/admin/products')
      .auth(adminToken, { type: 'bearer' })
      .send(productBody)
      .expect(201);
    productId = created.body.id;
    ids.push(productId);
    const second = await api()
      .post('/api/v1/admin/products')
      .auth(ownerToken, { type: 'bearer' })
      .send({ ...productBody, priceXof: null })
      .expect(201);
    secondId = second.body.id;
    ids.push(secondId);
    await api()
      .patch(`/api/v1/admin/products/${productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ status: 'published' })
      .expect(400);
    const list = await api()
      .get(`/api/v1/products?q=${encodeURIComponent(productBody.name)}`)
      .expect(200);
    expect(list.body.items.some((item: { id: string }) => ids.includes(item.id))).toBe(false);
  });
  it('lie chaque ticket au produit, vérifie le média et publie sans données internes', async () => {
    const ticket = await api()
      .post(`/api/v1/admin/products/${productId}/media/upload-signature`)
      .auth(adminToken, { type: 'bearer' })
      .send({ type: 'image' })
      .expect(201);
    mediaId = ticket.body.mediaId;
    expect(ticket.body.fields).not.toHaveProperty('api_secret');
    await api()
      .post(`/api/v1/admin/products/${secondId}/media/${mediaId}/confirm`)
      .auth(adminToken, { type: 'bearer' })
      .send({ alt: 'Test' })
      .expect(404);
    await api()
      .delete(`/api/v1/admin/products/${secondId}/media/${mediaId}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(404);
    const media = await api()
      .post(`/api/v1/admin/products/${productId}/media/${mediaId}/confirm`)
      .auth(adminToken, { type: 'bearer' })
      .send({ alt: 'Image de recette' })
      .expect(201);
    expect(media.body).toMatchObject({ id: mediaId, type: 'image', alt: 'Image de recette' });
    expect(cloud.verify).toHaveBeenCalledWith(expect.stringContaining(productId), 'image');
    await api()
      .patch(`/api/v1/admin/products/${productId}/media/${mediaId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ position: 2, alt: 'Image modifiée' })
      .expect(200);
    const published = await api()
      .patch(`/api/v1/admin/products/${productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ status: 'published' })
      .expect(200);
    const found = await api().get(`/api/v1/products/${published.body.slug}`).expect(200);
    expect(found.body.priceXof).toBe(12000);
    expect(found.body.media[0]).toMatchObject({ alt: 'Image modifiée', position: 2 });
    expect(JSON.stringify(found.body)).not.toMatch(
      /publicId|passwordHash|tokenHash|expiresAt|lastError/,
    );
    await api()
      .patch(`/api/v1/admin/products/${productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ priceXof: null })
      .expect(400);
  });
  it('retire immédiatement la dernière image et garde une suppression durable pendant une panne', async () => {
    cloud.destroy.mockRejectedValue(new ServiceUnavailableException('panne simulée'));
    const deleted = await api()
      .delete(`/api/v1/admin/products/${productId}/media/${mediaId}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(202);
    expect(deleted.body).toEqual({ deleted: false, pendingMediaCleanup: 1 });
    await shop.runCleanup();
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).status).toBe('draft');
    const retained = await db.productMedia.findUniqueOrThrow({ where: { id: mediaId } });
    expect(retained.state).toBe('deleting');
    expect(retained.attempts).toBeGreaterThanOrEqual(1);
    expect(retained.publicId).toContain(productId);
    cloud.destroy.mockResolvedValue(undefined);
    await db.productMedia.update({ where: { id: mediaId }, data: { nextAttemptAt: new Date(0) } });
    await shop.runCleanup();
    expect(await db.productMedia.findUnique({ where: { id: mediaId } })).not.toBeNull();
    await db.productMedia.update({
      where: { id: mediaId },
      data: { expiresAt: new Date(0), nextAttemptAt: new Date(0) },
    });
    await shop.runCleanup();
    expect(await db.productMedia.findUnique({ where: { id: mediaId } })).toBeNull();
    expect(cloud.destroy).toHaveBeenCalledWith(expect.any(String), 'image');
    expect(cloud.destroy).toHaveBeenCalledWith(expect.any(String), 'video');
    expect(cloud.destroyRawPrefix).toHaveBeenCalledWith(expect.any(String));
  });
  it('borne les médias, les vidéos et les sessions expirées, et révoque les autres sessions après changement de mot de passe', async () => {
    const product = await shop.create(productBody);
    ids.push(product.id);
    await Promise.all([
      shop.uploadSignature(product.id, 'video'),
      shop.uploadSignature(product.id, 'video'),
    ]);
    await expect(shop.uploadSignature(product.id, 'video')).rejects.toThrow('limite');
    const config = await api()
      .get('/api/v1/admin/media/config')
      .auth(ownerToken, { type: 'bearer' })
      .expect(200);
    expect(config.body.maxImages).toBe(5);
    // Les tickets en attente réservent leur place, même lors de six demandes concurrentes.
    const images = await Promise.allSettled(
      Array.from({ length: 6 }, () => shop.uploadSignature(product.id, 'image')),
    );
    expect(images.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(images.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await db.productMedia.count({ where: { productId: product.id, resourceType: 'image' } }),
    ).toBe(5);
    await expect(shop.uploadSignature(product.id, 'image')).rejects.toThrow('limite');
    const ownerSession = await db.adminSession.findFirstOrThrow({ where: { accountId: ownerId } });
    const other = await db.adminSession.create({
      data: {
        accountId: ownerId,
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await api()
      .post('/api/v1/admin/auth/password')
      .auth(ownerToken, { type: 'bearer' })
      .send({
        currentPassword: 'local-test-password-123',
        newPassword: 'local-test-password-updated',
      })
      .expect(200);
    expect(await db.adminSession.findUnique({ where: { id: other.id } })).toBeNull();
    expect(await db.adminSession.findUnique({ where: { id: ownerSession.id } })).not.toBeNull();
    await db.adminSession.updateMany({
      where: { accountId: adminId },
      data: { expiresAt: new Date(0) },
    });
    await api().get('/api/v1/admin/auth/me').auth(adminToken, { type: 'bearer' }).expect(401);
  });
  it('nettoie les uploads abandonnés seulement après expiration, puis purge le produit', async () => {
    const ticket = await shop.uploadSignature(secondId, 'video');
    await db.productMedia.update({
      where: { id: ticket.mediaId },
      data: { expiresAt: new Date(0) },
    });
    cloud.destroyRawPrefix.mockRejectedValueOnce(
      new ServiceUnavailableException('panne raw simulée'),
    );
    await shop.runCleanup();
    expect((await db.productMedia.findUniqueOrThrow({ where: { id: ticket.mediaId } })).state).toBe(
      'deleting',
    );
    await db.productMedia.update({
      where: { id: ticket.mediaId },
      data: { nextAttemptAt: new Date(0) },
    });
    await shop.runCleanup();
    expect(await db.productMedia.findUnique({ where: { id: ticket.mediaId } })).toBeNull();
    const response = await api()
      .delete(`/api/v1/admin/products/${secondId}`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(200);
    expect(response.body).toEqual({ deleted: true, pendingMediaCleanup: 0 });
    await api()
      .delete(`/api/v1/admin/products/${secondId}`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(200);
  });
  it('cache immédiatement un produit supprimé, refuse les modifications et finit après purge', async () => {
    const ticket = await shop.uploadSignature(productId, 'image');
    await shop.confirmMedia(productId, ticket.mediaId, { alt: 'Recette suppression' });
    const published = await shop.update(productId, { status: 'published' });
    await api()
      .delete(`/api/v1/admin/products/${productId}`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(202);
    await shop.runCleanup();
    await api().get(`/api/v1/products/${published.slug}`).expect(404);
    await api()
      .patch(`/api/v1/admin/products/${productId}`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ name: 'Modification refusée' })
      .expect(409);
    await db.productMedia.updateMany({
      where: { productId },
      data: { expiresAt: new Date(0), nextAttemptAt: new Date(0) },
    });
    await shop.runCleanup();
    expect(await db.product.findUnique({ where: { id: productId } })).toBeNull();
  });
  it('révoque la session désactivée puis déconnecte le propriétaire', async () => {
    await api()
      .patch(`/api/v1/admin/accounts/${adminId}`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ active: false })
      .expect(200);
    await api().get('/api/v1/admin/auth/me').auth(adminToken, { type: 'bearer' }).expect(401);
    await api().post('/api/v1/admin/auth/logout').auth(ownerToken, { type: 'bearer' }).expect(204);
    await api().get('/api/v1/admin/auth/me').auth(ownerToken, { type: 'bearer' }).expect(401);
  });
});
