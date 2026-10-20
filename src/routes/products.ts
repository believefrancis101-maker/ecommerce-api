import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../utils/async';
import { ApiError, listMeta, ok, okItem } from '../utils/response';
import {
  createPaginationQuerySchema,
  parseFilterQuery,
  parsePaginationQuery,
  uuidParam,
  validateUuidParam,
} from '../middleware/validation';
import { enforcePriceRange, productFilterSchema, productFilterWhere } from '../middleware/product-filters';

const router = Router();

// Public sort names -> real columns. `price` maps to the kobo column so callers
// never have to know the internal field name.
const SORT_COLUMNS = { price: 'priceMinor', name: 'name', createdAt: 'createdAt' } as const;

const querySchema = createPaginationQuerySchema(Object.keys(SORT_COLUMNS));

// `minPrice` / `maxPrice` / `inStock` are the shared product filters (also used
// by GET /categories/:id/products); only `category` is specific to this list.
// Prices are minor units (kobo) end to end, so the filters compare like-for-like.
const filterSchema = productFilterSchema
  .extend({ category: z.string().min(1, 'category must be a slug').optional() })
  .superRefine(enforcePriceRange);

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

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset, sort } = parsePaginationQuery(querySchema, req);
    const filters = parseFilterQuery(filterSchema, req);
    const field = (sort?.field ?? 'price') as keyof typeof SORT_COLUMNS;
    const direction = sort?.direction ?? 'asc';

    const where = {
      ...(filters.category ? { category: { slug: filters.category } } : {}),
      ...productFilterWhere(filters),
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
