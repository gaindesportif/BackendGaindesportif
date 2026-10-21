import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AdminModule } from '../admin/admin.module';
import { CustomerManagementController } from './customer-management.controller';
import { CustomerManagementService } from './customer-management.service';
import { CustomerController } from './customer.controller';
import { CustomerGuard } from './customer.guard';
import { CustomerService } from './customer.service';

@Module({
  imports: [MailModule, AdminModule],
  controllers: [CustomerController, CustomerManagementController],
  providers: [CustomerService, CustomerGuard, CustomerManagementService],
})
export class CustomerModule {}
