import { hashPassword, verifyPassword } from './password';
describe('mots de passe administrateurs', () => {
  it('utilise scrypt avec sels distincts et rejette les hashes invalides', async () => {
    const first = await hashPassword('test-password-long');
    const second = await hashPassword('test-password-long');
    expect(first).not.toBe(second);
    expect(first).not.toContain('test-password-long');
    expect(await verifyPassword('test-password-long', first)).toBe(true);
    expect(await verifyPassword('incorrect', first)).toBe(false);
    expect(await verifyPassword('anything', 'invalid')).toBe(false);
  });
});
