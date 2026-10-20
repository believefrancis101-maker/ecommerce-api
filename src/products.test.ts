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
    expect(res.body.meta).toEqual({
      total: 400,
      limit: 20,
      offset: 0,
      hasMore: true,
      nextCursor: Buffer.from(res.body.data[19].id, 'utf8').toString('base64url'),
    });
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
        nextCursor: null,
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

describe('GET /api/v1/products cursor pagination', () => {
  const encodeId = (id: string) => Buffer.from(id, 'utf8').toString('base64url');

  // The matrix fires far more than the app's 100 requests/60s per-IP budget, and
  // the rate limiter is a cross-cutting concern with its own tests. Hand every
  // walk request a distinct client IP (trust proxy is on) so the walk is never
  // throttled and the pagination behaviour is what actually gets exercised.
  let clientOctet = 0;
  const nextClientIp = (): string => `10.20.${Math.floor(clientOctet / 250)}.${clientOctet++ % 250}`;

  // Follows nextCursor to the end of the (optionally filtered) list and returns
  // every id in visit order. The first request has no cursor, so it is offset
  // mode (offset + nextCursor); every later request is cursor mode (nextCursor
  // only, no offset).
  const walkByCursor = async (scope: string): Promise<string[]> => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const usedCursor = cursor !== null;
      const url = `/api/v1/products?${scope}&limit=50${
        usedCursor ? `&cursor=${encodeURIComponent(cursor as string)}` : ''
      }`;
      const res = await request(app).get(url).set('X-Forwarded-For', nextClientIp());
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.meta).sort()).toEqual(
        usedCursor
          ? ['hasMore', 'limit', 'nextCursor', 'total']
          : ['hasMore', 'limit', 'nextCursor', 'offset', 'total']
      );
      ids.push(...res.body.data.map((p: { id: string }) => p.id));
      cursor = res.body.meta.nextCursor as string | null;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(20);
    } while (cursor !== null);

    return ids;
  };

  // The offset-paged order for the exact same filters/sort - the reference the
  // cursor walk must reproduce row for row.
  const walkByOffset = async (scope: string, total: number): Promise<string[]> => {
    const ids: string[] = [];
    for (let offset = 0; offset < total; offset += 50) {
      const res = await request(app)
        .get(`/api/v1/products?${scope}&limit=50&offset=${offset}`)
        .set('X-Forwarded-For', nextClientIp());
      expect(res.status).toBe(200);
      ids.push(...res.body.data.map((p: { id: string }) => p.id));
    }
    return ids;
  };

  it('walks the whole table via nextCursor for every sort, order and category scope', async () => {
    const category = await prisma.category.findFirstOrThrow({ orderBy: { id: 'asc' }, select: { slug: true } });
    const scopes = [
      { scope: '', total: 400 },
      {
        scope: `category=${category.slug}`,
        total: await prisma.product.count({ where: { category: { slug: category.slug } } }),
      },
    ];

    for (const { scope, total } of scopes) {
      for (const field of ['price', 'name', 'createdAt'] as const) {
        for (const order of ['asc', 'desc'] as const) {
          const params = `${scope ? `${scope}&` : ''}sort=${field}&order=${order}`;
          const viaCursor = await walkByCursor(params);
          const viaOffset = await walkByOffset(params, total);

          // Every row visited exactly once...
          expect(viaCursor).toHaveLength(total);
          expect(new Set(viaCursor).size).toBe(total);
          // ...in exactly the offset-paging order. `createdAt` is pure ties
          // (all seeded rows share one value), so this can only hold if the
          // `{ id: 'asc' }` tiebreaker is applied on both paths.
          expect(viaCursor).toEqual(viaOffset);
        }
      }
    }
  });

  it('returns hasMore false and nextCursor null on the last page', async () => {
    // The page before the tail (offset 300) has more; follow its cursor home.
    const seventh = await request(app).get('/api/v1/products?limit=50&offset=300');
    expect(seventh.body.meta.hasMore).toBe(true);
    expect(seventh.body.meta.nextCursor).toEqual(encodeId(seventh.body.data[49].id));

    const last = await request(app).get(
      `/api/v1/products?limit=50&cursor=${encodeURIComponent(seventh.body.meta.nextCursor)}`
    );
    expect(last.status).toBe(200);
    expect(last.body.data).toHaveLength(50);
    expect(last.body.meta.hasMore).toBe(false);
    expect(last.body.meta.nextCursor).toBeNull();
  });

  it('rejects cursor combined with offset with 400', async () => {
    const res = await request(app).get('/api/v1/products?cursor=anything&offset=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });

  it('rejects a cursor that does not decode to a UUID with 400', async () => {
    const bad = ['not-a-real-cursor', Buffer.from('hello', 'utf8').toString('base64url'), ''];
    for (const value of bad) {
      const res = await request(app).get(`/api/v1/products?cursor=${encodeURIComponent(value)}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
    }
  });

  it('rejects a well-formed cursor whose row no longer exists with 400', async () => {
    // Prisma would otherwise silently answer 200 with an empty page here.
    const res = await request(app).get(`/api/v1/products?cursor=${encodeId(MISSING_ID)}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_QUERY_PARAMS');
  });

  it('follows a cursor inside a category filter and a descending price sort', async () => {
    const category = await prisma.category.findFirstOrThrow({ orderBy: { id: 'asc' }, select: { slug: true } });
    const total = await prisma.product.count({ where: { category: { slug: category.slug } } });

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await request(app).get(
        `/api/v1/products?category=${category.slug}&sort=price&order=desc&limit=7${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`
      );
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(total);
      expect(
        res.body.data.every((p: { category: { slug: string } }) => p.category.slug === category.slug)
      ).toBe(true);
      collected.push(...res.body.data.map((p: { id: string }) => p.id));
      cursor = res.body.meta.nextCursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(10);
    } while (cursor !== null);

    expect(collected).toHaveLength(total);
    expect(new Set(collected).size).toBe(total);

    // price DESC, then id ASC as the tiebreaker - exactly the route's orderBy.
    const expected = await prisma.product.findMany({
      where: { category: { slug: category.slug } },
      orderBy: [{ priceMinor: 'desc' }, { id: 'asc' }],
      select: { id: true },
    });
    expect(collected).toEqual(expected.map((p) => p.id));
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
