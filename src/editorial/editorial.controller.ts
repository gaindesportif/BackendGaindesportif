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
import { ArticleDto, ArticleImageDto, ArticleQueryDto } from './editorial.dto';
import { EditorialService } from './editorial.service';
@Controller('articles')
export class ArticlesController {
  constructor(private readonly editorial: EditorialService) {}
  @Get() list(@Query() q: ArticleQueryDto) {
    return this.editorial.list(q);
  }
  @Get(':slug') get(@Param('slug') slug: string) {
    return this.editorial.publicArticle(slug);
  }
}
@Controller('admin/articles')
@UseGuards(AdminGuard)
export class AdminArticlesController {
  constructor(private readonly editorial: EditorialService) {}
  @Get() list(@Query() q: ArticleQueryDto) {
    return this.editorial.list(q, true);
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.editorial.get(id);
  }
  @Post() create(@Body() dto: ArticleDto) {
    return this.editorial.create(dto);
  }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ArticleDto) {
    return this.editorial.update(id, dto);
  }
  @Delete(':id') async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.editorial.remove(id);
    res.status(r.deleted ? 200 : 202);
    return r;
  }
  @Post(':id/images/upload-signature')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  upload(@Param('id', ParseUUIDPipe) id: string) {
    return this.editorial.upload(id);
  }
  @Post(':id/images/:imageId/confirm') confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: ArticleImageDto,
  ) {
    return this.editorial.confirm(id, imageId, dto);
  }
  @Patch(':id/images/:imageId') image(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: ArticleImageDto,
  ) {
    return this.editorial.editImage(id, imageId, dto);
  }
  @Delete(':id/images/:imageId') removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.editorial.removeImage(id, imageId);
  }
}
