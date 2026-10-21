import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerService, type AuthenticatedCustomer } from './customer.service';

export type CustomerRequest = Request & { customer: AuthenticatedCustomer };
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly customers: CustomerService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const authorization = request.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) throw new UnauthorizedException('Session requise.');
    request.customer = await this.customers.authenticate(authorization.slice(7));
    return true;
  }
}
