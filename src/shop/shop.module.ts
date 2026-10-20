import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { CloudinaryService } from './cloudinary.service';
import { AdminProductsController, ProductsController } from './shop.controller';
import { ShopService } from './shop.service';
@Module({
  imports: [AdminModule],
  controllers: [ProductsController, AdminProductsController],
  providers: [CloudinaryService, ShopService],
})
export class ShopModule {}
