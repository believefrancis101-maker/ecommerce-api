import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('Rate limiting', () => {
  it('429 includes Retry-After header in error envelope', async () => {
    const agent = request(app);
    // Hit rate limit (max 100 per window)
    for (let i = 0; i < 105; i++) {
      await agent.get('/api/v1/health');
    }
    const res = await agent.get('/api/v1/health');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body).toEqual({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests, please try again later',
      },
    });
  }, 10000);
});
