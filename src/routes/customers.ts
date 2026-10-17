import { Router } from 'express';
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

const SORT_COLUMNS = { name: 'name', createdAt: 'createdAt' } as const;

const querySchema = createPaginationQuerySchema(Object.keys(SORT_COLUMNS));

const selectCustomer = { id: true, name: true, email: true, createdAt: true } as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset, sort } = parsePaginationQuery(querySchema, req);
    const field = (sort?.field ?? 'name') as keyof typeof SORT_COLUMNS;
    const direction = sort?.direction ?? 'asc';

    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

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
