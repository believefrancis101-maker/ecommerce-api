import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const ORIGINAL_CLIENT_IP_HEADER = process.env.CLIENT_IP_HEADER;
const ORIGINAL_TRUST_PROXY_HOPS = process.env.TRUST_PROXY_HOPS;
const ORIGINAL_LOG_CLIENT_IP_HEADER = process.env.LOG_CLIENT_IP_HEADER;

afterEach(() => {
  if (ORIGINAL_CLIENT_IP_HEADER === undefined) {
    delete process.env.CLIENT_IP_HEADER;
  } else {
    process.env.CLIENT_IP_HEADER = ORIGINAL_CLIENT_IP_HEADER;
  }
  if (ORIGINAL_TRUST_PROXY_HOPS === undefined) {
    delete process.env.TRUST_PROXY_HOPS;
  } else {
    process.env.TRUST_PROXY_HOPS = ORIGINAL_TRUST_PROXY_HOPS;
  }
  if (ORIGINAL_LOG_CLIENT_IP_HEADER === undefined) {
    delete process.env.LOG_CLIENT_IP_HEADER;
  } else {
    process.env.LOG_CLIENT_IP_HEADER = ORIGINAL_LOG_CLIENT_IP_HEADER;
  }
});

/**
 * Boots a fresh app with the given CLIENT_IP_HEADER and TRUST_PROXY_HOPS.
 * The module registry is reset so that config.ts and app.ts re-read the env.
 */
async function bootApp(
  clientIpHeader: string | undefined,
  trustProxyHops = 1,
  logClientIpHeader = false,
): Promise<Express> {
  vi.resetModules();
  if (clientIpHeader !== undefined) {
    process.env.CLIENT_IP_HEADER = clientIpHeader;
  } else {
    delete process.env.CLIENT_IP_HEADER;
  }
  process.env.TRUST_PROXY_HOPS = String(trustProxyHops);
  if (logClientIpHeader) {
    process.env.LOG_CLIENT_IP_HEADER = 'true';
  } else {
    delete process.env.LOG_CLIENT_IP_HEADER;
  }
  const { default: app } = await import('./app');
  return app;
}

/** Sends `count` requests with the given headers. */
async function fillBudget(
  app: Express,
  headers: Record<string, string>,
  count = 100,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await request(app).get('/api/v1/health').set(headers);
  }
}

// ---------------------------------------------------------------------------
// CLIENT_IP_HEADER enabled (set to "x-real-ip")
// ---------------------------------------------------------------------------
describe('CLIENT_IP_HEADER enabled', () => {
  it('keys on X-Real-IP: rotating X-Forwarded-For with a fixed X-Real-IP stays in one bucket', async () => {
    const app = await bootApp('x-real-ip');

    // Fill the bucket with a fixed X-Real-IP and varying X-Forwarded-For.
    await fillBudget(app, {
      'X-Real-IP': '1.2.3.4',
      'X-Forwarded-For': 'changing-each-time',
    });

    // One more request with a different X-Forwarded-For but same X-Real-IP → 429.
    const res = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '1.2.3.4', 'X-Forwarded-For': 'totally-different' });
    expect(res.status).toBe(429);
  }, 30000);

  it('ignores X-Forwarded-For entirely: adding it later does not create a new bucket', async () => {
    const app = await bootApp('x-real-ip');

    // Fill the bucket WITHOUT any X-Forwarded-For header at all.
    await fillBudget(app, { 'X-Real-IP': '1.2.3.4' });

    // Now add an X-Forwarded-For header. The key still comes from X-Real-IP,
    // so the request lands in the exhausted bucket and is rejected.
    const res = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '1.2.3.4', 'X-Forwarded-For': '9.9.9.9' });
    expect(res.status).toBe(429);
  }, 30000);

  it('a different X-Real-IP lands in a different bucket', async () => {
    const app = await bootApp('x-real-ip');

    // Fill one bucket.
    await fillBudget(app, { 'X-Real-IP': '1.2.3.4' });

    // Same bucket → exhausted.
    const exhausted = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '1.2.3.4' });
    expect(exhausted.status).toBe(429);

    // Different X-Real-IP → fresh bucket → 200.
    const fresh = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '5.6.7.8' });
    expect(fresh.status).toBe(200);
  }, 30000);

  it('accepts an IPv4 address', async () => {
    const app = await bootApp('x-real-ip');
    const res = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '192.168.1.1' });
    expect(res.status).toBe(200);
    // RateLimit-Remaining should show 99 (= max - 1), proving the budget was
    // charged to this specific IP, not to a shared "unknown" key.
    expect(res.headers['ratelimit-remaining']).toBe('99');
  });

  it('accepts an IPv6 address', async () => {
    const app = await bootApp('x-real-ip');
    const res = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '2001:db8::1' });
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-remaining']).toBe('99');
  });

  it('falls back to req.ip when X-Real-IP is missing', async () => {
    const app = await bootApp('x-real-ip');

    // Fill the budget WITHOUT the X-Real-IP header (falls back to req.ip).
    await fillBudget(app, {});

    // The next request without X-Real-IP should be in the same exhausted bucket.
    const exhausted = await request(app).get('/api/v1/health');
    expect(exhausted.status).toBe(429);

    // A request WITH a valid X-Real-IP should land in a different bucket → 200.
    const different = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '10.20.30.40' });
    expect(different.status).toBe(200);
  }, 30000);

  it('falls back to req.ip when X-Real-IP is not a valid IP', async () => {
    const app = await bootApp('x-real-ip');

    // Fill the budget with an invalid header value (falls back to req.ip).
    await fillBudget(app, { 'X-Real-IP': 'not-an-ip' });

    // The exhausted bucket is keyed on req.ip, so another invalid header → 429.
    const exhausted = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': 'also-not-an-ip' });
    expect(exhausted.status).toBe(429);
  }, 30000);

  it('falls back to req.ip when X-Real-IP is a comma-separated list', async () => {
    const app = await bootApp('x-real-ip');

    await fillBudget(app, { 'X-Real-IP': '1.2.3.4, 5.6.7.8' });

    // Comma-list is rejected → both fill the same req.ip bucket → 429.
    const exhausted = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '9.10.11.12, 13.14.15.16' });
    expect(exhausted.status).toBe(429);
  }, 30000);

  it('falls back to req.ip when X-Real-IP is empty', async () => {
    const app = await bootApp('x-real-ip');

    await fillBudget(app, { 'X-Real-IP': '' });

    const exhausted = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '' });
    expect(exhausted.status).toBe(429);
  }, 30000);

  it('falls back to req.ip when X-Real-IP is oversized', async () => {
    const app = await bootApp('x-real-ip');
    const oversized = '1'.repeat(100);

    await fillBudget(app, { 'X-Real-IP': oversized });

    const exhausted = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': oversized });
    expect(exhausted.status).toBe(429);
  }, 30000);
});

// ---------------------------------------------------------------------------
// CLIENT_IP_HEADER disabled (default)
// ---------------------------------------------------------------------------
describe('CLIENT_IP_HEADER disabled (default)', () => {
  it('a rotating X-Real-IP does NOT reset the budget when the setting is off', async () => {
    // CLIENT_IP_HEADER is unset → the limiter keys on req.ip.
    const app = await bootApp(undefined);

    // Fill the budget. All requests come from the same supertest socket, so
    // req.ip is constant regardless of the X-Real-IP header.
    await fillBudget(app, { 'X-Real-IP': '1.2.3.4' });

    // A different X-Real-IP must NOT help — the header is ignored.
    const res = await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '5.6.7.8' });
    expect(res.status).toBe(429);
  }, 30000);
});

// ---------------------------------------------------------------------------
// CLIENT_IP_HEADER config validation (allowlist)
// ---------------------------------------------------------------------------
describe('CLIENT_IP_HEADER config validation', () => {
  it('rejects a header name that is not in the allowlist', async () => {
    for (const bad of ['x-forwarded-for', 'cf-connecting-ip', 'custom-header', 'X-REAL-IP-EXTRA']) {
      vi.resetModules();
      process.env.CLIENT_IP_HEADER = bad;
      await expect(import('./config')).rejects.toThrow(/CLIENT_IP_HEADER/);
    }
  });

  it('accepts x-real-ip (case-insensitive)', async () => {
    for (const value of ['x-real-ip', 'X-Real-IP', 'X-REAL-IP', '  x-real-ip  ']) {
      vi.resetModules();
      process.env.CLIENT_IP_HEADER = value;
      const { config: fresh } = await import('./config');
      expect(fresh.clientIpHeader).toBe('x-real-ip');
    }
  });

  it('treats empty and unset values as undefined', async () => {
    for (const value of [undefined, '', '   ']) {
      vi.resetModules();
      if (value === undefined) {
        delete process.env.CLIENT_IP_HEADER;
      } else {
        process.env.CLIENT_IP_HEADER = value;
      }
      const { config: fresh } = await import('./config');
      expect(fresh.clientIpHeader).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// LOG_CLIENT_IP_HEADER diagnostic
// ---------------------------------------------------------------------------
// The diagnostic exists so an operator can see the raw client-IP header the
// process receives and decide whether the platform's edge REPLACES it (safe to
// key on) or APPENDS to it (not safe).
describe('LOG_CLIENT_IP_HEADER diagnostic', () => {
  let loggedLines: string[] = [];

  beforeEach(() => {
    loggedLines = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      loggedLines.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Only the lines the diagnostic itself produced. */
  const diagnosticLines = () =>
    loggedLines.filter((line) => line.startsWith('[ratelimit] x-real-ip raw='));

  it('logs nothing when the flag is off (the default)', async () => {
    const app = await bootApp('x-real-ip');

    await request(app).get('/api/v1/health').set('X-Real-IP', '203.0.113.7');

    expect(diagnosticLines()).toHaveLength(0);
  });

  it('logs the raw header value and req.ip when the flag is on', async () => {
    const app = await bootApp('x-real-ip', 1, true);

    const res = await request(app).get('/api/v1/health').set('X-Real-IP', '203.0.113.7');
    expect(res.status).toBe(200);

    const lines = diagnosticLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('raw=203.0.113.7');
    expect(lines[0]).toContain('req.ip=');
  });

  it('logs even when CLIENT_IP_HEADER is unset, so the header can be inspected first', async () => {
    const app = await bootApp(undefined, 1, true);

    await request(app).get('/api/v1/health').set('X-Real-IP', '203.0.113.7');

    const lines = diagnosticLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('raw=203.0.113.7');
  });

  it('truncates the raw value to 100 characters', async () => {
    const app = await bootApp('x-real-ip', 1, true);

    await request(app).get('/api/v1/health').set('X-Real-IP', 'a'.repeat(250));

    const lines = diagnosticLines();
    expect(lines).toHaveLength(1);
    const raw = /raw=(.*) req\.ip=/.exec(lines[0])?.[1] ?? '';
    expect(raw).toHaveLength(100);
  });

  it('logs at most 10 distinct values per process', async () => {
    const app = await bootApp('x-real-ip', 1, true);

    for (let i = 1; i <= 15; i++) {
      await request(app).get('/api/v1/health').set('X-Real-IP', `203.0.113.${i}`);
    }

    expect(diagnosticLines()).toHaveLength(10);
  });

  it('never logs the same value twice', async () => {
    const app = await bootApp('x-real-ip', 1, true);

    await request(app).get('/api/v1/health').set('X-Real-IP', '203.0.113.7');
    await request(app).get('/api/v1/health').set('X-Real-IP', '203.0.113.7');

    expect(diagnosticLines()).toHaveLength(1);
  });

  it('never logs other headers', async () => {
    const app = await bootApp('x-real-ip', 1, true);

    await request(app)
      .get('/api/v1/health')
      .set({
        'X-Real-IP': '203.0.113.7',
        'X-Custom-Secret': 'secret-custom-value',
        Authorization: 'Bearer secret-token',
      });

    const line = diagnosticLines()[0] ?? '';
    expect(line).toContain('raw=203.0.113.7');
    expect(line).not.toContain('secret-custom-value');
    expect(line).not.toContain('secret-token');
  });

  it('prints req.ip, which Express derives from X-Forwarded-For while trust proxy is on', async () => {
    const app = await bootApp('x-real-ip', 1, true);

    await request(app)
      .get('/api/v1/health')
      .set({ 'X-Real-IP': '203.0.113.7', 'X-Forwarded-For': '203.0.113.9' });

    // Showing both side by side is the point: the raw header value next to
    // the address Express resolves on its own.
    const line = diagnosticLines()[0] ?? '';
    expect(line).toContain('raw=203.0.113.7');
    expect(line).toContain('req.ip=203.0.113.9');
  });
});
