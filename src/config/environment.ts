import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => /^postgres(?:ql)?:\/\//.test(v)),
  FRONTEND_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  CONTACT_PROXY_SECRET: z.string().min(32).optional(),
});

export function validateEnvironment(input: Record<string, unknown>) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Configuration invalide : ${result.error.issues.map((i) => i.path.join('.')).join(', ')}. Vérifiez votre .env.`,
    );
  }
  const origins = result.data.FRONTEND_ORIGINS.split(',').map((v) => v.trim());
  if (
    origins.some((v) => {
      try {
        const u = new URL(v);
        return u.origin !== v || (result.data.NODE_ENV === 'production' && u.protocol !== 'https:');
      } catch {
        return true;
      }
    })
  ) {
    throw new Error('FRONTEND_ORIGINS doit contenir des origines exactes (HTTPS en production).');
  }
  return result.data;
}
