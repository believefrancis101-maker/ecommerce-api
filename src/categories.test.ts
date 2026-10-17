import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from './app';
import { prisma } from './db';

// A syntactically valid UUID that is guaranteed not to exist in the seed.
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/v1/categories', () => {
  it('returns the default page in the success envelope', async () => {
    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 20, limit: 20, offset: 0, hasMore: false });
    expect(res.body.data).toHaveLength(20);
  });

  it('paginates with limit and offset without dropping or repeating rows', async () => {
    const first = await request(app).get('/api/v1/categories?limit=5&offset=0');
    expect(first.body.data).toHaveLength(5);
    expect(first.body.meta).toMatchObject({ total: 20, limit: 5, offset: 0, hasMore: true });

    const last = await request(app).get('/api/v1/categories?limit=5&offset=18');
    expect(last.body.data).toHaveLength(2);
    expect(last.body.meta).toMatchObject({ total: 20, limit: 5, offset: 18, hasMore: false });

    const ids = [...first.body.data, ...last.body.data].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('clamps an oversized limit instead of returning the whole collection', async () => {
    const res = await request(app).get('/api/v1/categories?limit=1000');
    expect(res.body.meta.limit).toBe(100);
    expect(res.body.data.length).toBeLessThanOrEqual(100);
  });

  it('rejects a non-numeric limit with 400', async () => {
    const res = await request(app).get('/api/v1/categories?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });

  it('filters by q on name and slug, case-insensitively', async () => {
    const res = await request(app).get('/api/v1/categories?q=ELECTRONICS');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].slug).toBe('electronics');
  });

  it('sorts by a whitelisted field and order', async () => {
    const res = await request(app).get('/api/v1/categories?sort=name&order=desc');
    const ids = res.body.data.map((c: { id: string }) => c.id);
    const expected = await prisma.category.findMany({
      orderBy: [{ name: 'desc' }, { id: 'asc' }],
      take: 20,
      select: { id: true },
    });
    expect(ids).toEqual(expected.map((c) => c.id));
  });

  it('sorts by createdAt, tie-broken by id so pages stay stable', async () => {
    const res = await request(app).get('/api/v1/categories?sort=createdAt&order=asc');
    const ids = res.body.data.map((c: { id: string }) => c.id);
    const expected = await prisma.category.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20,
      select: { id: true },
    });
    expect(ids).toEqual(expected.map((c) => c.id));
  });

  it('rejects a sort field outside the whitelist with 400', async () => {
    const res = await request(app).get('/api/v1/categories?sort=price');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });
});

describe('GET /api/v1/categories/:id', () => {
  it('returns a single category with no meta', async () => {
    const one = await prisma.category.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const res = await request(app).get(`/api/v1/categories/${one.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        id: one.id,
        name: one.name,
        slug: one.slug,
        createdAt: one.createdAt.toISOString(),
      },
    });
    expect(res.body.meta).toBeUndefined();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get(`/api/v1/categories/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 rather than 500 for a malformed id', async () => {
    const res = await request(app).get('/api/v1/categories/not-a-uuid');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/categories/:id/products', () => {
  it("lists that category's products, paginated", async () => {
    const category = await prisma.category.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const res = await request(app).get(`/api/v1/categories/${category.id}/products?limit=5`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 20, limit: 5, offset: 0, hasMore: true });
    expect(res.body.data).toHaveLength(5);
  });

  it('returns 404 when the parent category does not exist', async () => {
    const res = await request(app).get(`/api/v1/categories/${MISSING_ID}/products`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
