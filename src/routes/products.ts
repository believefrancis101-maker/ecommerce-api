import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../utils/async';
import { ApiError, listMeta, ok, okItem } from '../utils/response';
import {
  createPaginationQuerySchema,
  parsePaginationQuery,
  uuidParam,
  validateUuidParam,
} from '../middleware/validation';

const router = Router();

// Public sort names -> real columns. `price` maps to the kobo column so callers
// never have to know the internal field name.
const SORT_COLUMNS = { price: 'priceMinor', name: 'name', createdAt: 'createdAt' } as const;

const querySchema = createPaginationQuerySchema(Object.keys(SORT_COLUMNS));

// Prices are minor units (kobo) end to end: the column stores kobo, so the
// filters compare like-for-like instead of mixing naira and kobo.
const filterSchema = z
  .object({
    category: z.string().min(1, 'category must be a slug').optional(),
    minPrice: z.string().regex(/^\d+$/, 'minPrice must be a non-negative integer in kobo').optional(),
    maxPrice: z.string().regex(/^\d+$/, 'maxPrice must be a non-negative integer in kobo').optional(),
    inStock: z.enum(['true', 'false', '1', '0']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.minPrice && value.maxPrice && Number(value.minPrice) > Number(value.maxPrice)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxPrice'],
        message: 'maxPrice must be greater than or equal to minPrice',
      });
    }
  });

const selectProduct = {
  id: true,
  name: true,
  description: true,
  priceMinor: true,
  currency: true,
  stock: true,
  createdAt: true,
  category: { select: { id: true, name: true, slug: true } },
} as const;

const parseFilters = (req: Parameters<typeof parsePaginationQuery>[1]) => {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(400, 'BAD_QUERY_PARAMS', `${String(first.path[0])}: ${first.message}`);
  }
  return parsed.data;
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset, sort } = parsePaginationQuery(querySchema, req);
    const filters = parseFilters(req);
    const field = (sort?.field ?? 'price') as keyof typeof SORT_COLUMNS;
    const direction = sort?.direction ?? 'asc';

    const priceRange = {
      ...(filters.minPrice !== undefined ? { gte: Number(filters.minPrice) } : {}),
      ...(filters.maxPrice !== undefined ? { lte: Number(filters.maxPrice) } : {}),
    };

    const where = {
      ...(filters.category ? { category: { slug: filters.category } } : {}),
      ...(filters.minPrice !== undefined || filters.maxPrice !== undefined ? { priceMinor: priceRange } : {}),
      ...(filters.inStock !== undefined
        ? { stock: ['true', '1'].includes(filters.inStock) ? { gt: 0 } : { lte: 0 } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        // id keeps pages stable when price/name/createdAt tie.
        orderBy: [{ [SORT_COLUMNS[field]]: direction }, { id: 'asc' }],
        skip: offset,
        take: limit,
        select: selectProduct,
      }),
    ]);

    res.json(ok(rows, listMeta(total, limit, offset, rows.length)));
  })
);

router.get(
  '/:id',
  validateUuidParam('id'),
  asyncHandler(async (req, res) => {
    const row = await prisma.product.findUnique({ where: { id: uuidParam(req, 'id') }, select: selectProduct });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Product not found');
    res.json(okItem(row));
  })
);

export default router;
