import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { randomUUID } from 'node:crypto';

const run = process.env.DATABASE_TEST_URL ? describe : describe.skip;
run('Prisma ↔ PostgreSQL de test (transaction annulée)', () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: process.env.DATABASE_TEST_URL! },
        { schema: 'gainde_v1' },
      ),
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it('crée et relit un contact puis annule sa transaction', async () => {
    const id = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.contactRequest.create({
          data: {
            id,
            name: 'Test technique',
            email: 'test@example.com',
            phone: '+221770000000',
            subject: 'autre',
            message: 'Test intégration, transaction annulée.',
            consentAt: new Date(),
          },
        });
        const found = await tx.contactRequest.findUnique({ where: { id } });
        expect(found?.status).toBe('new');
        expect(found?.name).toBe('Test technique');
        throw new Error('rollback-technique');
      }),
    ).rejects.toThrow('rollback-technique');
    expect(await prisma.contactRequest.findUnique({ where: { id } })).toBeNull();
  });
});
