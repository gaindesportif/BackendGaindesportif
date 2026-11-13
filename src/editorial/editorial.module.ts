import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { CloudinaryService } from '../shop/cloudinary.service';
import { EditorialService } from './editorial.service';
import { AdminArticlesController, ArticlesController } from './editorial.controller';
@Module({
  imports: [AdminModule],
  controllers: [AdminArticlesController, ArticlesController],
  providers: [EditorialService, CloudinaryService],
})
export class EditorialModule {}
