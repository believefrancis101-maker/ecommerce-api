import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from './app';
import { prisma } from './db';
import { config } from './config';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// Every order this file creates is tracked so afterEach can delete it. The
// shared test database must be back at the seeded 500 orders / 1513 items by
// the end of each test, or the count-based assertions in orders.test.ts fail.
const createdOrderIds: string[] = [];

const track = (id: string) => {
  createdOrderIds.push(id);
  return id;
};

afterEach(async () => {
  if (createdOrderIds.length > 0) {
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    createdOrderIds.length = 0;
  }
});

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  await prisma.$disconnect();
});

const seedIds = async () => {
  const customer = await prisma.customer.findFirstOrThrow({ select: { id: true } });
  const products = await prisma.product.findMany({ take: 2, select: { id: true, priceMinor: true } });
  return { customerId: customer.id, products };
};

describe('POST /api/v1/orders', () => {
  it('creates an order and returns 201 with Location header, items and computed total', async () => {
    const { customerId, products } = await seedIds();
    const res = await request(app)
      .post('/api/v1/orders')
      .send({
        customerId,
        items: [
          { productId: products[0].id, quantity: 2 },
          { productId: products[1].id, quantity: 3 },
        ],
      });
    expect(res.status).toBe(201);
    // Track BEFORE the content assertions: if one of them fails the order must
    // still be cleaned up, or later count-based tests see 501 rows.
    track(res.body.data.id);
    expect(res.body.data).toHaveProperty('id');
    expect(res.headers.location).toBe(`/api/v1/orders/${res.body.data.id}`);
    expect(res.body.data.customerId).toBe(customerId);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.items).toHaveLength(2);
    // unitPriceMinor is copied from the product's current price. Items come
    // back sorted by item id, so match them to the request by productId.
    const itemByProduct = new Map<string, { unitPriceMinor: number; quantity: number }>(
      res.body.data.items.map((i: any) => [i.productId, i])
    );
    expect(itemByProduct.get(products[0].id)?.unitPriceMinor).toBe(products[0].priceMinor);
    expect(itemByProduct.get(products[1].id)?.unitPriceMinor).toBe(products[1].priceMinor);
    const total = res.body.data.items.reduce((s: number, i: any) => s + i.quantity * i.unitPriceMinor, 0);
    expect(res.body.data.totalMinor).toBe(total);
  });

  it('returns 422 naming customerId when customerId is missing', async () => {
    const { products } = await seedIds();
    const res = await request(app)
      .post('/api/v1/orders')
      .send({ items: [{ productId: products[0].id, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(res.body.error.message).toContain('customerId');
  });

  it('returns 422 naming items when items is missing', async () => {
    const { customerId } = await seedIds();
    const res = await request(app).post('/api/v1/orders').send({ customerId });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('items');
  });

  it('returns 422 naming the field when a field has the wrong type', async () => {
    const { customerId, products } = await seedIds();
    // customerId as a number, quantity as a string.
    let res = await request(app)
      .post('/api/v1/orders')
      .send({ customerId: 123, items: [{ productId: products[0].id, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('customerId');

    res = await request(app)
      .post('/api/v1/orders')
      .send({ customerId, items: [{ productId: products[0].id, quantity: '2' }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('items[0].quantity');
  });

  it('returns 422 when an id is not a UUID', async () => {
    const { customerId, products } = await seedIds();

    let res = await request(app)
      .post('/api/v1/orders')
      .send({ customerId: 'not-a-uuid', items: [{ productId: products[0].id, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('customerId');

    res = await request(app)
      .post('/api/v1/orders')
      .send({ customerId, items: [{ productId: 'not-a-uuid', quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('items[0].productId');
  });

  it('returns 422 when there are no items', async () => {
    const { customerId } = await seedIds();
    const res = await request(app).post('/api/v1/orders').send({ customerId, items: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('items');
  });

  it('returns 422 when quantity is 0', async () => {
    const { customerId, products } = await seedIds();
    const res = await request(app)
      .post('/api/v1/orders')
      .send({ customerId, items: [{ productId: products[0].id, quantity: 0 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('items[0].quantity');
  });

  it('returns 422 when quantity exceeds the configured maximum', async () => {
    const { customerId, products } = await seedIds();
    const res = await request(app)
      .post('/api/v1/orders')
      .send({
        customerId,
        items: [{ productId: products[0].id, quantity: config.orders.maxQuantityPerItem + 1 }],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('items[0].quantity');
    expect(res.body.error.message).toContain(String(config.orders.maxQuantityPerItem));
  });

  it('returns 422 when there are more items than the configured maximum', async () => {
    const { customerId, products } = await seedIds();
    const items = Array.from({ length: config.orders.maxItemsPerOrder + 1 }, (_, i) => ({
      // Unique UUIDs so the only failing rule is the count limit.
      productId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      quantity: 1,
    }));
    // Ensure at least one real product so nothing else can fail first.
    items[0].productId = products[0].id;
    const res = await request(app).post('/api/v1/orders').send({ customerId, items });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('items');
    expect(res.body.error.message).toContain(String(config.orders.maxItemsPerOrder));
  });

  it('returns 422 when productId is duplicated across items', async () => {
    const { customerId, products } = await seedIds();
    const res = await request(app)
      .post('/api/v1/orders')
      .send({
        customerId,
        items: [
          { productId: products[0].id, quantity: 1 },
          { productId: products[0].id, quantity: 2 },
        ],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('items[1].productId');
    expect(res.body.error.message).toContain('duplicate productId');
  });

  it('returns 422 naming an unexpected extra field instead of dropping it', async () => {
    const { customerId, products } = await seedIds();
    const res = await request(app)
      .post('/api/v1/orders')
      .send({
        customerId,
        items: [{ productId: products[0].id, quantity: 1 }],
        note: 'rush delivery',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('note');
  });

  it('returns 400 INVALID_JSON for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Content-Type', 'application/json')
      .send('{"customerId": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 for an oversized body', async () => {
    const { customerId, products } = await seedIds();
    const res = await request(app)
      .post('/api/v1/orders')
      .send({
        customerId,
        items: [{ productId: products[0].id, quantity: 1 }],
        pad: 'x'.repeat(150 * 1024), // > config.jsonBodyLimit (100kb)
      });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 422 naming customerId when the customer does not exist', async () => {
    const { products } = await seedIds();
    const res = await request(app)
      .post('/api/v1/orders')
      .send({ customerId: MISSING_ID, items: [{ productId: products[0].id, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(res.body.error.message).toBe('customerId: customer does not exist');
  });

  it('returns 422 naming items[0].productId when the product does not exist', async () => {
    const { customerId } = await seedIds();
    const res = await request(app)
      .post('/api/v1/orders')
      .send({ customerId, items: [{ productId: MISSING_ID, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(res.body.error.message).toBe('items[0].productId: product does not exist');
  });

  it('rolls back the created order when the item insert fails mid-transaction, leaving order count unchanged', async () => {
    const { customerId, products } = await seedIds();
    const ordersBefore = await prisma.order.count();
    const itemsBefore = await prisma.orderItem.count();

    // Run the REAL interactive transaction, but hand the handler a tx client
    // whose orderItem.createMany rejects. tx.order.create therefore commits a
    // real Order row inside the transaction a moment before the insert blows
    // up, which is exactly the mid-transaction failure whose rollback we want
    // to prove. (Spies are not used on Prisma delegates: mockRestore does not
    // round-trip and breaks findMany for every later test in the file, so the
    // original $transaction is saved and restored by hand instead.)
    type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
    const realTransaction = prisma.$transaction.bind(prisma);
    const failingTransaction = (fn: (tx: Tx) => Promise<unknown>) =>
      realTransaction(async (tx) => {
        const sabotaged = new Proxy(tx, {
          get(target, prop) {
            if (prop === 'orderItem') {
              return {
                createMany: () =>
                  Promise.reject(new Error('simulated orderItem.insert failure')),
              };
            }
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return fn(sabotaged);
      });

    const client = prisma as unknown as { $transaction: unknown };
    client.$transaction = failingTransaction;
    // The real error is logged server-side; capture it so the test does not
    // spew a stack, and so we can assert it was logged. (mockRestore clears the
    // recorded calls, so snapshot them before restoring.)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let res;
    let loggedArgs: unknown[];
    try {
      res = await request(app)
        .post('/api/v1/orders')
        .send({ customerId, items: [{ productId: products[0].id, quantity: 1 }] });
    } finally {
      client.$transaction = realTransaction;
      loggedArgs = errSpy.mock.calls[0] ?? [];
      errSpy.mockRestore();
    }

    expect(res.status).toBe(500);
    // The response is generic: the internal failure must NOT leak to the client.
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('simulated');
    // ...but it must be logged (with the stack) server-side.
    expect(loggedArgs.length).toBeGreaterThan(0);
    const loggedError = loggedArgs.find((a): a is Error => a instanceof Error);
    expect(loggedError?.message).toContain('simulated orderItem.insert failure');
    expect(await prisma.order.count()).toBe(ordersBefore);
    expect(await prisma.orderItem.count()).toBe(itemsBefore);
  });

  it('does not overflow totalMinor for a large quantity x price, in both detail and list reads', async () => {
    // quantity * unitPriceMinor is int4 * int4 in Postgres, which overflows above
    // 2,147,483,647 BEFORE the SUM runs. 2 x 2,000,000,000 = 4,000,000,000 is a
    // value that only comes out right if quantity is cast to bigint first.
    const customer = await prisma.customer.findFirstOrThrow({ select: { id: true } });
    const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
    const product = await prisma.product.create({
      data: {
        categoryId: category.id,
        name: 'Overflow probe product',
        priceMinor: 2_000_000_000,
        stock: 10,
      },
      select: { id: true },
    });

    let orderId: string | undefined;
    try {
      const create = await request(app)
        .post('/api/v1/orders')
        .send({ customerId: customer.id, items: [{ productId: product.id, quantity: 2 }] });
      expect(create.status).toBe(201);
      orderId = track(create.body.data.id);
      // The create path totals in JS (a safe number), so it is already correct.
      expect(create.body.data.totalMinor).toBe(4_000_000_000);

      // The two Postgres SUMs are where the int4 overflow used to bite.
      const detail = await request(app).get(`/api/v1/orders/${orderId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.totalMinor).toBe(4_000_000_000);

      const list = await request(app).get('/api/v1/orders?limit=100');
      expect(list.status).toBe(200);
      const listed = list.body.data.find((o: { id: string }) => o.id === orderId);
      expect(listed).toBeDefined();
      expect(listed.totalMinor).toBe(4_000_000_000);
    } finally {
      // Clean up so counts return to 400 products / 500 orders / 1513 items.
      // Items first: OrderItem.productId is Restrict, so the product cannot go
      // until nothing references it.
      if (orderId) {
        await prisma.orderItem.deleteMany({ where: { orderId } });
        await prisma.order.deleteMany({ where: { id: orderId } });
        const i = createdOrderIds.indexOf(orderId);
        if (i >= 0) createdOrderIds.splice(i, 1);
      }
      await prisma.product.deleteMany({ where: { id: product.id } });
    }
  });
});

describe('PATCH /api/v1/orders/:id', () => {
  const createOrder = async () => {
    const { customerId, products } = await seedIds();
    const create = await request(app)
      .post('/api/v1/orders')
      .send({ customerId, items: [{ productId: products[0].id, quantity: 1 }] });
    expect(create.status).toBe(201);
    return track(create.body.data.id);
  };

  it('updates status and returns 200 with the same shape as GET /orders/:id', async () => {
    const id = await createOrder();
    const res = await request(app).patch(`/api/v1/orders/${id}`).send({ status: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.status).toBe('paid');
    expect(res.body.data).toHaveProperty('items');
    expect(res.body.data.items).toHaveLength(1);
    expect(typeof res.body.data.totalMinor).toBe('number');
    // Persisted, not just echoed.
    const row = await prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true } });
    expect(row.status).toBe('paid');

    // Exactly the detail shape: same keys, same items, same total as a GET.
    const get = await request(app).get(`/api/v1/orders/${id}`);
    expect(get.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(Object.keys(get.body.data).sort());
    expect(res.body.data.items).toEqual(get.body.data.items);
    expect(res.body.data.totalMinor).toBe(get.body.data.totalMinor);
  });

  it('returns 422 for a status outside the four allowed values', async () => {
    const id = await createOrder();
    const res = await request(app).patch(`/api/v1/orders/${id}`).send({ status: 'cancelled2' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('status');
  });

  it('returns 422 naming status when status is missing', async () => {
    const id = await createOrder();
    const res = await request(app).patch(`/api/v1/orders/${id}`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('status');
  });

  it('returns 422 for an extra field in the body', async () => {
    const id = await createOrder();
    const res = await request(app).patch(`/api/v1/orders/${id}`).send({ status: 'paid', note: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('note');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).patch(`/api/v1/orders/${MISSING_ID}`).send({ status: 'paid' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for malformed id', async () => {
    const res = await request(app).patch('/api/v1/orders/not-a-uuid').send({ status: 'paid' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/orders/:id', () => {
  const createOrder = async () => {
    const { customerId, products } = await seedIds();
    const create = await request(app)
      .post('/api/v1/orders')
      .send({ customerId, items: [{ productId: products[0].id, quantity: 1 }] });
    expect(create.status).toBe(201);
    return track(create.body.data.id);
  };

  it('deletes order and returns 204 with an empty body', async () => {
    const id = await createOrder();
    const del = await request(app).delete(`/api/v1/orders/${id}`);
    expect(del.status).toBe(204);
    expect(del.text).toBeFalsy();
    expect(await prisma.order.findUnique({ where: { id } })).toBeNull();
    // Items cascade with the order.
    expect(await prisma.orderItem.count({ where: { orderId: id } })).toBe(0);
  });

  it('returns 404 on a second DELETE of the same id', async () => {
    const id = await createOrder();
    const first = await request(app).delete(`/api/v1/orders/${id}`);
    expect(first.status).toBe(204);
    const second = await request(app).delete(`/api/v1/orders/${id}`);
    expect(second.status).toBe(404);
    expect(second.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).delete(`/api/v1/orders/${MISSING_ID}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for malformed id', async () => {
    const res = await request(app).delete('/api/v1/orders/not-a-uuid');
    expect(res.status).toBe(404);
  });
});
