import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { CloudinaryService } from './cloudinary.service';
const config = new ConfigService({
  CLOUDINARY_CLOUD_NAME: 'test_cloud',
  CLOUDINARY_API_KEY: '123456',
  CLOUDINARY_API_SECRET: 'test_secret_only',
});
describe('transport Cloudinary (réponses simulées)', () => {
  const service = new CloudinaryService(config);
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchMock.mockRestore();
  });
  it('signe un publicId imposé, un format borné et overwrite=false sans exposer API secret', () => {
    const response = service.signature('gainde-sportif/products/test/unique', 'image');
    const signed = Object.keys(response.fields)
      .filter((key) => !['api_key', 'signature'].includes(key))
      .sort()
      .map((key) => `${key}=${response.fields[key]}`)
      .join('&');
    expect(response.fields.signature).toBe(
      createHash('sha1')
        .update(signed + 'test_secret_only')
        .digest('hex'),
    );
    expect(response.fields.overwrite).toBe('false');
    expect(JSON.stringify(response)).not.toContain('test_secret_only');
    expect(response.uploadUrl).toBe('https://api.cloudinary.com/v1_1/test_cloud/image/upload');
  });
  it('reste explicite sans configuration et refuse de signer', () => {
    const unavailable = new CloudinaryService(new ConfigService({}));
    expect(unavailable.configuration().configured).toBe(false);
    expect(() => unavailable.signature('test', 'image')).toThrow('Cloudinary');
  });
  it('vérifie par Admin API puis refuse type, URL et taille falsifiés', async () => {
    const asset = {
      public_id: 'ticket',
      resource_type: 'image',
      type: 'upload',
      format: 'webp',
      bytes: 2000,
      width: 800,
      height: 600,
      secure_url: 'https://res.cloudinary.com/test_cloud/image/upload/ticket.webp',
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(asset), { status: 200 }));
    await expect(service.verify('ticket', 'image')).resolves.toMatchObject({
      bytes: 2000,
      format: 'webp',
    });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/resources/image/upload/ticket');
    expect(options.headers).toEqual({ Authorization: expect.stringMatching(/^Basic /) });
    for (const patch of [
      { bytes: 999999999 },
      { resource_type: 'raw' },
      { public_id: 'other-product' },
      { secure_url: 'https://example.com/fake.jpg' },
      { format: 'svg' },
    ]) {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ ...asset, ...patch }), { status: 200 }),
      );
      await expect(service.verify('ticket', 'image')).rejects.toThrow('non autorisé');
    }
  });
  it('destroy invalide le CDN et traite not found de manière idempotente', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ result: 'not found' }), { status: 200 }),
    );
    await expect(service.destroy('ticket', 'video')).resolves.toBeUndefined();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/video/destroy');
    expect((options.body as URLSearchParams).get('invalidate')).toBe('true');
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(service.destroy('ticket', 'image')).rejects.toThrow('en attente');
  });
  it('supprime aussi les extensions raw sous le préfixe exact du ticket et conserve les échecs', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ deleted: { 'ticket.jpg': 'deleted' }, partial: false }), {
        status: 200,
      }),
    );
    await expect(service.destroyRawPrefix('ticket')).resolves.toBeUndefined();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/resources/raw/upload?prefix=ticket&invalidate=true');
    expect(options.method).toBe('DELETE');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ deleted: { 'ticket.jpg': 'error' } }), { status: 200 }),
    );
    await expect(service.destroyRawPrefix('ticket')).rejects.toThrow('en attente');
  });
});
