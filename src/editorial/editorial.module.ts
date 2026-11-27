import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { CloudinaryService } from '../shop/cloudinary.service';
import { EditorialService } from './editorial.service';
import { AdminArticlesController, ArticlesController } from './editorial.controller';
import { MediaPushService } from './media-push.service';
import { MediaPushController } from './media-push.controller';
@Module({
  imports: [AdminModule],
  controllers: [AdminArticlesController, ArticlesController, MediaPushController],
  providers: [EditorialService, CloudinaryService, MediaPushService],
})
export class EditorialModule {}
