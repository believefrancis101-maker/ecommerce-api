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

const router = Router();

const SORT_COLUMNS = { name: 'name', createdAt: 'createdAt' } as const;

const querySchema = createPaginationQuerySchema(Object.keys(SORT_COLUMNS));

// Two explicit filters replace the old free-text `q`; both are `contains` and
// case-insensitive. When both are supplied they are combined with AND.
const filterSchema = z.object({
  name: z.string().min(1, 'name must be a non-empty string').optional(),
  email: z.string().min(1, 'email must be a non-empty string').optional(),
});

const selectCustomer = { id: true, name: true, email: true, createdAt: true } as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset, sort } = parsePaginationQuery(querySchema, req);
    const field = (sort?.field ?? 'name') as keyof typeof SORT_COLUMNS;
    const direction = sort?.direction ?? 'asc';

    const filters = parseFilterQuery(filterSchema, req);
    const where = {
      ...(filters.name !== undefined
        ? { name: { contains: escapeLikePattern(filters.name), mode: 'insensitive' as const } }
        : {}),
      ...(filters.email !== undefined
        ? { email: { contains: escapeLikePattern(filters.email), mode: 'insensitive' as const } }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: [{ [SORT_COLUMNS[field]]: direction }, { id: 'asc' }],
        skip: offset,
        take: limit,
        select: selectCustomer,
      }),
    ]);

    res.json(ok(rows, listMeta(total, limit, offset, rows.length)));
  })
);

router.get(
  '/:id',
  validateUuidParam('id'),
  asyncHandler(async (req, res) => {
    const row = await prisma.customer.findUnique({ where: { id: uuidParam(req, 'id') }, select: selectCustomer });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Customer not found');
    res.json(okItem(row));
  })
);

export default router;
