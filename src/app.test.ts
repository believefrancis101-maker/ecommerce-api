import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('Health', () => {
  it('GET /api/v1/health returns success envelope with no meta', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: { status: 'ok' },
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

