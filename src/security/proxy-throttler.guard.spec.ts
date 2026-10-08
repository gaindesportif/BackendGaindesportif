import { createHmac } from 'node:crypto';
import { ProxyThrottlerGuard } from './proxy-throttler.guard';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
class ExposedGuard extends ProxyThrottlerGuard {
  tracker(req: Record<string, unknown>) {
    return this.getTracker(req);
  }
}
describe('limitation signée par visiteur', () => {
  const secret = 'test-only-proxy-secret-at-least-32-characters';
  const guard = new ExposedGuard([], new ThrottlerStorageService(), new Reflector());
  afterEach(() => {
    delete process.env.CONTACT_PROXY_SECRET;
  });
  function request(signature: string, timestamp = String(Date.now())) {
    const headers: Record<string, string> = {
      'x-gainde-client-ip': '192.0.2.10',
      'x-gainde-timestamp': timestamp,
      'x-gainde-signature': signature,
    };
    return { ip: '127.0.0.1', get: (name: string) => headers[name] };
  }
  it('ignore une IP publique non signée', async () => {
    process.env.CONTACT_PROXY_SECRET = secret;
    expect(await guard.tracker(request('invalid'))).toBe('127.0.0.1');
  });
  it('accepte une signature récente du serveur', async () => {
    process.env.CONTACT_PROXY_SECRET = secret;
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', secret).update(`192.0.2.10:${timestamp}`).digest('hex');
    expect(await guard.tracker(request(signature, timestamp))).toBe('192.0.2.10');
  });
  it('rejette une signature périmée', async () => {
    process.env.CONTACT_PROXY_SECRET = secret;
    const timestamp = String(Date.now() - 120000);
    const signature = createHmac('sha256', secret).update(`192.0.2.10:${timestamp}`).digest('hex');
    expect(await guard.tracker(request(signature, timestamp))).toBe('127.0.0.1');
  });
});
