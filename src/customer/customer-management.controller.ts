import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard, type AdminRequest } from '../admin/admin.guard';
import { CustomerRequestStatusDto } from './customer.dto';
import { CustomerManagementService } from './customer-management.service';

@Controller('admin/customer-requests')
@UseGuards(AdminGuard)
export class CustomerManagementController {
  constructor(private readonly management: CustomerManagementService) {}
  @Get()
  list(@Query('page') page?: string) {
    return this.management.list(page);
  }
  @Patch(':id/status')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  update(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CustomerRequestStatusDto,
  ) {
    return this.management.update(req.admin, id, dto);
  }
}
