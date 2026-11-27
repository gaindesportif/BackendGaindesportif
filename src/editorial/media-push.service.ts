import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { sendNotification, WebPushError, type RequestOptions } from 'web-push';
import { DatabaseService } from '../database/database.service';
import type { Prisma } from '../generated/prisma/client';

const providers: Readonly<Record<string, string>> = {
  'fcm.googleapis.com': '/fcm/send/',
  'updates.push.services.mozilla.com': '/wpush/',
  'web.push.apple.com': '/',
  'wns2-par01p.notify.windows.com': '/w/',
};
const encoded = /^[A-Za-z0-9_-]+$/;
const digest = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

function allowedEndpoint(endpoint: string) {
  if (endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const path =
      providers[url.hostname] ??
      (/^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname) ? '/w/' : undefined);
    return Boolean(
      path &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.pathname.startsWith(path) &&
      url.pathname.length > path.length,
    );
  } catch {
    return false;
  }
}

type Claim = { articleId: string; subscriptionId: string; attempts: number };

/** Abonnements par navigateur et file durable déclenchée par une première publication. */
@Injectable()
export class MediaPushService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private sending?: Promise<void>;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private get vapid(): RequestOptions['vapidDetails'] {
    const publicKey = this.config.get<string>('MEDIA_PUSH_PUBLIC_KEY');
    const privateKey = this.config.get<string>('MEDIA_PUSH_PRIVATE_KEY');
    const subject = this.config.get<string>('MEDIA_PUSH_SUBJECT');
    if (this.config.get('MEDIA_PUBLIC_ENABLED') === true && publicKey && privateKey && subject)
      return { publicKey, privateKey, subject };
  }

  publicConfig() {
    return { publicKey: this.vapid?.publicKey ?? null };
  }

  async subscribe(endpoint: string, auth: string, p256dh: string) {
    if (!this.vapid) throw new ServiceUnavailableException('Notifications indisponibles.');
    if (
      !allowedEndpoint(endpoint) ||
      !encoded.test(auth) ||
      !encoded.test(p256dh) ||
      auth.length !== 22 ||
      p256dh.length !== 87 ||
      Buffer.from(p256dh, 'base64url')[0] !== 4
    ) {
      throw new BadRequestException('Abonnement Web Push invalide.');
    }
    const id = digest(endpoint);
    await this.db.mediaPushSubscription.upsert({
      where: { id },
      create: { id, endpoint, auth, p256dh },
      update: { auth, p256dh },
    });
  }

  async unsubscribe(endpoint: string, auth: string) {
    if (allowedEndpoint(endpoint) && auth.length === 22 && encoded.test(auth)) {
      await this.db.mediaPushSubscription.deleteMany({ where: { id: digest(endpoint), auth } });
    }
  }

  async enqueue(tx: Prisma.TransactionClient, articleId: string) {
    if (!this.vapid) return;
    await tx.$executeRaw`
      INSERT INTO gainde_v1.media_push_deliveries (article_id, subscription_id, expires_at)
      SELECT ${articleId}::uuid, id, now() + interval '24 hours'
      FROM gainde_v1.media_push_subscriptions
      ON CONFLICT DO NOTHING
    `;
  }

  onModuleInit() {
    if (this.vapid && this.config.get('NODE_ENV') !== 'test') {
      this.timer = setInterval(() => void this.dispatch().catch(() => undefined), 15000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    return this.sending;
  }

  dispatch() {
    if (!this.sending)
      this.sending = this.sendBatch().finally(() => {
        this.sending = undefined;
      });
    return this.sending;
  }

  private async sendBatch() {
    const vapidDetails = this.vapid;
    if (!vapidDetails) return;
    await this.db.mediaPushDelivery.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const jobs = await this.db.$queryRaw<Claim[]>`
      WITH ready AS (
        SELECT article_id, subscription_id FROM gainde_v1.media_push_deliveries
        WHERE next_attempt_at <= now() AND expires_at > now()
        ORDER BY next_attempt_at
        LIMIT 20 FOR UPDATE SKIP LOCKED
      )
      UPDATE gainde_v1.media_push_deliveries AS d
      SET next_attempt_at = now() + interval '2 minutes', attempts = d.attempts + 1
      FROM ready WHERE d.article_id = ready.article_id AND d.subscription_id = ready.subscription_id
      RETURNING d.article_id AS "articleId", d.subscription_id AS "subscriptionId", d.attempts
    `;
    await Promise.all(
      jobs.map(async ({ articleId, subscriptionId, attempts }) => {
        const where = { articleId, subscriptionId, attempts };
        const job = await this.db.mediaPushDelivery.findFirst({
          where,
          include: {
            subscription: true,
            article: { select: { slug: true, title: true, status: true } },
          },
        });
        if (!job) return;
        const { subscription, article } = job;
        if (article.status === 'published' && allowedEndpoint(subscription.endpoint)) {
          try {
            await sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              JSON.stringify({ title: article.title, path: '/media/' + article.slug }),
              {
                vapidDetails,
                TTL: Math.max(0, Math.floor((job.expiresAt.getTime() - Date.now()) / 1000)),
                timeout: 8000,
              },
            );
          } catch (error) {
            const status = error instanceof WebPushError ? error.statusCode : 0;
            if (status === 404 || status === 410) {
              await this.db.mediaPushSubscription.deleteMany({
                where: { id: subscriptionId, auth: subscription.auth },
              });
              return;
            }
            if (attempts < 5 && (!status || status >= 500 || status === 429)) {
              await this.db.mediaPushDelivery.updateMany({
                where,
                data: { nextAttemptAt: new Date(Date.now() + 60000 * 2 ** attempts) },
              });
              return;
            }
          }
        }
        await this.db.mediaPushDelivery.deleteMany({ where });
      }),
    );
  }
}
