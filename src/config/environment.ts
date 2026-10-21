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
  CLOUDINARY_CLOUD_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  CLOUDINARY_API_KEY: z
    .string()
    .regex(/^[0-9]+$/)
    .optional(),
  CLOUDINARY_API_SECRET: z.string().min(12).optional(),
  CONTACT_PROXY_SECRET: z.string().min(32).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce
    .number()
    .int()
    .refine((v) => [465, 587, 1025].includes(v))
    .default(465),
  SMTP_USER: z.email().optional(),
  SMTP_PASSWORD: z.string().min(12).optional(),
  MAIL_FROM: z.email().optional(),
  MAIL_ENCRYPTION_KEY: z
    .string()
    .refine((v) => /^[A-Za-z0-9+/]{43}=$/.test(v) && Buffer.from(v, 'base64').length === 32)
    .optional(),
  CUSTOMER_SITE_URL: z.url().default('https://gaindesportif.com'),
});

export function validateEnvironment(input: Record<string, unknown>) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Configuration invalide : ${result.error.issues.map((i) => i.path.join('.')).join(', ')}. Vérifiez votre .env.`,
    );
  }
  const cloudinaryCount = [
    result.data.CLOUDINARY_CLOUD_NAME,
    result.data.CLOUDINARY_API_KEY,
    result.data.CLOUDINARY_API_SECRET,
  ].filter(Boolean).length;
  if (cloudinaryCount !== 0 && cloudinaryCount !== 3)
    throw new Error('Cloudinary : renseignez les trois variables ou laissez-les absentes.');
  const mail = result.data;
  const site = new URL(mail.CUSTOMER_SITE_URL);
  if (
    site.origin !== mail.CUSTOMER_SITE_URL ||
    site.username ||
    site.password ||
    (mail.NODE_ENV === 'production' && site.protocol !== 'https:')
  )
    throw new Error('CUSTOMER_SITE_URL doit être une origine exacte, HTTPS en production.');
  const mailValues = [mail.SMTP_HOST, mail.MAIL_FROM, mail.MAIL_ENCRYPTION_KEY];
  if (mailValues.some(Boolean)) {
    const local =
      mail.NODE_ENV === 'test' && ['localhost', '127.0.0.1', '::1'].includes(mail.SMTP_HOST || '');
    if (!mailValues.every(Boolean) || (!local && (!mail.SMTP_USER || !mail.SMTP_PASSWORD)))
      throw new Error('Configuration e-mail incomplète.');
    if (
      !local &&
      (mail.SMTP_HOST !== 'smtp.gmail.com' ||
        ![465, 587].includes(mail.SMTP_PORT) ||
        mail.SMTP_USER !== 'gaindesportif@gmail.com' ||
        mail.MAIL_FROM !== mail.SMTP_USER)
    )
      throw new Error('Utilisez le compte Gmail expéditeur configuré et SMTP chiffré.');
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
