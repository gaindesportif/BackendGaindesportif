import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import type { AuthenticatedAdmin } from '../admin/admin.service';
import type { CustomerRequestStatus } from '../generated/prisma/client';
import { CustomerRequestStatusDto } from './customer.dto';
const transitions: Record<CustomerRequestStatus, readonly CustomerRequestStatus[]> = {
  prepared: ['received', 'cancelled'],
  received: ['shipped', 'delivered', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};
const labels: Record<CustomerRequestStatus, string> = {
  prepared: 'Demande préparée',
  received: 'Demande reçue',
  shipped: 'Produit expédié',
  delivered: 'Produit livré',
  cancelled: 'Demande annulée',
};
@Injectable()
export class CustomerManagementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly mail: MailService,
  ) {}
  async list(page?: string) {
    if (page && (!/^\d{1,5}$/.test(page) || Number(page) < 1))
      throw new BadRequestException('Page invalide.');
    const current = Number(page || 1);
    const [entries, total] = await Promise.all([
      this.db.customerPreparedRequest.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (current - 1) * 20,
        take: 20,
        select: {
          id: true,
          productName: true,
          quantity: true,
          size: true,
          color: true,
          priceXof: true,
          createdAt: true,
          processingStatus: true,
          statusVersion: true,
          statusUpdatedAt: true,
          account: { select: { displayName: true, email: true, emailVerifiedAt: true } },
        },
      }),
      this.db.customerPreparedRequest.count(),
    ]);
    const dedupes = entries.map((e) => `request:${e.id}:${e.statusVersion}`);
    const messages = await this.db.mailOutbox.findMany({
      where: { dedupeKey: { in: dedupes } },
      select: { dedupeKey: true, status: true },
    });
    const statuses = new Map(messages.map((m) => [m.dedupeKey, m.status]));
    return {
      items: entries.map((entry) => ({
        ...entry,
        notificationStatus: statuses.get(`request:${entry.id}:${entry.statusVersion}`) ?? 'none',
      })),
      total,
      page: current,
      mailConfigured: this.mail.configured(),
    };
  }
  async update(auth: AuthenticatedAdmin, id: string, dto: CustomerRequestStatusDto) {
    return this.db.$transaction(async (tx) => {
      const adminSession = await tx.adminSession.findFirst({
        where: { id: auth.sessionId, expiresAt: { gt: new Date() }, account: { active: true } },
      });
      if (!adminSession) throw new UnauthorizedException('Session expirée.');
      await tx.$queryRaw`SELECT id FROM gainde_v1.customer_prepared_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const entry = await tx.customerPreparedRequest.findUnique({
        where: { id },
        include: { account: true },
      });
      if (!entry) throw new NotFoundException('Demande introuvable.');
      if (entry.statusVersion !== dto.version)
        throw new ConflictException('Cette demande a changé. Rechargez la liste.');
      if (!transitions[entry.processingStatus].includes(dto.status))
        throw new BadRequestException('Transition impossible.');
      const version = entry.statusVersion + 1;
      await tx.customerPreparedRequest.update({
        where: { id },
        data: {
          processingStatus: dto.status,
          statusVersion: version,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: auth.user.id,
        },
      });
      let notification: 'queued' | 'unverified' | 'unconfigured' = 'unconfigured';
      if (!entry.account.emailVerifiedAt) notification = 'unverified';
      else if (this.mail.configured()) {
        await this.mail.enqueue(tx, {
          accountId: entry.accountId,
          kind: 'request_status',
          dedupeKey: `request:${id}:${version}`,
          expiresAt: new Date(Date.now() + 24 * 3600000),
          message: {
            to: entry.account.email,
            subject: `${labels[dto.status]} — Gaindé Sportif`,
            text: `Bonjour ${entry.account.displayName},\n\nNotre équipe confirme : ${labels[dto.status].toLowerCase()}.\n\nRéférence : ${entry.id}\nProduit : ${entry.productName}\nQuantité : ${entry.quantity}${entry.size ? `\nTaille : ${entry.size}` : ''}${entry.color ? `\nCouleur : ${entry.color}` : ''}\n\nRetrouvez le suivi dans votre espace : ${this.mail.siteUrl()}/compte\nPour toute question, poursuivez votre échange WhatsApp avec notre équipe.\n\nGaindé Sportif`,
          },
        });
        notification = 'queued';
      }
      return { ok: true, notification };
    });
  }
}
