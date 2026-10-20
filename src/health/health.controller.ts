import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}
  @Get() live() {
    return { status: 'ok', service: 'gainde-backend' };
  }
  @Get('ready') async ready() {
    try {
      await Promise.all([
        this.db.contactRequest.findFirst({ select: { id: true } }),
        this.db.adminAccount.findFirst({ select: { id: true } }),
        this.db.adminSession.findFirst({ select: { id: true } }),
        this.db.product.findFirst({ select: { id: true } }),
        this.db.productMedia.findFirst({ select: { id: true } }),
      ]);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Service temporairement indisponible.');
    }
  }
}
