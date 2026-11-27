import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length, MaxLength } from 'class-validator';
import { MediaPushService } from './media-push.service';

class UnsubscribeDto {
  @IsString() @MaxLength(2048) endpoint!: string;
  @IsString() @Length(22) auth!: string;
}

class SubscribeDto extends UnsubscribeDto {
  @IsString() @Length(87) p256dh!: string;
}

@Controller('media-notifications')
export class MediaPushController {
  constructor(private readonly service: MediaPushService) {}

  @Get('config')
  @Header('Cache-Control', 'no-store')
  config() {
    return this.service.publicConfig();
  }

  @Post('subscribe')
  @HttpCode(204)
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  subscribe(@Body() dto: SubscribeDto) {
    return this.service.subscribe(dto.endpoint, dto.auth, dto.p256dh);
  }

  @Post('unsubscribe')
  @HttpCode(204)
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.service.unsubscribe(dto.endpoint, dto.auth);
  }
}
