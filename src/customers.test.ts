import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from './app';
import { prisma } from './db';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/v1/customers', () => {
  it('returns the default page in the success envelope', async () => {
    const res = await request(app).get('/api/v1/customers');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 300, limit: 20, offset: 0, hasMore: true });
    expect(res.body.data).toHaveLength(20);
  });

  it('paginates to a short tail page', async () => {
    const res = await request(app).get('/api/v1/customers?limit=10&offset=295');
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta).toMatchObject({ total: 300, limit: 10, offset: 295, hasMore: false });
  });

  it('clamps an oversized limit', async () => {
    const res = await request(app).get('/api/v1/customers?limit=200');
    expect(res.body.meta.limit).toBe(100);
  });

  it('filters by name (contains, case-insensitive)', async () => {
    const pick = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const fragment = pick.name.slice(0, 5).toUpperCase();
    const res = await request(app).get(`/api/v1/customers?name=${encodeURIComponent(fragment)}&limit=100`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((c: { id: string }) => c.id === pick.id)).toBe(true);
  });

  it('filters by email (contains, case-insensitive)', async () => {
    const pick = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const res = await request(app).get(
      `/api/v1/customers?email=${encodeURIComponent(pick.email.toUpperCase())}&limit=100`
    );
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((c: { id: string }) => c.id === pick.id)).toBe(true);
  });

  it('combines name and email with AND', async () => {
    const pick = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const res = await request(app).get(
      `/api/v1/customers?name=${encodeURIComponent(pick.name)}&email=${encodeURIComponent(pick.email)}&limit=100`
    );
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((c: { id: string }) => c.id === pick.id)).toBe(true);
  });

  it('sorts by a whitelisted field and order', async () => {
    const res = await request(app).get('/api/v1/customers?sort=name&order=desc');
    const ids = res.body.data.map((c: { id: string }) => c.id);
    const expected = await prisma.customer.findMany({
      orderBy: [{ name: 'desc' }, { id: 'asc' }],
      take: 20,
      select: { id: true },
    });
    expect(ids).toEqual(expected.map((c) => c.id));
  });

  it('rejects a sort field outside the whitelist with 400', async () => {
    const res = await request(app).get('/api/v1/customers?sort=email');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });
});

describe('GET /api/v1/customers/:id', () => {
  it('returns a single customer with no meta', async () => {
    const one = await prisma.customer.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const res = await request(app).get(`/api/v1/customers/${one.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        id: one.id,
        name: one.name,
        email: one.email,
        createdAt: one.createdAt.toISOString(),
      },
    });
    expect(res.body.meta).toBeUndefined();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get(`/api/v1/customers/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 rather than 500 for a malformed id', async () => {
    const res = await request(app).get('/api/v1/customers/not-a-uuid');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
