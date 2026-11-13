import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { CloudinaryService } from '../shop/cloudinary.service';
import type { Prisma } from '../generated/prisma/client';
import { ArticleDto, ArticleImageDto, ArticleQueryDto } from './editorial.dto';

const images = {
  where: { state: 'ready' },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  select: { id: true, url: true, alt: true, caption: true, credit: true },
} satisfies Prisma.ArticleImageFindManyArgs;
@Injectable()
export class EditorialService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private cleaning?: Promise<void>;
  constructor(
    private readonly db: DatabaseService,
    private readonly cloud: CloudinaryService,
    private readonly config: ConfigService,
  ) {}
  onModuleInit() {
    if (this.config.get('NODE_ENV') !== 'test') {
      this.timer = setInterval(() => {
        void this.cleanup().catch(() => undefined);
      }, 60000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    return this.cleaning;
  }
  assertPublic() {
    if (this.config.get('MEDIA_PUBLIC_ENABLED') !== true) throw new NotFoundException();
  }
  private async lock(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM gainde_v1.articles WHERE id = ${id}::uuid FOR UPDATE`;
    const article = await tx.article.findUnique({ where: { id } });
    if (!article || article.status === 'deleting')
      throw new NotFoundException('Article introuvable.');
    return article;
  }
  async list(query: ArticleQueryDto, admin = false) {
    if (!admin) this.assertPublic();
    const where: Prisma.ArticleWhereInput = {
      status: admin ? query.status || { not: 'deleting' } : 'published',
      ...(query.category ? { category: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { excerpt: { contains: query.q, mode: 'insensitive' } },
              { body: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.article.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: admin
          ? [{ updatedAt: 'desc' }, { id: 'asc' }]
          : [
              { featured: 'desc' },
              { publishedAt: { sort: 'desc', nulls: 'last' } },
              { createdAt: 'desc' },
              { id: 'asc' },
            ],
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          category: true,
          author: true,
          featured: true,
          status: true,
          version: true,
          publishedAt: true,
          updatedAt: true,
          images: { ...images, take: 1 },
        },
      }),
      this.db.article.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
  async get(id: string) {
    const a = await this.db.article.findFirst({
      where: { id, status: { not: 'deleting' } },
      include: { images },
    });
    if (!a) throw new NotFoundException('Article introuvable.');
    return a;
  }
  async publicArticle(slug: string) {
    this.assertPublic();
    const a = await this.db.article.findFirst({
      where: { slug, status: 'published' },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        body: true,
        category: true,
        author: true,
        featured: true,
        publishedAt: true,
        updatedAt: true,
        images,
      },
    });
    if (!a) throw new NotFoundException();
    return a;
  }
  async create(dto: ArticleDto) {
    if (dto.status !== 'draft')
      throw new BadRequestException(
        'Enregistrez un brouillon et ajoutez sa photo avant publication.',
      );
    const id = randomUUID();
    const stem =
      dto.title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 145) || 'article';
    return this.db.article.create({
      data: { ...dto, version: 1, id, slug: `${stem}-${id.slice(0, 8)}` },
      include: { images },
    });
  }
  async update(id: string, dto: ArticleDto) {
    await this.db.$transaction(async (tx) => {
      // Serialize front-page changes before taking row locks; the partial unique index is a second guard.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(13112026)`;
      const a = await this.lock(tx, id);
      if (dto.version !== a.version)
        throw new ConflictException(
          'Une autre modification a été enregistrée. Rechargez l’article.',
        );
      if (
        dto.status === 'published' &&
        (!dto.body.trim() ||
          !(await tx.articleImage.count({ where: { articleId: id, state: 'ready' } })))
      )
        throw new BadRequestException('Un texte et une photo sont nécessaires pour publier.');
      const featured = dto.featured ?? a.featured;
      if (dto.status === 'published' && featured) {
        await tx.article.updateMany({
          where: { id: { not: id }, status: 'published', featured: true },
          data: { featured: false, version: { increment: 1 } },
        });
      }
      await tx.article.update({
        where: { id },
        data: {
          ...dto,
          featured,
          version: { increment: 1 },
          publishedAt: dto.status === 'published' ? a.publishedAt || new Date() : a.publishedAt,
        },
      });
    });
    return this.get(id);
  }
  async upload(id: string) {
    const imageId = randomUUID();
    const publicId = `gainde/editorial/${id}/${imageId}`;
    const signature = this.cloud.signature(publicId, 'image');
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      if (
        (await tx.articleImage.count({
          where: { articleId: id, state: { in: ['ready', 'pending'] } },
        })) >= 10
      )
        throw new BadRequestException('Dix photos maximum par article.');
      await tx.articleImage.create({
        data: {
          id: imageId,
          articleId: id,
          publicId,
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
      });
    });
    return { id: imageId, ...signature };
  }
  async confirm(id: string, imageId: string, dto: ArticleImageDto) {
    const ticket = await this.db.articleImage.findFirst({
      where: { id: imageId, articleId: id, state: { in: ['pending', 'ready'] } },
    });
    if (!ticket || (ticket.expiresAt.getTime() < Date.now() && ticket.state === 'pending'))
      throw new BadRequestException('Envoi expiré. Ajoutez à nouveau la photo.');
    const asset = await this.cloud.verify(ticket.publicId, 'image');
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      const current = await tx.articleImage.findFirst({
        where: { id: imageId, articleId: id, state: { in: ['pending', 'ready'] } },
      });
      if (!current) throw new ConflictException('Cette photo a été retirée.');
      await tx.articleImage.update({
        where: { id: imageId },
        data: { ...dto, url: asset.secureUrl, state: 'ready' },
      });
      await tx.article.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    return this.get(id);
  }
  async editImage(id: string, imageId: string, dto: ArticleImageDto) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, id);
      if (
        !(await tx.articleImage.findFirst({
          where: { id: imageId, articleId: id, state: 'ready' },
        }))
      )
        throw new NotFoundException();
      await tx.articleImage.update({ where: { id: imageId }, data: dto });
      await tx.article.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    return this.get(id);
  }
  async removeImage(id: string, imageId: string) {
    await this.db.$transaction(async (tx) => {
      const a = await this.lock(tx, id);
      const img = await tx.articleImage.findFirst({ where: { id: imageId, articleId: id } });
      if (!img || img.state === 'deleting') return;
      if (
        a.status === 'published' &&
        img.state === 'ready' &&
        (await tx.articleImage.count({ where: { articleId: id, state: 'ready' } })) <= 1
      )
        throw new BadRequestException('Conservez une photo ou repassez l’article en brouillon.');
      await tx.articleImage.update({ where: { id: imageId }, data: { state: 'deleting' } });
      await tx.article.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    await this.cleanup();
    return this.get(id);
  }
  async remove(id: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(13112026)`;
      await tx.$queryRaw`SELECT id FROM gainde_v1.articles WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await tx.article.findUnique({ where: { id } });
      if (!a) return;
      await tx.article.update({
        where: { id },
        data: { status: 'deleting', featured: false, version: { increment: 1 } },
      });
      await tx.articleImage.updateMany({ where: { articleId: id }, data: { state: 'deleting' } });
    });
    await this.cleanup();
    return { deleted: !(await this.db.article.findUnique({ where: { id } })) };
  }
  cleanup() {
    if (!this.cleaning)
      this.cleaning = this.performCleanup().finally(() => {
        this.cleaning = undefined;
      });
    return this.cleaning;
  }
  private async performCleanup() {
    const now = new Date();
    await this.db.articleImage.updateMany({
      where: { state: 'pending', expiresAt: { lt: now } },
      data: { state: 'deleting' },
    });
    for (const img of await this.db.articleImage.findMany({
      where: { state: 'deleting' },
      take: 50,
    })) {
      try {
        await this.cloud.destroy(img.publicId, 'image');
        // Keep a tombstone until upload signatures have expired, preventing late-upload orphans.
        if (img.expiresAt <= now)
          await this.db.articleImage.deleteMany({ where: { id: img.id, state: 'deleting' } });
      } catch {
        /* Durable ticket retained for retry. */
      }
    }
    await this.db.article.deleteMany({ where: { status: 'deleting', images: { none: {} } } });
  }
}
