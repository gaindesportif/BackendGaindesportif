import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { Prisma, type Product, type ProductMedia } from '../generated/prisma/client';
import { isDuplicate } from '../admin/admin.service';
import { orderedProductMedia, publicProductWhere } from './public-product';
import { CloudinaryService, MEDIA_LIMITS, type ResourceType } from './cloudinary.service';
import {
  ConfirmMediaDto,
  ListProductsDto,
  PatchMediaDto,
  PatchProductDto,
  ProductDto,
} from './shop.dto';

type ProductWithMedia = Product & { media: ProductMedia[] };
type Transaction = Prisma.TransactionClient;
const includeMedia = orderedProductMedia;
export function publicMedia(media: ProductMedia) {
  return {
    id: media.id,
    type: media.resourceType,
    url: media.secureUrl,
    alt: media.alt,
    position: media.position,
  };
}
export function serializeProduct(product: ProductWithMedia, admin = false) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    category: product.category,
    priceXof: product.priceXof,
    sizes: product.sizes,
    colors: product.colors,
    availability: product.availability,
    status: product.status,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    media: product.media.filter((media) => media.state === 'ready').map(publicMedia),
    ...(admin
      ? { pendingMediaCleanup: product.media.filter((media) => media.state === 'deleting').length }
      : {}),
  };
}
@Injectable()
export class ShopService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cleaning?: Promise<void>;
  constructor(
    private readonly db: DatabaseService,
    private readonly cloudinary: CloudinaryService,
  ) {}
  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') {
      this.timer = setInterval(() => {
        void this.runCleanup().catch(() => undefined);
      }, 30000);
      this.timer.unref();
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.cleaning;
  }
  async list(query: ListProductsDto, admin = false) {
    const where: Prisma.ProductWhereInput = {
      ...(admin ? {} : publicProductWhere),
      ...(query.category ? { category: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [products, total] = await this.db.$transaction([
      this.db.product.findMany({
        where,
        include: includeMedia,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.product.count({ where }),
    ]);
    return {
      items: products.map((product) => serializeProduct(product, admin)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async getPublic(slug: string) {
    const product = await this.db.product.findFirst({
      where: { slug, ...publicProductWhere },
      include: includeMedia,
    });
    if (!product) throw new NotFoundException('Produit introuvable.');
    return serializeProduct(product);
  }
  async get(id: string) {
    const product = await this.db.product.findUnique({ where: { id }, include: includeMedia });
    if (!product) throw new NotFoundException('Produit introuvable.');
    return serializeProduct(product, true);
  }
  async create(dto: ProductDto) {
    if (dto.status === 'published')
      throw new BadRequestException(
        'Enregistrez un brouillon et ajoutez une image avant publication.',
      );
    this.plainText(dto);
    const baseSlug =
      dto.name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 130)
        .replace(/-+$/, '') || 'produit';
    try {
      const product = await this.db.product.create({
        data: { ...dto, slug: `${baseSlug}-${randomUUID().slice(0, 8)}`, status: 'draft' },
        include: includeMedia,
      });
      return serializeProduct(product, true);
    } catch (error) {
      if (isDuplicate(error)) throw new ConflictException('Réessayez l’enregistrement.');
      throw error;
    }
  }
  async update(id: string, dto: PatchProductDto) {
    this.plainText(dto);
    return this.db.$transaction(async (tx) => {
      const product = await this.lockProduct(tx, id);
      this.modifiable(product);
      if ((dto.status ?? product.status) === 'published') {
        const price = dto.priceXof === undefined ? product.priceXof : dto.priceXof;
        const imageCount = await tx.productMedia.count({
          where: { productId: id, state: 'ready', resourceType: 'image' },
        });
        if (!price || price < 1 || !imageCount)
          throw new BadRequestException(
            'Un prix positif et au moins une image sont requis pour publier.',
          );
      }
      return serializeProduct(
        await tx.product.update({ where: { id }, data: dto, include: includeMedia }),
        true,
      );
    });
  }
  async requestProductDeletion(id: string) {
    const result = await this.db.$transaction(async (tx) => {
      const found = await tx.product.findUnique({ where: { id } });
      if (!found) return { deleted: true, pendingMediaCleanup: 0 };
      await this.lockProduct(tx, id);
      await tx.product.update({ where: { id }, data: { status: 'deleting' } });
      await tx.productMedia.updateMany({
        where: { productId: id, state: { not: 'deleting' } },
        data: { state: 'deleting', nextAttemptAt: new Date() },
      });
      const pendingMediaCleanup = await tx.productMedia.count({ where: { productId: id } });
      if (!pendingMediaCleanup) {
        await tx.product.delete({ where: { id } });
        return { deleted: true, pendingMediaCleanup: 0 };
      }
      return { deleted: false, pendingMediaCleanup };
    });
    this.kickCleanup();
    return result;
  }
  async uploadSignature(productId: string, type: ResourceType) {
    const mediaId = randomUUID();
    const publicId = `gainde-sportif/products/${productId}/${mediaId}`;
    const signed = this.cloudinary.signature(publicId, type);
    await this.db.$transaction(async (tx) => {
      this.modifiable(await this.lockProduct(tx, productId));
      const all = await tx.productMedia.findMany({
        where: { productId, state: { not: 'deleting' } },
      });
      if (
        all.length >= MEDIA_LIMITS.maxMedia ||
        (type === 'image' &&
          all.filter((media) => media.resourceType === 'image').length >= MEDIA_LIMITS.maxImages) ||
        (type === 'video' &&
          all.filter((media) => media.resourceType === 'video').length >= MEDIA_LIMITS.maxVideos)
      )
        throw new BadRequestException('La limite de médias de ce produit est atteinte.');
      await tx.productMedia.create({
        data: {
          id: mediaId,
          productId,
          publicId,
          resourceType: type,
          position: all.length,
          expiresAt: new Date(Date.now() + 65 * 60 * 1000),
        },
      });
    });
    return { mediaId, ...signed };
  }
  async confirmMedia(productId: string, mediaId: string, dto: ConfirmMediaDto) {
    const media = await this.db.productMedia.findFirst({ where: { id: mediaId, productId } });
    if (!media || media.state === 'deleting') throw new NotFoundException('Média introuvable.');
    if (media.state === 'ready') return publicMedia(media);
    if (media.expiresAt.getTime() <= Date.now())
      throw new BadRequestException('L’autorisation a expiré. Ajoutez à nouveau le fichier.');
    let asset;
    try {
      asset = await this.cloudinary.verify(media.publicId, media.resourceType as ResourceType);
    } catch (error) {
      if (error instanceof BadRequestException && !error.message.includes('introuvable')) {
        await this.db.productMedia.updateMany({
          where: { id: mediaId, state: 'pending' },
          data: { state: 'deleting', nextAttemptAt: new Date() },
        });
        this.kickCleanup();
      }
      throw error;
    }
    return this.db.$transaction(async (tx) => {
      this.modifiable(await this.lockProduct(tx, productId));
      const latest = await tx.productMedia.findFirst({
        where: { id: mediaId, productId, state: 'pending', expiresAt: { gt: new Date() } },
      });
      if (!latest) throw new ConflictException('Ce média ne peut plus être confirmé.');
      const updated = await tx.productMedia.update({
        where: { id: mediaId },
        data: { ...asset, state: 'ready', alt: dto.alt ?? '' },
      });
      return publicMedia(updated);
    });
  }
  async updateMedia(productId: string, mediaId: string, dto: PatchMediaDto) {
    return this.db.$transaction(async (tx) => {
      this.modifiable(await this.lockProduct(tx, productId));
      const media = await tx.productMedia.findFirst({
        where: { id: mediaId, productId, state: 'ready' },
      });
      if (!media) throw new NotFoundException('Média introuvable.');
      let position = media.position;
      if (dto.position !== undefined) {
        const ordered = await tx.productMedia.findMany({
          where: { productId, state: 'ready' },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, position: true },
        });
        const from = ordered.findIndex((item) => item.id === mediaId);
        const [moved] = ordered.splice(from, 1);
        position = Math.min(dto.position, ordered.length);
        ordered.splice(position, 0, moved);
        for (const [index, item] of ordered.entries()) {
          if (item.position !== index)
            await tx.productMedia.update({ where: { id: item.id }, data: { position: index } });
        }
      }
      return publicMedia(
        await tx.productMedia.update({
          where: { id: mediaId },
          data: { ...dto, position },
        }),
      );
    });
  }
  async requestMediaDeletion(productId: string, mediaId: string) {
    const result = await this.db.$transaction(async (tx) => {
      const product = await this.lockProduct(tx, productId);
      this.modifiable(product);
      const media = await tx.productMedia.findUnique({ where: { id: mediaId } });
      if (!media) return { deleted: true, pendingMediaCleanup: 0 };
      if (media.productId !== productId) throw new NotFoundException('Média introuvable.');
      await tx.productMedia.update({
        where: { id: mediaId },
        data: {
          state: 'deleting',
          nextAttemptAt: media.state === 'deleting' ? media.nextAttemptAt : new Date(),
        },
      });
      if (
        product.status === 'published' &&
        !(await tx.productMedia.count({
          where: { productId, state: 'ready', resourceType: 'image' },
        }))
      )
        await tx.product.update({ where: { id: productId }, data: { status: 'draft' } });
      return { deleted: false, pendingMediaCleanup: 1 };
    });
    this.kickCleanup();
    return result;
  }
  async runCleanup() {
    if (this.cleaning) return this.cleaning;
    this.cleaning = this.performCleanup().finally(() => {
      this.cleaning = undefined;
    });
    return this.cleaning;
  }
  private kickCleanup() {
    void this.runCleanup().catch(() => undefined);
  }
  private async performCleanup() {
    const now = new Date();
    await this.db.productMedia.updateMany({
      where: { state: 'pending', expiresAt: { lte: now } },
      data: { state: 'deleting', nextAttemptAt: now },
    });
    await this.db.adminSession.deleteMany({ where: { expiresAt: { lte: now } } });
    await this.db.customerSession.deleteMany({ where: { expiresAt: { lte: now } } });
    const due = await this.db.productMedia.findMany({
      where: { state: 'deleting', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 10,
    });
    for (const media of due) {
      const claimed = await this.db.productMedia.updateMany({
        where: { id: media.id, state: 'deleting', nextAttemptAt: { lte: now } },
        data: { nextAttemptAt: new Date(Date.now() + 60000) },
      });
      if (!claimed.count) continue;
      try {
        // The resource_type URL is not signed: purge both namespaces, including orphaned tickets.
        await this.cloudinary.destroy(media.publicId, 'image');
        await this.cloudinary.destroy(media.publicId, 'video');
        await this.cloudinary.destroyRawPrefix(media.publicId);
        // A signed upload can be replayed for one hour. Keep a durable tombstone until expiry.
        if (media.expiresAt.getTime() > Date.now()) {
          await this.db.productMedia.updateMany({
            where: { id: media.id, state: 'deleting' },
            data: { nextAttemptAt: media.expiresAt, lastError: null },
          });
        } else {
          await this.db.productMedia.deleteMany({ where: { id: media.id, state: 'deleting' } });
        }
      } catch {
        await this.db.productMedia.updateMany({
          where: { id: media.id, state: 'deleting' },
          data: {
            attempts: { increment: 1 },
            lastError: 'provider_unavailable',
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(media.attempts, 7)),
            ),
          },
        });
      }
    }
    const empty = await this.db.product.findMany({
      where: { status: 'deleting', media: { none: {} } },
      select: { id: true },
      take: 100,
    });
    for (const product of empty)
      await this.db.product.deleteMany({
        where: { id: product.id, status: 'deleting', media: { none: {} } },
      });
  }
  private async lockProduct(tx: Transaction, id: string) {
    const locked = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM gainde_v1.products WHERE id = ${id}::uuid FOR UPDATE`;
    if (!locked.length) throw new NotFoundException('Produit introuvable.');
    return tx.product.findUniqueOrThrow({ where: { id } });
  }
  private modifiable(product: Product) {
    if (product.status === 'deleting')
      throw new ConflictException('Ce produit est en cours de suppression.');
  }
  private plainText(dto: PatchProductDto) {
    const values = [dto.name, dto.description, ...(dto.sizes ?? []), ...(dto.colors ?? [])];
    if (values.some((value) => typeof value === 'string' && /<\/?[a-z][^>]*>/i.test(value)))
      throw new BadRequestException('Utilisez du texte simple, sans HTML.');
  }
}
