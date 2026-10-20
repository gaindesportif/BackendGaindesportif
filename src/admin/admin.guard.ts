import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService, type AuthenticatedAdmin } from './admin.service';
export type AdminRequest = Request & { admin: AuthenticatedAdmin };
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly admins: AdminService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const authorization = request.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) throw new UnauthorizedException('Session requise.');
    request.admin = await this.admins.authenticate(authorization.slice(7));
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    return true;
  }
}
