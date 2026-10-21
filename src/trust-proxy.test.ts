import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import { config } from './config';

// Two entries in an X-Forwarded-For header, written the way the header is
// documented: the leftmost entry is the address the first proxy saw, the
// rightmost entry is the address of the proxy closest to the app.
//
//   X-Forwarded-For: a, b
//                  ^leftmost   ^rightmost (closest to the app)
//
// Express does not validate the entries, it only counts them, so plain labels
// are enough to show which entry becomes req.ip.
const LEFTMOST = 'a';
const RIGHTMOST = 'b';

const ORIGINAL_HOPS = process.env.TRUST_PROXY_HOPS;

afterEach(() => {
  if (ORIGINAL_HOPS === undefined) {
    delete process.env.TRUST_PROXY_HOPS;
  } else {
    process.env.TRUST_PROXY_HOPS = ORIGINAL_HOPS;
  }
});

/**
 * Boots a second, independent copy of the app with a given TRUST_PROXY_HOPS.
 * src/config.ts reads the environment and src/app.ts applies it at module load,
 * so the module registry has to be reset for every hop count.
 */
async function bootApp(hops: number): Promise<{ app: Express; trustProxy: unknown }> {
  vi.resetModules();
  process.env.TRUST_PROXY_HOPS = String(hops);
  const { default: app } = await import('./app');
  return { app, trustProxy: app.get('trust proxy') };
}

/**
 * Resolves the IP Express derives for a request, using the hop count the app
 * itself is configured with. Mirrors Express' own req.ip calculation (the
 * socket peer plus X-Forwarded-For, walked back one hop per trusted hop).
 */
async function resolvedIp(app: Express, forwardedFor: string): Promise<string> {
  const probe = express();
  probe.set('trust proxy', app.get('trust proxy'));
  probe.get('/', (req, res) => res.json({ ip: req.ip, ips: req.ips }));
  const res = await request(probe).get('/').set('X-Forwarded-For', forwardedFor);
  return res.body.ip as string;
}

/** Sends `count` requests that all land in the same limiter bucket. */
async function fillBudget(app: Express, forwardedFor: string, count = 100): Promise<void> {
  for (let i = 0; i < count; i++) {
    await request(app).get('/api/v1/health').set('X-Forwarded-For', forwardedFor);
  }
}

describe('TRUST_PROXY_HOPS', () => {
  it('defaults to 1 and is applied to the Express trust proxy setting', async () => {
    expect(config.trustProxyHops).toBe(1);

    const { app, trustProxy } = await bootApp(1);
    expect(trustProxy).toBe(1);
    expect(app.get('trust proxy')).toBe(1);
  });

  it('is read from the environment', async () => {
    const { app, trustProxy } = await bootApp(2);
    expect(trustProxy).toBe(2);
    expect(app.get('trust proxy')).toBe(2);
  });

  it('rejects values that are not integers between 0 and 5', async () => {
    for (const bad of ['-1', '6', '1.5', 'abc']) {
      vi.resetModules();
      process.env.TRUST_PROXY_HOPS = bad;
      await expect(import('./config')).rejects.toThrow(/TRUST_PROXY_HOPS/);
    }
  });

  it('treats an unset or blank value as the default of 1', async () => {
    for (const value of [undefined, '', '   ']) {
      vi.resetModules();
      if (value === undefined) {
        delete process.env.TRUST_PROXY_HOPS;
      } else {
        process.env.TRUST_PROXY_HOPS = value;
      }
      const { config: fresh } = await import('./config');
      expect(fresh.trustProxyHops).toBe(1);
    }
  });
});

describe('Rate limiter key vs. X-Forwarded-For', () => {
  it('hops=1: the limiter keys on the rightmost entry (b)', async () => {
    const { app } = await bootApp(1);

    expect(await resolvedIp(app, `${LEFTMOST}, ${RIGHTMOST}`)).toBe(RIGHTMOST);

    // Fill the bucket that is keyed on "b".
    await fillBudget(app, `${LEFTMOST}, ${RIGHTMOST}`);

    // Same rightmost entry, different leftmost entry -> same bucket -> limited.
    const sameBucket = await request(app)
      .get('/api/v1/health')
      .set('X-Forwarded-For', `other, ${RIGHTMOST}`);
    expect(sameBucket.status).toBe(429);

    // Different rightmost entry -> different bucket -> allowed.
    const otherBucket = await request(app)
      .get('/api/v1/health')
      .set('X-Forwarded-For', `${LEFTMOST}, other`);
    expect(otherBucket.status).toBe(200);
  }, 30000);

  it('hops=2: the limiter keys on the leftmost entry (a)', async () => {
    const { app } = await bootApp(2);

    expect(await resolvedIp(app, `${LEFTMOST}, ${RIGHTMOST}`)).toBe(LEFTMOST);

    // Fill the bucket that is keyed on "a".
    await fillBudget(app, `${LEFTMOST}, ${RIGHTMOST}`);

    // Same leftmost entry, different rightmost entry -> same bucket -> limited.
    const sameBucket = await request(app)
      .get('/api/v1/health')
      .set('X-Forwarded-For', `${LEFTMOST}, other`);
    expect(sameBucket.status).toBe(429);

    // Different leftmost entry -> different bucket -> allowed.
    const otherBucket = await request(app)
      .get('/api/v1/health')
      .set('X-Forwarded-For', `other, ${RIGHTMOST}`);
    expect(otherBucket.status).toBe(200);
  }, 30000);
});

describe('Forged X-Forwarded-For protection', () => {
  it('a forged leftmost value cannot reset the budget when the hop count is right', async () => {
    const { app } = await bootApp(1);

    await fillBudget(app, `${LEFTMOST}, ${RIGHTMOST}`);

    // The caller rotates the leftmost value hoping to land in a fresh bucket.
    // The limiter keys on the rightmost, proxy controlled entry, so every
    // rotation is charged to the same exhausted budget.
    for (const forged of ['forged-1', 'forged-2', 'forged-3', 'forged-4']) {
      const res = await request(app)
        .get('/api/v1/health')
        .set('X-Forwarded-For', `${forged}, ${RIGHTMOST}`);
      expect(res.status).toBe(429);
    }
  }, 30000);

  it('shows why the hop count has to match the deployment: at hops=2 a forged leftmost value does reset the budget', async () => {
    const { app } = await bootApp(2);

    await fillBudget(app, `${LEFTMOST}, ${RIGHTMOST}`);

    // With one hop too many, the caller supplied leftmost entry becomes the
    // key, so the forged value lands in a fresh bucket and the limit is
    // bypassed. This is exactly what TRUST_PROXY_HOPS=2 must not do on a
    // deployment whose X-Forwarded-For only carries one proxy entry.
    const res = await request(app)
      .get('/api/v1/health')
      .set('X-Forwarded-For', `forged, ${RIGHTMOST}`);
    expect(res.status).toBe(200);
  }, 30000);
});
