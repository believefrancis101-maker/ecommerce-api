import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../utils/async';
import { ApiError, listMeta, ok, okItem } from '../utils/response';
import {
  createPaginationQuerySchema,
  escapeLikePattern,
  parseFilterQuery,
  parsePaginationQuery,
  uuidParam,
  validateUuidParam,
} from '../middleware/validation';
import { enforcePriceRange, productFilterSchema, productFilterWhere } from '../middleware/product-filters';

const router = Router();

// Public sort names -> real columns, so callers see `name`, never internals.
const CATEGORY_SORT_COLUMNS = { name: 'name', createdAt: 'createdAt' } as const;
// The nested product listing shares the product sort whitelist.
const PRODUCT_SORT_COLUMNS = { price: 'priceMinor', name: 'name', createdAt: 'createdAt' } as const;

const categoryQuerySchema = createPaginationQuerySchema(Object.keys(CATEGORY_SORT_COLUMNS));
const productQuerySchema = createPaginationQuerySchema(Object.keys(PRODUCT_SORT_COLUMNS));

// Two explicit filters replace the old free-text `q`: `name` (contains,
// case-insensitive) and `slug` (exact match; the value is lowercased first, so
// `slug=ELECTRONICS` matches the stored `electronics`).
const categoryFilterSchema = z.object({
  name: z.string().min(1, 'name must be a non-empty string').optional(),
  slug: z.string().min(1, 'slug must be a non-empty string').toLowerCase().optional(),
});

// The nested product listing accepts exactly the same price/stock filters as
// GET /products, via the shared schema plus the shared minPrice <= maxPrice rule.
const nestedProductFilterSchema = productFilterSchema.superRefine(enforcePriceRange);

const selectCategory = { id: true, name: true, slug: true, createdAt: true } as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset, sort } = parsePaginationQuery(categoryQuerySchema, req);
    const field = (sort?.field ?? 'name') as keyof typeof CATEGORY_SORT_COLUMNS;
    const direction = sort?.direction ?? 'asc';

    const filters = parseFilterQuery(categoryFilterSchema, req);
    const where = {
      ...(filters.name !== undefined
        ? { name: { contains: escapeLikePattern(filters.name), mode: 'insensitive' as const } }
        : {}),
      ...(filters.slug !== undefined ? { slug: filters.slug } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.category.count({ where }),
      prisma.category.findMany({
        where,
        // id breaks ties: every seeded createdAt is identical, and offset
        // pagination must return the same rows page after page.
        orderBy: [{ [CATEGORY_SORT_COLUMNS[field]]: direction }, { id: 'asc' }],
        skip: offset,
        take: limit,
        select: selectCategory,
      }),
    ]);

    res.json(ok(rows, listMeta(total, limit, offset, rows.length)));
  })
);

router.get(
  '/:id',
  validateUuidParam('id'),
  asyncHandler(async (req, res) => {
    const row = await prisma.category.findUnique({ where: { id: uuidParam(req, 'id') }, select: selectCategory });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Category not found');
    res.json(okItem(row));
  })
);

// Nested listing: one category's products, paginated and sortable by price.
router.get(
  '/:id/products',
  validateUuidParam('id'),
  asyncHandler(async (req, res) => {
    const { limit, offset, sort } = parsePaginationQuery(productQuerySchema, req);
    const filters = parseFilterQuery(nestedProductFilterSchema, req);

    const category = await prisma.category.findUnique({ where: { id: uuidParam(req, 'id') }, select: { id: true } });
    if (!category) throw new ApiError(404, 'NOT_FOUND', 'Category not found');

    const where = { categoryId: category.id, ...productFilterWhere(filters) };
    const field = (sort?.field ?? 'createdAt') as keyof typeof PRODUCT_SORT_COLUMNS;
    const direction = sort?.direction ?? 'desc';

    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: [{ [PRODUCT_SORT_COLUMNS[field]]: direction }, { id: 'asc' }],
        skip: offset,
        take: limit,
        select: { id: true, name: true, priceMinor: true, currency: true, stock: true, createdAt: true },
      }),
    ]);

    res.json(ok(rows, listMeta(total, limit, offset, rows.length)));
  })
);

export default router;
