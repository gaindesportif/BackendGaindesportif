import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { CreateAccountDto, UpdateAccountDto } from './admin.dto';
import { hashPassword, verifyPassword } from './password';
import type { AdminAccount } from '../generated/prisma/client';

export type AdminUser = Pick<
  AdminAccount,
  'id' | 'username' | 'displayName' | 'role' | 'active' | 'createdAt'
>;
export type AuthenticatedAdmin = { user: AdminUser; sessionId: string };
const safeFields = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  active: true,
  createdAt: true,
} as const;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
@Injectable()
export class AdminService {
  private dummyHash: Promise<string> | undefined;
  constructor(private readonly db: DatabaseService) {}
  async login(username: string, password: string) {
    const account = await this.db.adminAccount.findUnique({ where: { username } });
    this.dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
    const valid = await verifyPassword(password, account?.passwordHash ?? (await this.dummyHash));
    if (!account || !valid || !account.active)
      throw new UnauthorizedException('Identifiants incorrects.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await this.db.adminSession.create({
      data: { tokenHash: digest(token), accountId: account.id, expiresAt },
    });
    return { token, expiresAt, user: this.safe(account) };
  }
  async authenticate(token: string): Promise<AuthenticatedAdmin> {
    if (!/^[\w-]{43}$/.test(token)) throw new UnauthorizedException('Session requise.');
    const session = await this.db.adminSession.findUnique({
      where: { tokenHash: digest(token) },
      include: { account: true },
    });
    if (!session || session.expiresAt.getTime() <= Date.now() || !session.account.active)
      throw new UnauthorizedException('Session expirée.');
    return { user: this.safe(session.account), sessionId: session.id };
  }
  async logout(sessionId: string) {
    await this.db.adminSession.deleteMany({ where: { id: sessionId } });
  }
  async changePassword(auth: AuthenticatedAdmin, current: string, password: string) {
    const account = await this.db.adminAccount.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(current, account.passwordHash)))
      throw new BadRequestException('Mot de passe actuel incorrect.');
    const passwordHash = await hashPassword(password);
    await this.db.$transaction([
      this.db.adminAccount.update({ where: { id: account.id }, data: { passwordHash } }),
      this.db.adminSession.deleteMany({
        where: { accountId: account.id, id: { not: auth.sessionId } },
      }),
    ]);
  }
  owner(auth: AuthenticatedAdmin) {
    if (auth.user.role !== 'owner') throw new ForbiddenException('Accès propriétaire requis.');
  }
  listAccounts(auth: AuthenticatedAdmin) {
    this.owner(auth);
    return this.db.adminAccount.findMany({ select: safeFields, orderBy: { createdAt: 'asc' } });
  }
  async createAccount(auth: AuthenticatedAdmin, dto: CreateAccountDto) {
    this.owner(auth);
    try {
      return await this.db.adminAccount.create({
        data: {
          username: dto.username,
          displayName: dto.displayName,
          passwordHash: await hashPassword(dto.password),
        },
        select: safeFields,
      });
    } catch (error) {
      if (isDuplicate(error)) throw new ConflictException('Cet identifiant existe déjà.');
      throw error;
    }
  }
  async updateAccount(auth: AuthenticatedAdmin, id: string, dto: UpdateAccountDto) {
    this.owner(auth);
    const account = await this.db.adminAccount.findUnique({ where: { id } });
    if (!account || account.role === 'owner')
      throw new ForbiddenException('Ce compte ne peut pas être modifié ici.');
    const passwordHash = dto.password ? await hashPassword(dto.password) : undefined;
    return this.db.$transaction(async (tx) => {
      const updated = await tx.adminAccount.update({
        where: { id },
        data: { displayName: dto.displayName, active: dto.active, passwordHash },
        select: safeFields,
      });
      if (passwordHash || dto.active === false)
        await tx.adminSession.deleteMany({ where: { accountId: id } });
      return updated;
    });
  }
  private safe(account: AdminUser): AdminUser {
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      active: account.active,
      createdAt: account.createdAt,
    };
  }
}
export function isDuplicate(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
}
