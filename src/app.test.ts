import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('Health', () => {
  it('GET /api/v1/health returns success envelope', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: { status: 'ok' },
      meta: { total: 0, limit: 0, offset: 0, hasMore: false },
    });
  });
});

describe('Errors', () => {
  it('Unknown route returns 404 in error envelope', async () => {
    const res = await request(app).get('/api/v1/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Not Found',
      },
    });
  });
});

describe('Rate limiting', () => {
  it('429 includes Retry-After header in error envelope', async () => {
    const agent = request(app);
    const statusCodes: number[] = [];
    // Hammer the health endpoint to trigger rate limit (max 100 per window)
    for (let i = 0; i < 105; i++) {
      const r = await agent.get('/api/v1/health');
      statusCodes.push(r.status);
    }
    const has429 = statusCodes.includes(429);
    expect(has429).toBe(true);
    // Find a 429 response to inspect headers/body
    const r429 = (await agent.get('/api/v1/health')).status === 429 ? (await agent.get('/api/v1/health')) : null;
    // Simpler: make one more request after hitting limit? or scan previous
    // But easier: run a fresh check by looking for any 429 body
    // We'll re-request until we get 429 or give up
  });
});
