import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../utils/async';
import { ApiError, cursorMeta, listMeta, ok, okItem } from '../utils/response';
import {
  createPaginationQuerySchema,
  encodeCursor,
  parseCursorQuery,
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
    const cursorId = parseCursorQuery(req);
    const field = (sort?.field ?? 'price') as keyof typeof SORT_COLUMNS;
    const direction = sort?.direction ?? 'asc';

    const where = {
      ...(filters.category ? { category: { slug: filters.category } } : {}),
      ...productFilterWhere(filters),
    };

    // id keeps pages stable when price/name/createdAt tie, and Prisma's cursor
    // anchors on exactly this ordering.
    const orderBy = [{ [SORT_COLUMNS[field]]: direction }, { id: 'asc' as const }];

    if (cursorId !== undefined) {
      // Prisma's `cursor` compiles to scalar subqueries
      // (`... > (SELECT priceMinor ... WHERE id = $cursor)`); a cursor whose row
      // is gone makes those NULL, so Prisma answers 200 with an empty page
      // rather than throwing. Verify the row is still part of THIS filtered
      // result set and reject it as 400, so a vanished/filter-mismatched cursor
      // is never mistaken for "you reached the end".
      const anchor = await prisma.product.findFirst({
        where: { ...where, id: cursorId },
        select: { id: true },
      });
      if (!anchor) {
        throw new ApiError(400, 'BAD_QUERY_PARAMS', 'cursor: no longer points at a product in this result set');
      }

      const [total, rows] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          orderBy,
          cursor: { id: cursorId },
          // skip:1 drops the cursor row itself; the extra row tells us hasMore.
          skip: 1,
          take: limit + 1,
          select: selectProduct,
        }),
      ]);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id) : null;

      res.json(ok(page, cursorMeta(total, limit, hasMore, nextCursor)));
      return;
    }

    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        select: selectProduct,
      }),
    ]);

    // Offset mode keeps its existing meta and additionally advertises the cursor
    // for the next page, so a client can switch to cursor paging mid-browse.
    const hasMore = offset + rows.length < total;
    const nextCursor = hasMore ? encodeCursor(rows[rows.length - 1].id) : null;

    res.json(ok(rows, { ...listMeta(total, limit, offset, rows.length), nextCursor }));
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
