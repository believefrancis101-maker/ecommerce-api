import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from './app';
import { config } from './config';

// A body just over config.jsonBodyLimit (100kb): express.json rejects it with 413.
const oversizedBody = () => ({ pad: 'x'.repeat(110 * 1024) });

// This lives in its own file on purpose. The rate limiter's store is per app
// instance, so flooding it here cannot leak a 429 into the other order tests
// (Vitest isolates the module registry per file).
describe('Rate limiting runs before body parsing', () => {
  it('counts malformed and oversized requests: 400 and 413 both carry RateLimit headers', async () => {
    const malformed = await request(app)
      .post('/api/v1/orders')
      .set('Content-Type', 'application/json')
      .send('{"customerId": ');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    expect(malformed.headers['ratelimit-limit']).toBeDefined();
    expect(malformed.headers['ratelimit-remaining']).toBeDefined();

    const oversized = await request(app)
      .post('/api/v1/orders')
      .set('Content-Type', 'application/json')
      .send(oversizedBody());
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(oversized.headers['ratelimit-limit']).toBeDefined();
    expect(oversized.headers['ratelimit-remaining']).toBeDefined();
  }, 15000);

  it('returns 429 once enough oversized requests are sent', async () => {
    let status = 0;
    let code: string | undefined;
    let attempts = 0;
    const maxAttempts = config.rateLimit.max + 20;

    while (status !== 429 && attempts < maxAttempts) {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Content-Type', 'application/json')
        .send(oversizedBody());
      status = res.status;
      code = res.body?.error?.code;
      attempts++;
    }

    expect(status).toBe(429);
    expect(code).toBe('TOO_MANY_REQUESTS');
  }, 60000);
});
