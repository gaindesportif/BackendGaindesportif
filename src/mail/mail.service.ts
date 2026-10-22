import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Prisma } from '../generated/prisma/client';
import { DatabaseService } from '../database/database.service';

type Payload = { to: string; subject: string; text: string };
export const GENERIC_RESET_MESSAGE =
  'Si cette adresse correspond à un compte, un lien de réinitialisation sera envoyé. Pensez à vérifier les courriers indésirables.';
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private transport?: Transporter;
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private current?: Promise<void>;
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}
  configured() {
    return Boolean(
      this.config.get<boolean>('MAIL_ENABLED') === true &&
      this.config.get<string>('SMTP_HOST') &&
      this.config.get<string>('MAIL_ENCRYPTION_KEY') &&
      this.config.get<string>('MAIL_FROM') &&
      (this.config.get<string>('SMTP_PASSWORD') || this.config.get<string>('NODE_ENV') === 'test'),
    );
  }
  requireConfigured() {
    if (!this.configured())
      throw new ServiceUnavailableException(
        'Le service e-mail est momentanément indisponible. Réessayez plus tard.',
      );
  }
  siteUrl() {
    return this.config.get<string>('CUSTOMER_SITE_URL', 'https://gaindesportif.com');
  }
  private key() {
    return Buffer.from(this.config.getOrThrow<string>('MAIL_ENCRYPTION_KEY'), 'base64');
  }
  encrypt(id: string, value: Payload) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  private decrypt(id: string, value: string): Payload {
    const data = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key(), data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    cipher.setAAD(Buffer.from(id));
    return JSON.parse(
      Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'),
    ) as Payload;
  }
  async enqueue(
    tx: Prisma.TransactionClient,
    input: {
      accountId: string;
      kind: string;
      dedupeKey: string;
      expiresAt: Date;
      message: Payload;
    },
  ) {
    this.requireConfigured();
    const id = randomUUID();
    return tx.mailOutbox.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {},
      create: {
        id,
        accountId: input.accountId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        expiresAt: input.expiresAt,
        payload: this.encrypt(id, input.message),
      },
    });
  }
  async cancelTokens(tx: Prisma.TransactionClient, accountId: string, kind: string) {
    await tx.mailOutbox.updateMany({
      where: { accountId, kind, status: { in: ['queued', 'sending'] } },
      data: { status: 'cancelled', payload: null, leaseUntil: null },
    });
  }
  private smtp() {
    this.requireConfigured();
    if (!this.transport) {
      const host = this.config.getOrThrow<string>('SMTP_HOST');
      const port = this.config.get<number>('SMTP_PORT', 465);
      const local =
        this.config.get<string>('NODE_ENV') === 'test' &&
        ['localhost', '127.0.0.1', '::1'].includes(host);
      const password = this.config.get<string>('SMTP_PASSWORD');
      this.transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        requireTLS: !local && port !== 465,
        ignoreTLS: local,
        auth: password
          ? { user: this.config.getOrThrow<string>('SMTP_USER'), pass: password }
          : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    }
    return this.transport;
  }
  async verify() {
    await this.smtp().verify();
    return { connected: true };
  }
  async processPending() {
    if (this.running || this.stopping || !this.configured()) return;
    this.running = true;
    try {
      const now = new Date();
      await this.db.mailOutbox.updateMany({
        where: { status: { in: ['queued', 'sending'] }, expiresAt: { lte: now } },
        data: { status: 'cancelled', payload: null, leaseUntil: null },
      });
      await this.db.customerEmailToken.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 86400000) } },
      });
      const candidates = await this.db.mailOutbox.findMany({
        where: {
          payload: { not: null },
          expiresAt: { gt: now },
          OR: [
            { status: 'queued', availableAt: { lte: now } },
            { status: 'sending', leaseUntil: { lte: now } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: { id: true },
      });
      for (const candidate of candidates) {
        if (this.stopping) break;
        // One atomic claim per message. A stable Message-ID also helps receivers identify retries.
        const claim = await this.db.mailOutbox.updateMany({
          where: {
            id: candidate.id,
            expiresAt: { gt: new Date() },
            payload: { not: null },
            OR: [
              { status: 'queued', availableAt: { lte: now } },
              { status: 'sending', leaseUntil: { lte: now } },
            ],
          },
          data: {
            status: 'sending',
            leaseUntil: new Date(Date.now() + 60000),
            attempts: { increment: 1 },
          },
        });
        if (!claim.count) continue;
        const mail = await this.db.mailOutbox.findUnique({ where: { id: candidate.id } });
        if (!mail?.payload) continue;
        try {
          const payload = this.decrypt(mail.id, mail.payload);
          const result = await this.smtp().sendMail({
            from: { name: 'Gaindé Sportif', address: this.config.getOrThrow<string>('MAIL_FROM') },
            to: payload.to,
            subject: payload.subject,
            text: payload.text,
            messageId: `<${mail.id}@gaindesportif.com>`,
            headers: { 'Auto-Submitted': 'auto-generated' },
          });
          if (!result.accepted?.length) throw new Error('recipient_rejected');
          await this.db.mailOutbox.updateMany({
            where: { id: mail.id, status: 'sending' },
            data: {
              status: 'sent',
              sentAt: new Date(),
              payload: null,
              leaseUntil: null,
              lastError: null,
            },
          });
        } catch {
          const exhausted = mail.attempts >= 6;
          await this.db.mailOutbox.updateMany({
            where: { id: mail.id, status: 'sending' },
            data: {
              status: exhausted ? 'failed' : 'queued',
              payload: exhausted ? null : mail.payload,
              leaseUntil: null,
              lastError: 'smtp_delivery_failed',
              availableAt: new Date(Date.now() + Math.min(3600, 60 * 2 ** mail.attempts) * 1000),
            },
          });
        }
      }
      // Retain a small delivery audit, never the link/recipient payload after completion.
      await this.db.mailOutbox.deleteMany({
        where: {
          status: { in: ['sent', 'failed', 'cancelled'] },
          createdAt: { lt: new Date(Date.now() - 30 * 86400000) },
        },
      });
    } finally {
      this.running = false;
    }
  }
  onModuleInit() {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      this.current = this.processPending().catch(() => {});
    }, 5000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.current;
    this.transport?.close();
  }
}
