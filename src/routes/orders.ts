import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
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

const allowedStatuses = ['pending', 'paid', 'shipped', 'cancelled'] as const;

// Renders a Zod issue location as a JSON-path-ish field name: array indices use
// brackets ("items[0].quantity"), object keys use dots. An issue with no path is
// either an unrecognised key (name it) or the whole body.
const describeIssueField = (issue: z.ZodIssue | undefined): string => {
  if (!issue) return 'body';
  if (issue.path.length > 0) {
    return issue.path.reduce<string>(
      (acc, segment) => (typeof segment === 'number' ? `${acc}[${segment}]` : acc ? `${acc}.${segment}` : segment),
      ''
    );
  }
  return issue.code === 'unrecognized_keys' ? issue.keys.join(', ') : 'body';
};

const selectOrder = {
  id: true,
  customerId: true,
  status: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Single source of truth for the order-detail shape, shared by GET /orders/:id
// and PATCH /orders/:id so both return exactly the same body: the order head,
// its items and totalMinor. The total is SUM(quantity * unitPriceMinor)
// evaluated in Postgres on every read - never stored - so it always agrees with
// the items. `quantity` is cast to bigint BEFORE the multiply: quantity and
// unitPriceMinor are both int4, so int4 * int4 overflows above 2,147,483,647
// (e.g. 2 x 2,000,000,000) before the SUM ever runs. Returns null when the
// order does not exist.
const loadOrderDetail = async (id: string) => {
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
      SELECT COALESCE(SUM(oi.quantity::bigint * oi."unitPriceMinor"), 0)::bigint AS total
      FROM "OrderItem" oi
      WHERE oi."orderId" = ${id}::uuid
    `,
  ]);

  if (!order) return null;

  const { orderItems, ...head } = order;
  // ::bigint arrives as a JS bigint, which JSON cannot serialize -> Number().
  return { ...head, items: orderItems, totalMinor: Number(totalRow.total) };
};

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
        SELECT oi."orderId", COALESCE(SUM(oi.quantity::bigint * oi."unitPriceMinor"), 0)::bigint AS total
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
    const order = await loadOrderDetail(id);

    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found');

    res.json(okItem(order));
  })
);

// Body schema for POST /api/v1/orders. `.strict()` on every object means an
// unknown field (typo like "customerIdy") is a 422 naming that field instead of
// being silently dropped. Limits come from config.orders.
const itemSchema = z
  .object({
    productId: z.string().uuid({ message: 'productId must be a valid UUID' }),
    quantity: z
      .number({ invalid_type_error: 'quantity must be a number' })
      .int({ message: 'quantity must be an integer' })
      .min(1, { message: 'quantity must be >= 1' })
      .max(config.orders.maxQuantityPerItem, {
        message: `quantity must be <= ${config.orders.maxQuantityPerItem}`,
      }),
  })
  .strict();

const createOrderSchema = z
  .object({
    customerId: z.string().uuid({ message: 'customerId must be a valid UUID' }),
    items: z
      .array(itemSchema)
      .min(1, { message: 'at least one item is required' })
      .max(config.orders.maxItemsPerOrder, {
        message: `items must contain at most ${config.orders.maxItemsPerOrder} entries`,
      }),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'productId'],
          message: `duplicate productId ${item.productId}`,
        });
      }
      seen.add(item.productId);
    });
  });

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      // Name the exact field that failed (e.g. "items[0].quantity"), or the
      // unknown key itself when the body carries a field we don't recognise.
      throw new ApiError(
        422,
        'UNPROCESSABLE_ENTITY',
        `${describeIssueField(first)}: ${first?.message ?? 'Invalid body'}`
      );
    }
    const { customerId, items } = parsed.data;

    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    // A body that points at a customer/product row that does not exist is a
    // semantic failure of THIS request body -> 422 naming the field, not a 404
    // (the collection URI /api/v1/orders exists; 404 would blame the wrong thing).
    if (!customer) throw new ApiError(422, 'UNPROCESSABLE_ENTITY', 'customerId: customer does not exist');

    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, priceMinor: true } });
    if (products.length !== productIds.length) {
      const found = new Set(products.map((p) => p.id));
      const index = items.findIndex((i) => !found.has(i.productId));
      throw new ApiError(
        422,
        'UNPROCESSABLE_ENTITY',
        `items[${index}].productId: product does not exist`
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          customerId,
          status: 'pending',
        },
      });

      const itemsToCreate = items.map((item) => {
        const product = products.find((p) => p.id === item.productId)!;
        return {
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPriceMinor: product.priceMinor,
        };
      });

      await tx.orderItem.createMany({ data: itemsToCreate });

      const orderItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { id: true, productId: true, quantity: true, unitPriceMinor: true },
        orderBy: { id: 'asc' },
      });

      const totalMinor = orderItems.reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0);
      return {
        id: order.id,
        customerId: order.customerId,
        status: order.status,
        currency: order.currency,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        items: orderItems,
        totalMinor,
      };
    });

    res.location(`/api/v1/orders/${result.id}`);
    res.status(201).json(okItem(result));
  })
);

const updateStatusSchema = z
  .object({
    status: z.enum(allowedStatuses, {
      errorMap: () => ({ message: `status must be one of: ${allowedStatuses.join(', ')}` }),
    }),
  })
  .strict();

router.patch(
  '/:id',
  validateUuidParam('id'),
  asyncHandler(async (req, res) => {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ApiError(
        422,
        'UNPROCESSABLE_ENTITY',
        `${describeIssueField(first)}: ${first?.message ?? 'Invalid body'}`
      );
    }

    const id = uuidParam(req, 'id');
    const order = await prisma.order.findUnique({ where: { id }, select: { id: true } });
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found');

    await prisma.order.update({
      where: { id },
      data: { status: parsed.data.status },
    });

    // Return the SAME shape as GET /orders/:id (head + items + totalMinor), so a
    // client can PATCH and use the response directly without a follow-up GET.
    const updated = await loadOrderDetail(id);

    res.json(okItem(updated));
  })
);

router.delete(
  '/:id',
  validateUuidParam('id'),
  asyncHandler(async (req, res) => {
    const id = uuidParam(req, 'id');
    const order = await prisma.order.findUnique({ where: { id }, select: { id: true } });
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found');

    await prisma.order.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
