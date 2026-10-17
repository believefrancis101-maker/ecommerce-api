import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
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

const SORT_COLUMNS = { createdAt: 'createdAt' } as const;

const querySchema = createPaginationQuerySchema(Object.keys(SORT_COLUMNS));

// Mirrors the Postgres CHECK on Order.status. Rejecting an unknown status is a
// deliberate choice: silently returning 0 rows would hide client typos.
const filterSchema = z.object({
  status: z.enum(['pending', 'paid', 'shipped', 'cancelled']).optional(),
  customerId: z.string().uuid({ message: 'customerId must be a valid UUID' }).optional(),
});

const parseFilters = (req: Parameters<typeof parsePaginationQuery>[1]) => {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(400, 'BAD_QUERY_PARAMS', `${String(first.path[0])}: ${first.message}`);
  }
  return parsed.data;
};

const selectOrder = {
  id: true,
  customerId: true,
  status: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
} as const;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset, sort } = parsePaginationQuery(querySchema, req);
    const filters = parseFilters(req);
    const field = (sort?.field ?? 'createdAt') as keyof typeof SORT_COLUMNS;
    const direction = sort?.direction ?? 'desc';

    const where = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: [{ [SORT_COLUMNS[field]]: direction }, { id: 'asc' }],
        skip: offset,
        take: limit,
        select: selectOrder,
      }),
    ]);

    let totalsMap = new Map<string, number>();
    if (rows.length > 0) {
      const orderIds = rows.map((r) => r.id);
      const totals = await prisma.$queryRaw<Array<{ orderId: string; total: bigint }>>`
        SELECT oi."orderId", COALESCE(SUM(oi.quantity * oi."unitPriceMinor"), 0)::bigint AS total
        FROM "OrderItem" oi
        WHERE oi."orderId" IN (${Prisma.join(orderIds.map((id) => Prisma.sql`${id}::uuid`))})
        GROUP BY oi."orderId"
      `;
      totalsMap = new Map(totals.map((t) => [t.orderId, Number(t.total)]));
    }

    const data = rows.map((order) => ({
      ...order,
      totalMinor: totalsMap.get(order.id) ?? 0,
    }));

    res.json(ok(data, listMeta(total, limit, offset, data.length)));
  })
);

router.get(
  '/:id',
  validateUuidParam('id'),
  asyncHandler(async (req, res) => {
    const id = uuidParam(req, 'id');

    // Total is SUM(quantity * unitPriceMinor) evaluated in Postgres on every
    // read; it is never persisted, so it always agrees with the items below.
    const [order, [totalRow]] = await Promise.all([
      prisma.order.findUnique({
        where: { id },
        select: {
          ...selectOrder,
          orderItems: {
            select: { id: true, productId: true, quantity: true, unitPriceMinor: true },
            orderBy: { id: 'asc' },
          },
        },
      }),
      prisma.$queryRaw<[{ total: bigint }]>`
        SELECT COALESCE(SUM(oi.quantity * oi."unitPriceMinor"), 0)::bigint AS total
        FROM "OrderItem" oi
        WHERE oi."orderId" = ${id}::uuid
      `,
    ]);

    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found');

    const { orderItems, ...head } = order;
    // ::bigint arrives as a JS bigint, which JSON cannot serialize -> Number().
    res.json(okItem({ ...head, items: orderItems, totalMinor: Number(totalRow.total) }));
  })
);

export default router;
