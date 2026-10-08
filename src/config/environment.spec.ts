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
