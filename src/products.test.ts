import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from './app';
import { prisma } from './db';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const MIN_PRICE = 5_000_000; // kobo
const MAX_PRICE = 10_000_000; // kobo

let categorySlug: string;

beforeAll(async () => {
  categorySlug = (await prisma.category.findFirstOrThrow({ orderBy: { id: 'asc' } })).slug;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/v1/products', () => {
  it('returns the default page in the success envelope', async () => {
    const res = await request(app).get('/api/v1/products');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 400, limit: 20, offset: 0, hasMore: true });
    expect(res.body.data).toHaveLength(20);
  });

  it('paginates up to a short tail page', async () => {
    const res = await request(app).get('/api/v1/products?limit=10&offset=395');
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta).toMatchObject({ total: 400, limit: 10, offset: 395, hasMore: false });
  });

  it('clamps an oversized limit', async () => {
    const res = await request(app).get('/api/v1/products?limit=5000');
    expect(res.body.meta.limit).toBe(100);
  });

  it('filters by category slug', async () => {
    const expected = await prisma.product.count({ where: { category: { slug: categorySlug } } });
    const res = await request(app).get(`/api/v1/products?category=${categorySlug}&limit=100`);
    expect(res.body.meta.total).toBe(expected);
    expect(res.body.data.every((p: { category: { slug: string } }) => p.category.slug === categorySlug)).toBe(
      true
    );
  });

  it('filters by minPrice and maxPrice in kobo', async () => {
    const expected = await prisma.product.count({
      where: { priceMinor: { gte: MIN_PRICE, lte: MAX_PRICE } },
    });
    const res = await request(app).get(`/api/v1/products?minPrice=${MIN_PRICE}&maxPrice=${MAX_PRICE}&limit=100`);
    expect(res.body.meta.total).toBe(expected);
    expect(
      res.body.data.every(
        (p: { priceMinor: number }) => p.priceMinor >= MIN_PRICE && p.priceMinor <= MAX_PRICE
      )
    ).toBe(true);
  });

  it('filters by inStock', async () => {
    const inStock = await request(app).get('/api/v1/products?inStock=true');
    expect(inStock.body.meta.total).toBe(400);

    const outOfStock = await request(app).get('/api/v1/products?inStock=false');
    expect(outOfStock.body.meta.total).toBe(0);
    expect(outOfStock.body.data).toHaveLength(0);
  });

  it('rejects an invalid inStock value with 400', async () => {
    const res = await request(app).get('/api/v1/products?inStock=maybe');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });

  it('returns empty data with hasMore false when offset exceeds total', async () => {
    const res = await request(app).get('/api/v1/products?offset=5000');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      meta: {
        total: 400,
        limit: 20,
        offset: 5000,
        hasMore: false,
      },
    });
  });

  it('rejects minPrice greater than maxPrice with 400', async () => {
    const res = await request(app).get('/api/v1/products?minPrice=200&maxPrice=100');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });

  it('sorts by price asc using the public field name', async () => {
    const res = await request(app).get('/api/v1/products?sort=price&order=asc');
    const ids = res.body.data.map((p: { id: string }) => p.id);
    const expected = await prisma.product.findMany({
      orderBy: [{ priceMinor: 'asc' }, { id: 'asc' }],
      take: 20,
      select: { id: true },
    });
    expect(ids).toEqual(expected.map((p) => p.id));
  });

  it('rejects a sort field outside the whitelist with 400', async () => {
    const res = await request(app).get('/api/v1/products?sort=stock');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });
});

describe('GET /api/v1/products/:id', () => {
  it('returns a single product with its category and no meta', async () => {
    const one = await prisma.product.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const res = await request(app).get(`/api/v1/products/${one.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: { id: one.id, name: one.name, priceMinor: one.priceMinor },
    });
    expect(res.body.meta).toBeUndefined();
    expect(res.body.data.category).toHaveProperty('slug');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get(`/api/v1/products/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 rather than 500 for a malformed id', async () => {
    const res = await request(app).get('/api/v1/products/not-a-uuid');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
