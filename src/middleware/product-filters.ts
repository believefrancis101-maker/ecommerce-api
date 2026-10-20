import { z } from 'zod';

// The price/stock filters are shared by every product listing (GET /products
// and the nested GET /categories/:id/products). They are defined here once so
// both endpoints accept identical params, enforce the same minPrice <= maxPrice
// rule and build the same Prisma `where` fragment - no copy-paste between them.
export const productFilterSchema = z.object({
  minPrice: z.string().regex(/^\d+$/, 'minPrice must be a non-negative integer in kobo').optional(),
  maxPrice: z.string().regex(/^\d+$/, 'maxPrice must be a non-negative integer in kobo').optional(),
  inStock: z.enum(['true', 'false', '1', '0']).optional(),
});

export type ProductFilters = z.infer<typeof productFilterSchema>;

// Kept as a standalone refinement so GET /products can attach it after
// `.extend({ category })`, while the nested listing attaches it to the shared
// schema directly. Both therefore enforce the exact same rule.
export const enforcePriceRange = (value: { minPrice?: string; maxPrice?: string }, ctx: z.RefinementCtx): void => {
  if (value.minPrice && value.maxPrice && Number(value.minPrice) > Number(value.maxPrice)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxPrice'],
      message: 'maxPrice must be greater than or equal to minPrice',
    });
  }
};

// Prisma `where` fragment for the shared filters. Prices are minor units (kobo)
// end to end: the column stores kobo, so the bounds compare like-for-like.
// `inStock=false` / `inStock=0` means "not in stock" (`stock <= 0`), the
// complement of `stock > 0`.
export const productFilterWhere = (filters: ProductFilters) => {
  const priceRange = {
    ...(filters.minPrice !== undefined ? { gte: Number(filters.minPrice) } : {}),
    ...(filters.maxPrice !== undefined ? { lte: Number(filters.maxPrice) } : {}),
  };

  return {
    ...(filters.minPrice !== undefined || filters.maxPrice !== undefined ? { priceMinor: priceRange } : {}),
    ...(filters.inStock !== undefined
      ? { stock: ['true', '1'].includes(filters.inStock) ? { gt: 0 } : { lte: 0 } }
      : {}),
  };
};
