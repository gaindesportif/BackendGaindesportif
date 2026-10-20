import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProxyThrottlerGuard } from './security/proxy-throttler.guard';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { ContactsModule } from './contacts/contacts.module';
import { AdminModule } from './admin/admin.module';
import { ShopModule } from './shop/shop.module';
import { HealthController } from './health/health.controller';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnvironment,
    }),
    DatabaseModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 60 }]),
    ContactsModule,
    AdminModule,
    ShopModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ProxyThrottlerGuard }],
})
export class AppModule {}
