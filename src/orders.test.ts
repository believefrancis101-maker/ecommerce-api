import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from './app';
import { prisma } from './db';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/v1/orders', () => {
  it('returns the default page in the success envelope, ordered by createdAt desc by default', async () => {
    const res = await request(app).get('/api/v1/orders');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 500, limit: 20, offset: 0, hasMore: true });
    expect(res.body.data).toHaveLength(20);

    const ids = res.body.data.map((o: { id: string }) => o.id);
    const expected = await prisma.order.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 20,
      select: { id: true },
    });
    expect(ids).toEqual(expected.map((o) => o.id));
  });

  it('paginates to a short tail page', async () => {
    const res = await request(app).get('/api/v1/orders?limit=25&offset=490');
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta).toMatchObject({ total: 500, limit: 25, offset: 490, hasMore: false });
  });

  it('returns empty data with hasMore false when offset exceeds total', async () => {
    const res = await request(app).get('/api/v1/orders?offset=5000');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      meta: {
        total: 500,
        limit: 20,
        offset: 5000,
        hasMore: false,
      },
    });
  });

  it('returns empty data with hasMore false for a valid customerId with no orders', async () => {
    const res = await request(app).get(`/api/v1/orders?customerId=${MISSING_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      meta: {
        total: 0,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
    });
  });

  it('clamps an oversized limit', async () => {
    const res = await request(app).get('/api/v1/orders?limit=1000');
    expect(res.body.meta.limit).toBe(100);
  });

  it('filters by status', async () => {
    const expected = await prisma.order.count({ where: { status: 'paid' } });
    const res = await request(app).get('/api/v1/orders?status=paid&limit=100');
    expect(res.body.meta.total).toBe(expected);
    expect(res.body.data.every((o: { status: string }) => o.status === 'paid')).toBe(true);
  });

  it('rejects an unknown status with 400', async () => {
    const res = await request(app).get('/api/v1/orders?status=refunded');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });

  it('filters by customerId', async () => {
    const order = await prisma.order.findFirstOrThrow({ select: { customerId: true } });
    const expected = await prisma.order.count({ where: { customerId: order.customerId } });
    const res = await request(app).get(`/api/v1/orders?customerId=${order.customerId}&limit=100`);
    expect(res.body.meta.total).toBe(expected);
    expect(res.body.data.every((o: { customerId: string }) => o.customerId === order.customerId)).toBe(true);
  });

  it('rejects a malformed customerId with 400', async () => {
    const res = await request(app).get('/api/v1/orders?customerId=not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });

  it('sorts by createdAt asc', async () => {
    const res = await request(app).get('/api/v1/orders?sort=createdAt&order=asc');
    const ids = res.body.data.map((o: { id: string }) => o.id);
    const expected = await prisma.order.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20,
      select: { id: true },
    });
    expect(ids).toEqual(expected.map((o) => o.id));
  });

  it('includes totalMinor on each order item in the list', async () => {
    const res = await request(app).get('/api/v1/orders?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    for (const order of res.body.data) {
      expect(typeof order.totalMinor).toBe('number');
      const items = await prisma.orderItem.findMany({
        where: { orderId: order.id },
        select: { quantity: true, unitPriceMinor: true },
      });
      const expectedTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
      expect(order.totalMinor).toBe(expectedTotal);
    }
  });
});

describe('GET /api/v1/orders/:id', () => {
  it('returns an order with items and a computed total without meta', async () => {
    const order = await prisma.order.findFirstOrThrow({
      orderBy: { id: 'asc' },
      include: { orderItems: { select: { quantity: true, unitPriceMinor: true } } },
    });
    const res = await request(app).get(`/api/v1/orders/${order.id}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toBeUndefined();
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBe(order.orderItems.length);

    const expectedTotal = order.orderItems.reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0);
    expect(res.body.data.totalMinor).toBe(expectedTotal);
    expect(typeof res.body.data.totalMinor).toBe('number');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get(`/api/v1/orders/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 rather than 500 for a malformed id', async () => {
    const res = await request(app).get('/api/v1/orders/not-a-uuid');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
