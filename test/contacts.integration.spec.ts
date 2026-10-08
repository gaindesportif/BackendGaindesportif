import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DatabaseService } from '../src/database/database.service';

describe('API HTTP (base simulée, aucune donnée Neon)', () => {
  let app: INestApplication;
  const create = jest.fn().mockResolvedValue({ id: 'test' });
  const valid = {
    name: 'Équipe test',
    email: 'test@example.com',
    phone: '+221770000000',
    subject: 'autre',
    message: 'Une demande de test.',
    consent: true,
    website: '',
  };
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ contactRequest: { create, findFirst: jest.fn().mockResolvedValue(null) } })
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('expose la santé sans secret et protège les headers', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(r.body).toEqual({ status: 'ok', service: 'gainde-backend' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
  it('rejette données invalides, champs inattendus et honeypot', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .send({ ...valid, consent: false })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .send({ ...valid, role: 'admin' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .send({ ...valid, website: 'spam' })
      .expect(400);
  });
  it('enregistre et limite les soumissions répétées', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/contacts').send(valid).expect(201);
    expect(r.body.reference).toBeDefined();
    await request(app.getHttpServer()).post('/api/v1/contacts').send(valid).expect(201);
    await request(app.getHttpServer()).post('/api/v1/contacts').send(valid).expect(429);
  });
});
