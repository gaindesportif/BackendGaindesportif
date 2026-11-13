import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseService } from '../src/database/database.service';
import { CloudinaryService } from '../src/shop/cloudinary.service';
import { EditorialService } from '../src/editorial/editorial.service';
import { configureApp } from '../src/bootstrap';
import { hashPassword } from '../src/admin/password';
const url = process.env.DATABASE_TEST_URL;
(url ? describe : describe.skip)('Gaindé Media HTTP / PostgreSQL isolé', () => {
  let app: INestApplication, db: DatabaseService, service: EditorialService, config: ConfigService;
  let token: string, id: string, version: number, imageId: string, slug: string;
  const username = `media-test-${Date.now()}`;
  const ids: string[] = [];
  const dto = {
    title: 'TEST LOCAL — Les voix du terrain',
    excerpt: 'Données synthétiques.',
    body: '## Le terrain\n\nUn récit local.',
    category: 'reportages',
    status: 'draft',
  };
  const cloud = {
    signature: jest
      .fn()
      .mockReturnValue({
        uploadUrl: 'https://api.cloudinary.com/v1_1/test/image/upload',
        fields: {},
        maxBytes: 10485760,
      }),
    verify: jest
      .fn()
      .mockImplementation(async (publicId: string) => ({
        secureUrl: `https://res.cloudinary.com/test/image/upload/${publicId}.jpg`,
        bytes: 100,
        width: 800,
        height: 500,
        format: 'jpg',
        duration: null,
      })),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
  const api = () => request(app.getHttpServer());
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.includes('test'))
      throw new Error('Base locale de test requise.');
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
    process.env.MEDIA_PUBLIC_ENABLED = 'true';
    const { AppModule } = await import('../src/app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue(new DatabaseService(new ConfigService({ DATABASE_URL: url })))
      .overrideProvider(CloudinaryService)
      .useValue(cloud)
      .compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    service = app.get(EditorialService);
    config = app.get(ConfigService);
    await db.adminAccount.create({
      data: {
        username,
        displayName: 'Rédacteur test',
        passwordHash: await hashPassword('media-local-test-123456'),
        role: 'admin',
      },
    });
    const login = await api()
      .post('/api/v1/admin/auth/login')
      .send({ username, password: 'media-local-test-123456' })
      .expect(200);
    token = login.body.token;
  });
  afterAll(async () => {
    if (!db) return;
    await db.articleImage.deleteMany({ where: { articleId: { in: ids } } });
    await db.article.deleteMany({ where: { id: { in: ids } } });
    await db.adminAccount.deleteMany({ where: { username } });
    await app.close();
  });
  it('protège les brouillons et mutations contre les visiteurs', async () => {
    await api().get('/api/v1/admin/articles').expect(401);
    await api().post('/api/v1/admin/articles').send(dto).expect(401);
  });
  it('autorise un administrateur, auteur absent, article long au-delà de 32 Ko', async () => {
    const r = await api()
      .post('/api/v1/admin/articles')
      .auth(token, { type: 'bearer' })
      .send({ ...dto, body: 'Texte très long.\n\n'.repeat(5000) })
      .expect(201);
    id = r.body.id;
    ids.push(id);
    slug = r.body.slug;
    version = r.body.version;
    expect(r.body.author).toBe('');
    expect(r.body.body.length).toBeGreaterThan(32000);
    expect(r.headers['cache-control']).toBe('no-store');
    const get = await api()
      .get(`/api/v1/admin/articles/${id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(get.body.body).toBe(r.body.body);
  });
  it('ne rend pas les brouillons publics et valide les entrées', async () => {
    await api().get(`/api/v1/articles/${slug}`).expect(404);
    for (const invalid of [
      { ...dto, title: 'x'.repeat(161) },
      { ...dto, category: 'autre' },
      { ...dto, status: 'published' },
      { ...dto, role: 'owner' },
    ])
      await api()
        .post('/api/v1/admin/articles')
        .auth(token, { type: 'bearer' })
        .send(invalid)
        .expect(400);
    await api().get('/api/v1/articles?page=-1').expect(400);
  });
  it('refuse une publication sans photo', async () => {
    await api()
      .patch(`/api/v1/admin/articles/${id}`)
      .auth(token, { type: 'bearer' })
      .send({ ...dto, status: 'published', version })
      .expect(400);
  });
  it('réserve et vérifie une photo Cloudinary ; confirmation réessayable', async () => {
    const r = await api()
      .post(`/api/v1/admin/articles/${id}/images/upload-signature`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(201);
    imageId = r.body.id;
    expect(cloud.signature.mock.calls.at(-1)?.[0]).toMatch(/^gainde\/editorial\//);
    cloud.verify.mockRejectedValueOnce(
      new (await import('@nestjs/common')).ServiceUnavailableException(),
    );
    await api()
      .post(`/api/v1/admin/articles/${id}/images/${imageId}/confirm`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(503);
    expect(await db.articleImage.count({ where: { id: imageId, state: 'pending' } })).toBe(1);
    const confirmed = await api()
      .post(`/api/v1/admin/articles/${id}/images/${imageId}/confirm`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(201);
    version = confirmed.body.version;
    expect(confirmed.body.images[0].credit).toBe('');
    expect(confirmed.body.images[0]).not.toHaveProperty('publicId');
  });
  it('refuse les mises à jour concurrentes et protège la dernière photo publiée', async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        api()
          .patch(`/api/v1/admin/articles/${id}`)
          .auth(token, { type: 'bearer' })
          .send({ ...dto, status: 'published', version }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    version = results.find((r) => r.status === 200)!.body.version;
    await api()
      .delete(`/api/v1/admin/articles/${id}/images/${imageId}`)
      .auth(token, { type: 'bearer' })
      .expect(400);
  });
  it('sert uniquement les articles publiés ; recherche, rubrique et pagination', async () => {
    const r = await api().get('/api/v1/articles?category=reportages&q=voix&pageSize=1').expect(200);
    expect(r.body.items.some((a: { id: string }) => a.id === id)).toBe(true);
    expect(r.body.pageSize).toBe(1);
    const a = await api().get(`/api/v1/articles/${slug}`).expect(200);
    expect(a.body).not.toHaveProperty('version');
    expect(a.body).not.toHaveProperty('status');
    const filtered = await api().get('/api/v1/articles?category=analyses').expect(200);
    expect(filtered.body.items.some((a: { id: string }) => a.id === id)).toBe(false);
  });
  it('bloque toute la semaine 2 côté backend lorsque le réglage est désactivé', async () => {
    config.set('MEDIA_PUBLIC_ENABLED', false);
    await api().get('/api/v1/articles').expect(404);
    await api().get(`/api/v1/articles/${slug}`).expect(404);
    await api().get(`/api/v1/admin/articles/${id}`).auth(token, { type: 'bearer' }).expect(200);
    config.set('MEDIA_PUBLIC_ENABLED', true);
  });
  it('dépublication immédiate puis suppression durable et reprise Cloudinary', async () => {
    await api()
      .patch(`/api/v1/admin/articles/${id}`)
      .auth(token, { type: 'bearer' })
      .send({ ...dto, version })
      .expect(200);
    await api().get(`/api/v1/articles/${slug}`).expect(404);
    cloud.destroy.mockRejectedValueOnce(new Error('Provider offline'));
    await api().delete(`/api/v1/admin/articles/${id}`).auth(token, { type: 'bearer' }).expect(202);
    expect(await db.articleImage.count({ where: { id: imageId, state: 'deleting' } })).toBe(1);
    await db.articleImage.update({
      where: { id: imageId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await service.cleanup();
    expect(await db.article.findUnique({ where: { id } })).toBeNull();
  });
  it('borne les tickets concurrents et supprime les envois abandonnés', async () => {
    const a = await service.create({ ...dto, author: '' });
    ids.push(a.id);
    const calls = await Promise.allSettled(Array.from({ length: 11 }, () => service.upload(a.id)));
    expect(calls.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(await db.articleImage.count({ where: { articleId: a.id } })).toBe(10);
    await db.articleImage.updateMany({
      where: { articleId: a.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await service.cleanup();
    expect(await db.articleImage.count({ where: { articleId: a.id } })).toBe(0);
  });
});
