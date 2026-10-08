import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    const adapter = new PrismaPg(
      {
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        max: 5,
        connectionTimeoutMillis: 8000,
        idleTimeoutMillis: 30000,
        statement_timeout: 5000,
      },
      { schema: 'gainde_v1' },
    );
    super({ adapter, log: [] });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
