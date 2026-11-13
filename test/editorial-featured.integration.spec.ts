import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseService } from '../src/database/database.service';
import { CloudinaryService } from '../src/shop/cloudinary.service';
import { EditorialService } from '../src/editorial/editorial.service';
import { hashPassword } from '../src/admin/password';
import { configureApp } from '../src/bootstrap';
const url = process.env.DATABASE_TEST_URL;
(url ? describe : describe.skip)('Gaindé Media — une unique et publication concurrente', () => {
  let app: INestApplication, db: DatabaseService, service: EditorialService, token: string;
  let a: Awaited<ReturnType<EditorialService['get']>>, b: typeof a, draft: typeof a;
  const ids: string[] = [];
  const username = `featured-test-${Date.now()}`;
  const marker = `UNE LOCALE ${Date.now()}`;
  const cloud = {
    signature: () => ({
      uploadUrl: 'https://api.cloudinary.com/v1_1/test/image/upload',
      fields: {},
      maxBytes: 10485760,
    }),
    verify: async (publicId: string) => ({
      secureUrl: `https://res.cloudinary.com/test/image/upload/${publicId}.jpg`,
      bytes: 100,
      width: 800,
      height: 500,
      format: 'jpg',
      duration: null,
    }),
    destroy: async () => undefined,
  };
  const api = () => request(app.getHttpServer());
  const fields = (x: typeof a) => ({
    title: x.title,
    excerpt: x.excerpt,
    body: x.body,
    category: x.category,
    author: x.author,
    status: 'published',
    version: x.version,
  });
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
    await db.adminAccount.create({
      data: {
        username,
        displayName: 'Rédaction test',
        passwordHash: await hashPassword('local-feature-test-123'),
        role: 'admin',
      },
    });
    const r = await api()
      .post('/api/v1/admin/auth/login')
      .send({ username, password: 'local-feature-test-123' })
      .expect(200);
    token = r.body.token;
  });
  afterAll(async () => {
    if (!db) return;
    await db.articleImage.deleteMany({ where: { articleId: { in: ids } } });
    await db.article.deleteMany({ where: { id: { in: ids } } });
    await db.adminAccount.deleteMany({ where: { username } });
    await app.close();
  });
  async function create(title: string, featured = false) {
    const r = await api()
      .post('/api/v1/admin/articles')
      .auth(token, { type: 'bearer' })
      .send({
        title,
        body: 'Un récit réservé aux essais.',
        category: 'actualites',
        status: 'draft',
        featured,
      })
      .expect(201);
    ids.push(r.body.id);
    const ticket = await service.upload(r.body.id);
    return service.confirm(r.body.id, ticket.id, { alt: '', caption: '', credit: '' });
  }
  it('valide la case, garde le brouillon privé, et place la une avant un article plus récent', async () => {
    await api().post('/api/v1/admin/articles').send({}).expect(401);
    await api()
      .post('/api/v1/admin/articles')
      .auth(token, { type: 'bearer' })
      .send({
        title: marker,
        body: 'texte',
        category: 'actualites',
        status: 'draft',
        featured: 'true',
      })
      .expect(400);
    a = await create(`${marker} — premier`, true);
    b = await create(`${marker} — second`);
    draft = await create(`${marker} — brouillon`, true);
    expect(draft.featured).toBe(true);
    await api().get(`/api/v1/articles/${draft.slug}`).expect(404);
    a = await service.update(a.id, fields(a));
    b = await service.update(b.id, fields(b));
    const r = await api().get('/api/v1/articles').query({ q: marker, pageSize: 1 }).expect(200);
    expect(r.body.items[0].id).toBe(a.id);
    expect(r.body.items[0].featured).toBe(true);
    expect(r.body.total).toBe(2);
    const detail = await api().get(`/api/v1/articles/${a.slug}`).expect(200);
    expect(detail.body.featured).toBe(true);
  });
  it('remplace la une et refuse un formulaire périmé sans enlever le nouveau choix', async () => {
    const staleA = a.version;
    const r = await api()
      .patch(`/api/v1/admin/articles/${b.id}`)
      .auth(token, { type: 'bearer' })
      .send({ ...fields(b), featured: true })
      .expect(200);
    b = r.body;
    a = await service.get(a.id);
    expect(a.featured).toBe(false);
    expect(a.version).toBeGreaterThan(staleA);
    await api()
      .patch(`/api/v1/admin/articles/${a.id}`)
      .auth(token, { type: 'bearer' })
      .send({ ...fields(a), version: staleA, featured: true })
      .expect(409);
    expect((await service.get(b.id)).featured).toBe(true);
    // Clients which omit the new field must preserve the current front-page choice.
    b = await service.update(b.id, fields(b));
    expect(b.featured).toBe(true);
  });
  it('garantit une seule une avec deux choix simultanés et une contrainte SQL', async () => {
    b = await service.update(b.id, { ...fields(b), featured: false });
    a = await service.get(a.id);
    const results = await Promise.all([
      service.update(a.id, { ...fields(a), featured: true }),
      service.update(b.id, { ...fields(b), featured: true }),
    ]);
    expect(results).toHaveLength(2);
    expect(await db.article.count({ where: { status: 'published', featured: true } })).toBe(1);
    await expect(
      db.article.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { featured: true } }),
    ).rejects.toThrow();
    expect(await db.article.count({ where: { status: 'published', featured: true } })).toBe(1);
  });
  it('retire la une de la lecture après dépublication ou suppression, sans promouvoir un brouillon', async () => {
    const current = await db.article.findFirstOrThrow({
      where: { status: 'published', featured: true },
    });
    await service.update(current.id, { ...fields(current as typeof a), status: 'draft' });
    const r = await api().get('/api/v1/articles').query({ q: marker }).expect(200);
    expect(r.body.items.every((x: { featured: boolean }) => !x.featured)).toBe(true);
    const other = await service.get(current.id === a.id ? b.id : a.id);
    await service.update(other.id, { ...fields(other), featured: true });
    await service.remove(other.id);
    expect(await db.article.count({ where: { status: 'published', featured: true } })).toBe(0);
    await api().get(`/api/v1/articles/${draft.slug}`).expect(404);
  });
});
