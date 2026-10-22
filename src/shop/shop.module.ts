import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { CloudinaryService } from './cloudinary.service';
import {
  AdminProductsController,
  ProductsController,
  CategoriesController,
} from './shop.controller';
import { ShopService } from './shop.service';
@Module({
  imports: [AdminModule],
  controllers: [ProductsController, AdminProductsController, CategoriesController],
  providers: [CloudinaryService, ShopService],
})
export class ShopModule {}
