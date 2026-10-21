import { validateEnvironment } from './environment';
describe('configuration', () => {
  const base = { DATABASE_URL: 'postgresql://user:password@localhost/db' };
  it('définit des valeurs locales sûres', () =>
    expect(validateEnvironment(base).TRUST_PROXY_HOPS).toBe(0));
  it('rejette une URL de base invalide sans afficher le secret', () =>
    expect(() => validateEnvironment({ DATABASE_URL: 'secret' })).toThrow('DATABASE_URL'));
  it('exige HTTPS en production', () =>
    expect(() => validateEnvironment({ ...base, NODE_ENV: 'production' })).toThrow('HTTPS'));
});

describe('configuration e-mail', () => {
  const base = { DATABASE_URL: 'postgresql://user:password@localhost/test' };
  const mail = {
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: 465,
    SMTP_USER: 'gaindesportif@gmail.com',
    SMTP_PASSWORD: 'synthetic-app-password-only',
    MAIL_FROM: 'gaindesportif@gmail.com',
    MAIL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  };
  it('accepte le compte expéditeur sur TLS et refuse une configuration partielle ou détournée', () => {
    expect(validateEnvironment({ ...base, ...mail }).SMTP_PORT).toBe(465);
    for (const change of [
      { SMTP_HOST: 'other.example.test' },
      { SMTP_PORT: 1025 },
      { MAIL_FROM: 'other@example.test' },
      { SMTP_USER: 'other@example.test' },
      { MAIL_ENCRYPTION_KEY: 'invalid' },
      { SMTP_PASSWORD: undefined },
    ])
      expect(() => validateEnvironment({ ...base, ...mail, ...change })).toThrow();
  });
  it('autorise le SMTP local uniquement pour les tests et exige une origine sans chemin', () => {
    expect(
      validateEnvironment({
        ...base,
        NODE_ENV: 'test',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: 1025,
        MAIL_FROM: 'local@example.test',
        MAIL_ENCRYPTION_KEY: mail.MAIL_ENCRYPTION_KEY,
      }).SMTP_PORT,
    ).toBe(1025);
    expect(() =>
      validateEnvironment({ ...base, CUSTOMER_SITE_URL: 'https://gaindesportif.com/evil' }),
    ).toThrow();
  });
});
