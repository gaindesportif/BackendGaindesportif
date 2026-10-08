import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

// L'IP transmise par Next est acceptée seulement si son empreinte est signée.
// On ne fait jamais confiance à un X-Forwarded-For public arbitraire.
@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    const secret = process.env.CONTACT_PROXY_SECRET;
    const ip = request.get('x-gainde-client-ip') || '';
    const timestamp = request.get('x-gainde-timestamp') || '';
    const signature = request.get('x-gainde-signature') || '';
    if (
      secret &&
      isIP(ip) &&
      /^\d{13}$/.test(timestamp) &&
      Math.abs(Date.now() - Number(timestamp)) < 60000 &&
      /^[a-f0-9]{64}$/.test(signature)
    ) {
      const expected = createHmac('sha256', secret).update(`${ip}:${timestamp}`).digest();
      if (timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return ip;
    }
    return super.getTracker(req);
  }
}
