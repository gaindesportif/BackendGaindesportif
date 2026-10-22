import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AdminGuard } from '../admin/admin.guard';
import { CloudinaryService } from './cloudinary.service';
import {
  ConfirmMediaDto,
  CreateCategoryDto,
  ListProductsDto,
  PatchMediaDto,
  PatchProductDto,
  ProductDto,
  UploadSignatureDto,
} from './shop.dto';
import { ShopService } from './shop.service';
@Controller('categories')
export class CategoriesController {
  constructor(private readonly shop: ShopService) {}
  @Get() list() {
    return this.shop.categories();
  }
}
@Controller('products')
export class ProductsController {
  constructor(private readonly shop: ShopService) {}
  @Get() list(@Query() query: ListProductsDto) {
    return this.shop.list(query);
  }
  @Get(':slug') get(@Param('slug') slug: string) {
    return this.shop.getPublic(slug);
  }
}
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminProductsController {
  constructor(
    private readonly shop: ShopService,
    private readonly cloudinary: CloudinaryService,
  ) {}
  @Get('categories') categories() {
    return this.shop.categories();
  }
  @Post('categories')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.shop.createCategory(dto);
  }
  @Get('media/config') config() {
    return this.cloudinary.configuration();
  }
  @Get('products') list(@Query() query: ListProductsDto) {
    return this.shop.list(query, true);
  }
  @Get('products/:id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.shop.get(id);
  }
  @Post('products') create(@Body() dto: ProductDto) {
    return this.shop.create(dto);
  }
  @Patch('products/:id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchProductDto,
  ) {
    return this.shop.update(id, dto);
  }
  @Delete('products/:id') async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.shop.requestProductDeletion(id);
    response.status(result.deleted ? 200 : 202);
    return result;
  }
  @Post('products/:id/media/upload-signature')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  signature(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UploadSignatureDto) {
    return this.shop.uploadSignature(id, dto.type);
  }
  @Post('products/:id/media/:mediaId/confirm') confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: ConfirmMediaDto,
  ) {
    return this.shop.confirmMedia(id, mediaId, dto);
  }
  @Patch('products/:id/media/:mediaId') patchMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: PatchMediaDto,
  ) {
    return this.shop.updateMedia(id, mediaId, dto);
  }
  @Delete('products/:id/media/:mediaId') async deleteMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.shop.requestMediaDeletion(id, mediaId);
    response.status(result.deleted ? 200 : 202);
    return result;
  }
}
