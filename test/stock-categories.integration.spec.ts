import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { configureApp } from '../src/bootstrap';
import { DatabaseService } from '../src/database/database.service';
import { hashPassword } from '../src/admin/password';
import { CustomerService } from '../src/customer/customer.service';
import { ShopService } from '../src/shop/shop.service';

const testUrl = process.env.DATABASE_TEST_URL;
(testUrl ? describe : describe.skip)(
  'Stock, catégories et publication HTTP/PostgreSQL isolé',
  () => {
    let app: INestApplication,
      db: DatabaseService,
      shop: ShopService,
      customer: Awaited<ReturnType<CustomerService['register']>>;
    const adminId = randomUUID(),
      productId = randomUUID(),
      token = randomBytes(32).toString('base64url'),
      name = `Gants de recette ${randomUUID().slice(0, 8)}`;
    let category = '';
    const call = () => request(app.getHttpServer());
    beforeAll(async () => {
      const url = new URL(testUrl!);
      if (
        !['127.0.0.1', 'localhost', 'postgres'].includes(url.hostname) ||
        !url.pathname.includes('test')
      )
        throw Error('Base locale de test requise.');
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = testUrl;
      process.env.DIRECT_URL = testUrl;
      process.env.MAIL_ENABLED = 'false';
      const { AppModule } = await import('../src/app.module');
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DatabaseService)
        .useValue(new DatabaseService(new ConfigService({ DATABASE_URL: testUrl })))
        .compile();
      app = module.createNestApplication({ bodyParser: false });
      configureApp(app);
      await app.init();
      db = app.get(DatabaseService);
      shop = app.get(ShopService);
      await db.adminAccount.create({
        data: {
          id: adminId,
          username: 'stock-' + adminId.slice(0, 8),
          displayName: 'Recette stock',
          passwordHash: await hashPassword('local-stock-test-password-only'),
          role: 'admin',
        },
      });
      await db.adminSession.create({
        data: {
          accountId: adminId,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      customer = await app.get(CustomerService).register({
        displayName: 'Client stock synthétique',
        email: `stock-${randomUUID()}@example.test`,
        password: 'local-stock-customer-password-only',
        consent: true,
      });
    });
    afterAll(async () => {
      if (db) {
        await db.customerAccount.deleteMany({
          where: { id: customer?.user.id || '00000000-0000-4000-8000-000000000000' },
        });
        await db.productMedia.deleteMany({ where: { productId } });
        await db.product.deleteMany({ where: { id: productId } });
        if (category) await db.productCategory.deleteMany({ where: { slug: category } });
        await db.adminAccount.deleteMany({ where: { id: adminId } });
      }
      await app?.close();
    });
    it('expose des catégories par type et protège leur création', async () => {
      const result = await call().get('/api/v1/categories').expect(200);
      const slugs = result.body.items.map((c: { value: string }) => c.value);
      expect(slugs).toEqual(
        expect.arrayContaining([
          'maillots',
          't-shirts-polos',
          'shorts',
          'survetements',
          'chaussures',
          'accessoires',
          'equipements',
        ]),
      );
      expect(slugs).not.toEqual(expect.arrayContaining(['senegal', 'dakar']));
      await call().post('/api/v1/admin/categories').send({ name }).expect(401);
      const created = await call()
        .post('/api/v1/admin/categories')
        .auth(token, { type: 'bearer' })
        .send({ name })
        .expect(201);
      category = created.body.value;
      expect(created.body.label).toBe(name);
      expect(category).toMatch(/^[a-z0-9-]+$/);
      await call()
        .post('/api/v1/admin/categories')
        .auth(token, { type: 'bearer' })
        .send({ name: name.toUpperCase() })
        .expect(409);
      await call()
        .post('/api/v1/admin/categories')
        .auth(token, { type: 'bearer' })
        .send({ name: '<script>recette</script>' })
        .expect(400);
      await call()
        .post('/api/v1/admin/categories')
        .auth(token, { type: 'bearer' })
        .send({ name: ' a ' })
        .expect(400);
    });
    it('exige un stock et une catégorie valides avant publication, sans inventer de quantité', async () => {
      await db.product.create({
        data: {
          id: productId,
          slug: 'recette-stock-' + productId,
          name: 'Article technique stock',
          category,
          priceXof: 1000,
          description: 'Recette isolée.',
        },
      });
      await db.productMedia.create({
        data: {
          productId,
          publicId: 'local-stock/' + productId,
          resourceType: 'image',
          state: 'ready',
          secureUrl: 'https://res.cloudinary.com/local-test/image/upload/stock.webp',
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      await call()
        .patch(`/api/v1/admin/products/${productId}`)
        .auth(token, { type: 'bearer' })
        .send({ status: 'published' })
        .expect(400);
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity,
      ).toBeNull();
      for (const stockQuantity of [-1, 1.5, '4'])
        await call()
          .patch(`/api/v1/admin/products/${productId}`)
          .auth(token, { type: 'bearer' })
          .send({ stockQuantity })
          .expect(400);
      await call()
        .patch(`/api/v1/admin/products/${productId}`)
        .auth(token, { type: 'bearer' })
        .send({ category: 'categorie-inexistante' })
        .expect(400);
      const saved = await call()
        .patch(`/api/v1/admin/products/${productId}`)
        .auth(token, { type: 'bearer' })
        .send({ stockQuantity: 3, status: 'published' })
        .expect(200);
      expect(saved.body.stockQuantity).toBe(3);
      expect(saved.body.categoryLabel).toBe(name);
      const products = await call().get('/api/v1/products').query({ category }).expect(200);
      expect(products.body.items.map((p: { id: string }) => p.id)).toContain(productId);
    });
    it('borne les demandes au stock, reste idempotent et ne réserve pas sur un clic WhatsApp', async () => {
      const body = { productId, quantity: 4, requestKey: randomUUID() };
      await call()
        .post('/api/v1/customer/requests')
        .auth(customer.token, { type: 'bearer' })
        .send(body)
        .expect(400);
      body.quantity = 3;
      await call()
        .post('/api/v1/customer/requests')
        .auth(customer.token, { type: 'bearer' })
        .send(body)
        .expect(204);
      await call()
        .post('/api/v1/customer/requests')
        .auth(customer.token, { type: 'bearer' })
        .send(body)
        .expect(204);
      expect(
        await db.customerPreparedRequest.count({ where: { accountId: customer.user.id } }),
      ).toBe(1);
      expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity).toBe(
        3,
      );
    });
    it('publie une rupture explicitement et bloque les nouvelles demandes', async () => {
      await call()
        .patch(`/api/v1/admin/products/${productId}`)
        .auth(token, { type: 'bearer' })
        .send({ stockQuantity: 0 })
        .expect(200);
      const result = await call()
        .get('/api/v1/products/recette-stock-' + productId)
        .expect(200);
      expect(result.body.stockQuantity).toBe(0);
      expect(result.body.availability).toBe('unavailable');
      await call()
        .post('/api/v1/customer/requests')
        .auth(customer.token, { type: 'bearer' })
        .send({ productId, quantity: 1, requestKey: randomUUID() })
        .expect(400);
    });
    it('refuse les imports vidéo et exclut les anciennes vidéos de la fiche publique', async () => {
      await call()
        .post(`/api/v1/admin/products/${productId}/media/upload-signature`)
        .auth(token, { type: 'bearer' })
        .send({ type: 'video' })
        .expect(400);
      await expect(shop.uploadSignature(productId, 'video')).rejects.toThrow('photos');
      await db.productMedia.create({
        data: {
          productId,
          publicId: 'legacy-video/' + productId,
          resourceType: 'video',
          state: 'ready',
          secureUrl: 'https://res.cloudinary.com/local-test/video/upload/legacy.webm',
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const product = await call()
        .get('/api/v1/products/recette-stock-' + productId)
        .expect(200);
      expect(product.body.media).toHaveLength(1);
      expect(product.body.media[0].type).toBe('image');
    });
  },
);
