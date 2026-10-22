import type { Prisma } from '../generated/prisma/client';

// A public reference must still be a complete, visible publication at read time.
export const publicProductWhere = {
  status: 'published',
  stockQuantity: { gte: 0 },
  categoryInfo: { active: true },
  priceXof: { gt: 0 },
  media: { some: { state: 'ready', resourceType: 'image', secureUrl: { startsWith: 'https://' } } },
} satisfies Prisma.ProductWhereInput;

export const orderedProductMedia = {
  categoryInfo: { select: { label: true, active: true } },
  media: {
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
};
