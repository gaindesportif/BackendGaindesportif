import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
export async function hashPassword(password: string) {
  const salt = randomBytes(24).toString('hex');
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [version, salt, hash] = encoded.split(':');
  if (
    version !== 'scrypt-v1' ||
    !/^[a-f0-9]{48}$/.test(salt || '') ||
    !/^[a-f0-9]{128}$/.test(hash || '')
  )
    return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, 'hex'));
}
