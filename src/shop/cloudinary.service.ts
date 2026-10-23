import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

export const MEDIA_LIMITS = {
  maxImageBytes: 10 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
  maxMedia: 10,
  maxImages: 10,
  maxVideos: 0,
};
export type ResourceType = 'image' | 'video';
export type VerifiedAsset = {
  secureUrl: string;
  bytes: number;
  format: string;
  width: number;
  height: number;
  duration: number | null;
};
@Injectable()
export class CloudinaryService {
  constructor(private readonly config: ConfigService) {}
  configured() {
    return (
      !!this.config.get<string>('CLOUDINARY_CLOUD_NAME') &&
      !!this.config.get<string>('CLOUDINARY_API_KEY') &&
      !!this.config.get<string>('CLOUDINARY_API_SECRET')
    );
  }
  configuration() {
    return { configured: this.configured(), ...MEDIA_LIMITS };
  }
  signature(
    publicId: string,
    type: ResourceType,
  ): { uploadUrl: string; fields: Record<string, string>; maxBytes: number } {
    if (type !== 'image') throw new BadRequestException('Seules les photos sont autorisées.');
    this.requireConfigured();
    const fields: Record<string, string> = {
      timestamp: String(Math.floor(Date.now() / 1000)),
      public_id: publicId,
      overwrite: 'false',
      allowed_formats: type === 'image' ? 'jpg,jpeg,png,webp,avif,gif' : 'mp4,webm,mov,m4v',
    };
    return {
      uploadUrl: `${this.base()}/${type}/upload`,
      fields: {
        ...fields,
        api_key: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
        signature: this.sign(fields),
      },
      maxBytes: type === 'image' ? MEDIA_LIMITS.maxImageBytes : MEDIA_LIMITS.maxVideoBytes,
    };
  }
  async verify(publicId: string, type: ResourceType): Promise<VerifiedAsset> {
    this.requireConfigured();
    const credentials = Buffer.from(
      `${this.config.getOrThrow<string>('CLOUDINARY_API_KEY')}:${this.config.getOrThrow<string>('CLOUDINARY_API_SECRET')}`,
    ).toString('base64');
    let response: Response;
    try {
      response = await fetch(
        `${this.base()}/resources/${type}/upload/${encodeURIComponent(publicId)}`,
        { headers: { Authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(12000) },
      );
    } catch {
      throw new ServiceUnavailableException('Vérification du média indisponible. Réessayez.');
    }
    if (response.status === 404)
      throw new BadRequestException(
        'Le fichier téléversé reste introuvable. Réessayez après son envoi.',
      );
    if (!response.ok)
      throw new ServiceUnavailableException('Vérification du média indisponible. Réessayez.');
    let asset: Record<string, unknown>;
    try {
      asset = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException('Réponse média indisponible.');
    }
    const allowed =
      type === 'image'
        ? ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']
        : ['mp4', 'webm', 'mov', 'm4v'];
    const maxBytes = type === 'image' ? MEDIA_LIMITS.maxImageBytes : MEDIA_LIMITS.maxVideoBytes;
    let validUrl = false;
    try {
      const url = new URL(String(asset.secure_url));
      validUrl =
        url.protocol === 'https:' &&
        url.hostname === 'res.cloudinary.com' &&
        url.pathname.startsWith(`/${this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME')}/`);
    } catch {
      /* Invalid provider response. */
    }
    if (
      asset.public_id !== publicId ||
      asset.resource_type !== type ||
      asset.type !== 'upload' ||
      !allowed.includes(String(asset.format)) ||
      !Number.isInteger(asset.bytes) ||
      Number(asset.bytes) <= 0 ||
      Number(asset.bytes) > maxBytes ||
      !validUrl ||
      !Number.isInteger(asset.width) ||
      !Number.isInteger(asset.height)
    ) {
      throw new BadRequestException('Type, format ou taille du média non autorisé.');
    }
    return {
      secureUrl: String(asset.secure_url),
      bytes: Number(asset.bytes),
      format: String(asset.format),
      width: Number(asset.width),
      height: Number(asset.height),
      duration: typeof asset.duration === 'number' ? asset.duration : null,
    };
  }
  async destroy(publicId: string, type: ResourceType) {
    this.requireConfigured();
    const fields = {
      public_id: publicId,
      invalidate: 'true',
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const body = new URLSearchParams({
      ...fields,
      api_key: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      signature: this.sign(fields),
    });
    let response: Response;
    try {
      response = await fetch(`${this.base()}/${type}/destroy`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new ServiceUnavailableException('Suppression du média en attente.');
    }
    if (!response.ok) throw new ServiceUnavailableException('Suppression du média en attente.');
    const result = (await response.json()) as { result?: string };
    if (result.result !== 'ok' && result.result !== 'not found')
      throw new ServiceUnavailableException('Suppression du média en attente.');
  }
  async destroyRawPrefix(publicId: string) {
    this.requireConfigured();
    // Raw assets include their extension in public_id. This UUID prefix belongs to one ticket only.
    const credentials = Buffer.from(
      `${this.config.getOrThrow<string>('CLOUDINARY_API_KEY')}:${this.config.getOrThrow<string>('CLOUDINARY_API_SECRET')}`,
    ).toString('base64');
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const query = new URLSearchParams({
        prefix: publicId,
        invalidate: 'true',
        ...(cursor ? { next_cursor: cursor } : {}),
      });
      let response: Response;
      try {
        response = await fetch(`${this.base()}/resources/raw/upload?${query}`, {
          method: 'DELETE',
          headers: { Authorization: `Basic ${credentials}` },
          signal: AbortSignal.timeout(12000),
        });
      } catch {
        throw new ServiceUnavailableException('Suppression du média en attente.');
      }
      if (!response.ok) throw new ServiceUnavailableException('Suppression du média en attente.');
      const result = (await response.json()) as {
        deleted?: Record<string, string>;
        partial?: boolean;
        next_cursor?: string;
      };
      if (
        !result.deleted ||
        Object.values(result.deleted).some((status) => !['deleted', 'not_found'].includes(status))
      )
        throw new ServiceUnavailableException('Suppression du média en attente.');
      if (!result.partial) return;
      if (!result.next_cursor)
        throw new ServiceUnavailableException('Suppression du média en attente.');
      cursor = result.next_cursor;
    }
    throw new ServiceUnavailableException('Suppression du média en attente.');
  }
  private base() {
    return `https://api.cloudinary.com/v1_1/${this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME')}`;
  }
  private requireConfigured() {
    if (!this.configured())
      throw new ServiceUnavailableException(
        'Cloudinary n’est pas encore configuré. Les brouillons restent disponibles.',
      );
  }
  private sign(fields: Record<string, string>) {
    return createHash('sha1')
      .update(
        Object.keys(fields)
          .sort()
          .map((key) => `${key}=${fields[key]}`)
          .join('&') + this.config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
      )
      .digest('hex');
  }
}
