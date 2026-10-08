import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { validateEnvironment } from '../src/config/environment';

// Test local explicite. Une seule ligne synthétique, vérifiée puis supprimée.
async function main() {
  const frontend = process.env.SMOKE_FRONTEND_URL || 'http://localhost:3000';
  if (!['localhost', '127.0.0.1'].includes(new URL(frontend).hostname))
    throw new Error('Test réservé au frontend local.');
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: validateEnvironment(process.env).DATABASE_URL,
        connectionTimeoutMillis: 10000,
      },
      { schema: 'gainde_v1' },
    ),
  });
  const marker = `Test technique semaine 1 — ${randomUUID()}`;
  const requestKey = randomUUID();
  const payload = JSON.stringify({
    name: 'Test technique',
    email: 'technical-smoke@example.com',
    phone: '+221770000000',
    subject: 'autre',
    message: marker,
    consent: true,
    website: '',
  });
  let id: string | undefined;
  try {
    const response = await fetch(`${frontend}/api/contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: frontend,
        'Idempotency-Key': requestKey,
      },
      body: payload,
      signal: AbortSignal.timeout(20000),
    });
    if (response.status !== 201) throw new Error(`HTTP ${response.status}`);
    const result = (await response.json()) as { reference: string };
    id = result.reference;
    const record = await prisma.contactRequest.findUnique({ where: { id } });
    if (record?.message !== marker || record.email !== 'technical-smoke@example.com')
      throw new Error('Données enregistrées inattendues.');
    console.log('Parcours vérifié : Next → Nest → Prisma → Neon → confirmation.');
    const retry = await fetch(`${frontend}/api/contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: frontend,
        'Idempotency-Key': requestKey,
      },
      body: payload,
      signal: AbortSignal.timeout(20000),
    });
    if (retry.status !== 201 || ((await retry.json()) as { reference: string }).reference !== id)
      throw new Error('Retry non confirmé.');
    if (
      (await prisma.contactRequest.count({
        where: { email: 'technical-smoke@example.com', message: marker },
      })) !== 1
    )
      throw new Error('Doublon inattendu.');
    console.log('Retry identique confirmé sans créer de doublon.');
  } finally {
    const deleted = await prisma.contactRequest.deleteMany({
      where: { ...(id ? { id } : {}), email: 'technical-smoke@example.com', message: marker },
    });
    console.log(`${deleted.count} contact synthétique supprimé après le test.`);
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  const code =
    typeof error?.code === 'string' && /^[A-Z0-9_]{2,30}$/.test(error.code)
      ? error.code
      : 'non_code';
  console.error(`Diagnostic de test : ${error?.name || 'Error'} / ${code}`);
  console.error(
    error instanceof Error && /^HTTP \d{3}$/.test(error.message)
      ? error.message
      : 'Test de contact interrompu. Aucun secret affiché.',
  );
  process.exitCode = 1;
});
