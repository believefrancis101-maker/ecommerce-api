import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from './app';
import { prisma } from './db';

// Stage 7: malformed / out-of-range / empty query inputs.
//
// The rest of the ugly-input matrix lives with its resource (products,
// categories, customers, orders.write) or in rate-limit.test.ts. This file
// covers the shared pagination schema plus the empty-filter and zero-value
// cases that were not already asserted anywhere.

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Query validation: limit must be a positive integer', () => {
  it('clamps a limit above the maximum to 100 (limit=5000 -> meta.limit=100)', async () => {
    const res = await request(app).get('/api/v1/products?limit=5000');
    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(100);
    expect(res.body.data).toHaveLength(100);
  });

  it('rejects limit=0 with 400 BAD_QUERY_PARAMS', async () => {
    const res = await request(app).get('/api/v1/products?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('limit');
  });

  it('rejects a negative limit with 400 BAD_QUERY_PARAMS', async () => {
    const res = await request(app).get('/api/v1/products?limit=-5');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('limit');
  });

  it('rejects a non-numeric limit with 400 BAD_QUERY_PARAMS', async () => {
    const res = await request(app).get('/api/v1/products?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('limit');
  });

  it('rejects an empty limit (?limit=) with 400 BAD_QUERY_PARAMS', async () => {
    const res = await request(app).get('/api/v1/products?limit=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('limit');
  });

  it('accepts offset=0', async () => {
    const res = await request(app).get('/api/v1/products?offset=0');
    expect(res.status).toBe(200);
    expect(res.body.meta.offset).toBe(0);
  });
});

describe('Query validation: zero is a real numeric filter', () => {
  it('applies maxPrice=0 as a real bound (matches nothing), not as "no filter"', async () => {
    const res = await request(app).get('/api/v1/products?maxPrice=0');
    expect(res.status).toBe(200);
    // If maxPrice=0 were dropped, this would fall back to all 400 products.
    expect(res.body.meta.total).toBe(0);
    expect(res.body.data).toHaveLength(0);
  });

  it('applies minPrice=0 as a real bound (all prices are >= 0)', async () => {
    const res = await request(app).get('/api/v1/products?minPrice=0');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(400);
  });

  it('applies minPrice=0 and maxPrice=0 together as a real range', async () => {
    const res = await request(app).get('/api/v1/products?minPrice=0&maxPrice=0');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
  });

  it('applies maxPrice=0 on /categories/:id/products as a real bound (shared schema)', async () => {
    const category = await prisma.category.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const res = await request(app).get(`/api/v1/categories/${category.id}/products?maxPrice=0`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('Query validation: an empty filter value is rejected, not ignored', () => {
  it('rejects an empty name on /categories', async () => {
    const res = await request(app).get('/api/v1/categories?name=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('name');
  });

  it('rejects an empty slug on /categories', async () => {
    const res = await request(app).get('/api/v1/categories?slug=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('slug');
  });

  it('rejects an empty name on /customers', async () => {
    const res = await request(app).get('/api/v1/customers?name=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('name');
  });

  it('rejects an empty email on /customers', async () => {
    const res = await request(app).get('/api/v1/customers?email=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('email');
  });

  it('rejects an empty category slug on /products', async () => {
    const res = await request(app).get('/api/v1/products?category=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('category');
  });

  it('rejects an empty minPrice on /products', async () => {
    const res = await request(app).get('/api/v1/products?minPrice=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('minPrice');
  });

  it('rejects an empty maxPrice on /products', async () => {
    const res = await request(app).get('/api/v1/products?maxPrice=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('maxPrice');
  });

  it('rejects an empty inStock on /products', async () => {
    const res = await request(app).get('/api/v1/products?inStock=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('inStock');
  });

  it('rejects an empty minPrice on /categories/:id/products', async () => {
    const category = await prisma.category.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const res = await request(app).get(`/api/v1/categories/${category.id}/products?minPrice=`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('minPrice');
  });

  it('rejects an empty inStock on /categories/:id/products', async () => {
    const category = await prisma.category.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const res = await request(app).get(`/api/v1/categories/${category.id}/products?inStock=`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    expect(res.body.error.message).toContain('inStock');
  });

  it('rejects an empty status on /orders', async () => {
    const res = await request(app).get('/api/v1/orders?status=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });

  it('rejects an empty customerId on /orders', async () => {
    const res = await request(app).get('/api/v1/orders?customerId=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });
});
