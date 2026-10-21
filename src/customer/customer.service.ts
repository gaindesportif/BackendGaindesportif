import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { MailService, GENERIC_RESET_MESSAGE } from '../mail/mail.service';
import { DatabaseService } from '../database/database.service';
import type { CustomerAccount, CustomerEmailPurpose, Prisma } from '../generated/prisma/client';
import { hashPassword, verifyPassword } from '../admin/password';
import { isDuplicate } from '../admin/admin.service';
import { serializeProduct } from '../shop/shop.service';
import { orderedProductMedia, publicProductWhere } from '../shop/public-product';
import type { CustomerPreparedRequestDto, RegisterCustomerDto } from './customer.dto';

type Transaction = Prisma.TransactionClient;
export type CustomerUser = Pick<
  CustomerAccount,
  'id' | 'email' | 'displayName' | 'createdAt' | 'emailVerifiedAt'
>;
export type AuthenticatedCustomer = { user: CustomerUser; sessionId: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;
const WISHLIST_LIMIT = 100;
const HISTORY_LIMIT = 30;

@Injectable()
export class CustomerService {
  private dummyHash?: Promise<string>;
  constructor(
    private readonly db: DatabaseService,
    private readonly mail: MailService,
  ) {}
  async register(dto: RegisterCustomerDto) {
    const passwordHash = await hashPassword(dto.password);
    try {
      return await this.db.$transaction(async (tx) => {
        const account = await tx.customerAccount.create({
          data: {
            email: dto.email,
            displayName: dto.displayName,
            passwordHash,
            consentAt: new Date(),
          },
        });
        const verificationQueued = this.mail.configured()
          ? await this.issueEmailToken(tx, account, 'verify_email')
          : false;
        return { ...(await this.createSession(tx, account)), verificationQueued };
      });
    } catch (error) {
      if (isDuplicate(error))
        throw new ConflictException(
          'Création impossible avec ces informations. Connectez-vous ou réinitialisez votre mot de passe par e-mail.',
        );
      throw error;
    }
  }
  async login(email: string, password: string) {
    const account = await this.db.customerAccount.findUnique({ where: { email } });
    this.dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
    const valid = await verifyPassword(password, account?.passwordHash ?? (await this.dummyHash));
    if (!account || !valid) throw new UnauthorizedException('Identifiants incorrects.');
    return this.db.$transaction(async (tx) => {
      const current = await this.lockAccount(tx, account.id);
      // A password change or account deletion must not be followed by a stale login.
      if (current.passwordHash !== account.passwordHash)
        throw new UnauthorizedException('Identifiants incorrects.');
      return this.createSession(tx, current);
    });
  }
  async authenticate(token: string): Promise<AuthenticatedCustomer> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('Session requise.');
    const session = await this.db.customerSession.findUnique({
      where: { tokenHash: digest(token) },
      include: { account: true },
    });
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('Session expirée.');
    return { user: this.safe(session.account), sessionId: session.id };
  }
  async logout(auth: AuthenticatedCustomer) {
    await this.db.customerSession.deleteMany({
      where: { id: auth.sessionId, accountId: auth.user.id },
    });
  }
  async changePassword(auth: AuthenticatedCustomer, currentPassword: string, newPassword: string) {
    const passwordHash = await hashPassword(newPassword);
    await this.db.$transaction(async (tx) => {
      const account = await this.lockAuthenticated(tx, auth);
      if (!(await verifyPassword(currentPassword, account.passwordHash)))
        throw new BadRequestException('Mot de passe actuel incorrect.');
      await tx.customerAccount.update({ where: { id: account.id }, data: { passwordHash } });
      await tx.customerSession.deleteMany({ where: { accountId: account.id } });
      await tx.customerEmailToken.updateMany({
        where: { accountId: account.id, purpose: 'reset_password', usedAt: null },
        data: { usedAt: new Date() },
      });
      await this.mail.cancelTokens(tx, account.id, 'reset_password');
    });
    return { ok: true };
  }
  async forgot(email: string) {
    this.mail.requireConfigured();
    const account = await this.db.customerAccount.findUnique({ where: { email } });
    if (account)
      await this.db.$transaction(async (tx) => {
        const current = await this.lockAccount(tx, account.id);
        await this.issueEmailToken(tx, current, 'reset_password');
      });
    return { message: GENERIC_RESET_MESSAGE };
  }
  async resendVerification(auth: AuthenticatedCustomer) {
    this.mail.requireConfigured();
    return this.db.$transaction(async (tx) => {
      const account = await this.lockAuthenticated(tx, auth);
      if (account.emailVerifiedAt) return { queued: false, verified: true };
      return { queued: await this.issueEmailToken(tx, account, 'verify_email'), verified: false };
    });
  }
  async verifyEmail(token: string) {
    await this.consumeEmailToken(token, 'verify_email');
    return { ok: true };
  }
  async resetPassword(token: string, newPassword: string) {
    const passwordHash = await hashPassword(newPassword);
    await this.consumeEmailToken(token, 'reset_password', passwordHash);
    return { ok: true };
  }
  private async consumeEmailToken(
    token: string,
    purpose: CustomerEmailPurpose,
    passwordHash?: string,
  ) {
    const invalid = () =>
      new BadRequestException(
        'Ce lien est invalide, expiré ou déjà utilisé. Demandez un nouveau lien.',
      );
    const original = await this.db.customerEmailToken.findUnique({
      where: { tokenHash: digest(token) },
    });
    if (!original || original.purpose !== purpose) throw invalid();
    await this.db.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, original.accountId);
      const used = await tx.customerEmailToken.updateMany({
        where: { id: original.id, usedAt: null, purpose, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (!used.count) throw invalid();
      await tx.customerAccount.update({
        where: { id: account.id },
        data: {
          emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      if (passwordHash) {
        await tx.customerSession.deleteMany({ where: { accountId: account.id } });
        await tx.customerEmailToken.updateMany({
          where: { accountId: account.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await this.mail.cancelTokens(tx, account.id, 'verify_email');
      }
      await this.mail.cancelTokens(tx, account.id, purpose);
    });
  }
  private async issueEmailToken(
    tx: Transaction,
    account: CustomerAccount,
    purpose: CustomerEmailPurpose,
  ) {
    const recent = await tx.customerEmailToken.findFirst({
      where: { accountId: account.id, purpose, createdAt: { gt: new Date(Date.now() - 60000) } },
    });
    if (recent) return false;
    await tx.customerEmailToken.updateMany({
      where: { accountId: account.id, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.mail.cancelTokens(tx, account.id, purpose);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + (purpose === 'reset_password' ? 30 * 60000 : 24 * 3600000),
    );
    const entry = await tx.customerEmailToken.create({
      data: { accountId: account.id, purpose, tokenHash: digest(token), expiresAt },
    });
    const reset = purpose === 'reset_password';
    const link = `${this.mail.siteUrl()}/compte/${reset ? 'reinitialiser' : 'confirmer-email'}#token=${token}`;
    await this.mail.enqueue(tx, {
      accountId: account.id,
      kind: purpose,
      dedupeKey: `token:${entry.id}`,
      expiresAt,
      message: {
        to: account.email,
        subject: reset
          ? 'Réinitialisez votre mot de passe Gaindé Sportif'
          : 'Confirmez votre adresse e-mail Gaindé Sportif',
        text: `Bonjour ${account.displayName},\n\n${reset ? 'Pour choisir un nouveau mot de passe, ouvrez ce lien dans les 30 minutes :' : 'Confirmez votre adresse e-mail en ouvrant ce lien dans les 24 heures :'}\n${link}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.\n\nGaindé Sportif`,
      },
    });
    return true;
  }
  async updateProfile(auth: AuthenticatedCustomer, displayName: string) {
    return this.db.$transaction(async (tx) => {
      await this.lockAuthenticated(tx, auth);
      const account = await tx.customerAccount.update({
        where: { id: auth.user.id },
        data: { displayName },
      });
      return { user: this.safe(account) };
    });
  }
  async deleteProfile(auth: AuthenticatedCustomer, password: string) {
    await this.db.$transaction(async (tx) => {
      const account = await this.lockAuthenticated(tx, auth);
      if (!(await verifyPassword(password, account.passwordHash)))
        throw new BadRequestException('Mot de passe incorrect.');
      await tx.customerAccount.delete({ where: { id: account.id } });
    });
  }
  async wishlist(auth: AuthenticatedCustomer) {
    return this.readWishlist(this.db, auth.user.id);
  }
  async addWishlist(auth: AuthenticatedCustomer, productId: string) {
    await this.db.$transaction(async (tx) => {
      await this.lockAuthenticated(tx, auth);
      await this.requirePublicProduct(tx, productId);
      const existing = await tx.customerWishlist.findUnique({
        where: { accountId_productId: { accountId: auth.user.id, productId } },
      });
      if (existing) return;
      const count = await tx.customerWishlist.count({ where: { accountId: auth.user.id } });
      if (count >= WISHLIST_LIMIT)
        throw new BadRequestException('Votre liste peut contenir au maximum 100 produits.');
      await tx.customerWishlist.create({ data: { accountId: auth.user.id, productId } });
    });
  }
  async removeWishlist(auth: AuthenticatedCustomer, productId: string) {
    await this.db.$transaction(async (tx) => {
      await this.lockAuthenticated(tx, auth);
      await tx.customerWishlist.deleteMany({ where: { accountId: auth.user.id, productId } });
    });
  }
  async mergeWishlist(auth: AuthenticatedCustomer, productIds: string[]) {
    return this.db.$transaction(async (tx) => {
      await this.lockAuthenticated(tx, auth);
      const [existing, available] = await Promise.all([
        tx.customerWishlist.findMany({
          where: { accountId: auth.user.id },
          select: { productId: true },
        }),
        tx.product.findMany({
          where: { ...publicProductWhere, id: { in: productIds } },
          select: { id: true },
        }),
      ]);
      const present = new Set(existing.map((item) => item.productId));
      const visible = new Set(available.map((item) => item.id));
      const additions = productIds
        .filter((id) => visible.has(id) && !present.has(id))
        .slice(0, Math.max(0, WISHLIST_LIMIT - existing.length));
      if (additions.length)
        await tx.customerWishlist.createMany({
          data: additions.map((productId) => ({ accountId: auth.user.id, productId })),
          skipDuplicates: true,
        });
      return this.readWishlist(tx, auth.user.id);
    });
  }
  async history(auth: AuthenticatedCustomer) {
    const account = await this.db.customerAccount.findUnique({ where: { id: auth.user.id } });
    if (!account) throw new UnauthorizedException('Session expirée.');
    if (!account.historyEnabled) return { items: [], enabled: false };
    const views = await this.db.customerProductView.findMany({
      where: { accountId: auth.user.id, product: publicProductWhere },
      include: { product: { include: orderedProductMedia } },
      orderBy: [{ viewedAt: 'desc' }, { productId: 'asc' }],
      take: HISTORY_LIMIT,
    });
    return {
      items: views.map((view) => ({
        product: serializeProduct(view.product),
        viewedAt: view.viewedAt,
      })),
      enabled: true,
    };
  }
  async recordView(auth: AuthenticatedCustomer, productId: string) {
    await this.db.$transaction(async (tx) => {
      const account = await this.lockAuthenticated(tx, auth);
      if (!account.historyEnabled) return;
      await this.requirePublicProduct(tx, productId);
      await tx.customerProductView.upsert({
        where: { accountId_productId: { accountId: auth.user.id, productId } },
        create: { accountId: auth.user.id, productId },
        update: { viewedAt: new Date() },
      });
      const excess = await tx.customerProductView.findMany({
        where: { accountId: auth.user.id },
        orderBy: [{ viewedAt: 'desc' }, { productId: 'asc' }],
        skip: HISTORY_LIMIT,
        select: { productId: true },
      });
      if (excess.length)
        await tx.customerProductView.deleteMany({
          where: {
            accountId: auth.user.id,
            productId: { in: excess.map((item) => item.productId) },
          },
        });
    });
  }
  async clearHistory(auth: AuthenticatedCustomer) {
    await this.db.$transaction(async (tx) => {
      await this.lockAuthenticated(tx, auth);
      await tx.customerProductView.deleteMany({ where: { accountId: auth.user.id } });
    });
  }
  async historySettings(auth: AuthenticatedCustomer, enabled: boolean) {
    await this.db.$transaction(async (tx) => {
      await this.lockAuthenticated(tx, auth);
      await tx.customerAccount.update({
        where: { id: auth.user.id },
        data: { historyEnabled: enabled },
      });
      if (!enabled) await tx.customerProductView.deleteMany({ where: { accountId: auth.user.id } });
    });
    return { enabled };
  }
  async preparedRequests(auth: AuthenticatedCustomer) {
    const entries = await this.db.customerPreparedRequest.findMany({
      where: { accountId: auth.user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 50,
    });
    const products = await this.db.product.findMany({
      where: {
        ...publicProductWhere,
        id: { in: entries.flatMap((entry) => (entry.productId ? [entry.productId] : [])) },
      },
      include: orderedProductMedia,
    });
    const visible = new Map(products.map((product) => [product.id, serializeProduct(product)]));
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        product: entry.productId ? (visible.get(entry.productId) ?? null) : null,
        productName: entry.productName,
        productSlug: entry.productSlug,
        priceXof: entry.priceXof,
        quantity: entry.quantity,
        size: entry.size,
        color: entry.color,
        createdAt: entry.createdAt,
        processingStatus: entry.processingStatus,
        statusUpdatedAt: entry.statusUpdatedAt,
      })),
    };
  }
  async prepareRequest(auth: AuthenticatedCustomer, dto: CustomerPreparedRequestDto) {
    const payloadHash = digest(
      JSON.stringify([dto.productId, dto.quantity, dto.size ?? null, dto.color ?? null]),
    );
    await this.db.$transaction(async (tx) => {
      await this.lockAuthenticated(tx, auth);
      const existing = await tx.customerPreparedRequest.findUnique({
        where: { accountId_requestKey: { accountId: auth.user.id, requestKey: dto.requestKey } },
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new ConflictException('Cette demande a déjà été préparée avec d’autres choix.');
        return;
      }
      const product = await this.requirePublicProduct(tx, dto.productId);
      if (product.availability === 'unavailable')
        throw new BadRequestException('Ce produit est indisponible.');
      if (
        (product.sizes.length > 0 && !product.sizes.includes(dto.size ?? '')) ||
        (product.sizes.length === 0 && dto.size !== undefined) ||
        (product.colors.length > 0 && !product.colors.includes(dto.color ?? '')) ||
        (product.colors.length === 0 && dto.color !== undefined)
      )
        throw new BadRequestException('Choisissez les options proposées pour ce produit.');
      await tx.customerPreparedRequest.create({
        data: {
          accountId: auth.user.id,
          productId: product.id,
          requestKey: dto.requestKey,
          payloadHash,
          productName: product.name,
          productSlug: product.slug,
          priceXof: product.priceXof!,
          quantity: dto.quantity,
          size: dto.size,
          color: dto.color,
        },
      });
      const excess = await tx.customerPreparedRequest.findMany({
        where: { accountId: auth.user.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 50,
        select: { id: true },
      });
      if (excess.length)
        await tx.customerPreparedRequest.deleteMany({
          where: { accountId: auth.user.id, id: { in: excess.map((entry) => entry.id) } },
        });
    });
  }
  async clearPreparedRequests(auth: AuthenticatedCustomer) {
    await this.db.$transaction(async (tx) => {
      await this.lockAuthenticated(tx, auth);
      await tx.customerPreparedRequest.deleteMany({ where: { accountId: auth.user.id } });
    });
  }
  private async createSession(tx: Transaction, account: CustomerAccount) {
    await tx.customerSession.deleteMany({
      where: { accountId: account.id, expiresAt: { lte: new Date() } },
    });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DURATION);
    await tx.customerSession.create({
      data: { tokenHash: digest(token), accountId: account.id, expiresAt },
    });
    const excess = await tx.customerSession.findMany({
      where: { accountId: account.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 10,
      select: { id: true },
    });
    if (excess.length)
      await tx.customerSession.deleteMany({ where: { id: { in: excess.map((item) => item.id) } } });
    return { token, expiresAt, user: this.safe(account) };
  }
  private async readWishlist(tx: Transaction, accountId: string) {
    const entries = await tx.customerWishlist.findMany({
      where: { accountId, product: publicProductWhere },
      include: { product: { include: orderedProductMedia } },
      orderBy: [{ createdAt: 'desc' }, { productId: 'asc' }],
      take: WISHLIST_LIMIT,
    });
    return { items: entries.map((entry) => serializeProduct(entry.product)) };
  }
  private async requirePublicProduct(tx: Transaction, id: string) {
    // Share lock prevents a simultaneous unpublication/deletion between validation and the reference write.
    await tx.$queryRaw`SELECT id FROM gainde_v1.products WHERE id = ${id}::uuid FOR SHARE`;
    const product = await tx.product.findFirst({ where: { id, ...publicProductWhere } });
    if (!product) throw new NotFoundException('Produit introuvable.');
    return product;
  }
  private async lockAccount(tx: Transaction, id: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM gainde_v1.customer_accounts WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new UnauthorizedException('Session expirée.');
    return tx.customerAccount.findUniqueOrThrow({ where: { id } });
  }
  private async lockAuthenticated(tx: Transaction, auth: AuthenticatedCustomer) {
    const account = await this.lockAccount(tx, auth.user.id);
    const session = await tx.customerSession.findFirst({
      where: { id: auth.sessionId, accountId: account.id, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) throw new UnauthorizedException('Session expirée.');
    return account;
  }
  private safe(account: CustomerAccount): CustomerUser {
    return {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      createdAt: account.createdAt,
      emailVerifiedAt: account.emailVerifiedAt,
    };
  }
}
