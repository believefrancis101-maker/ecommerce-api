import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z
    .string()
    .default('3000')
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error('PORT must be a valid port number between 1 and 65535');
      }
      return parsed;
    }),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().optional(),
  TRUST_PROXY_HOPS: z
    .string()
    .optional()
    .transform((val) => {
      // An unset or blank value means "unset", not "zero hops": clearing the
      // variable must not silently switch the app to trusting nothing.
      if (val === undefined || val.trim() === '') return 1;
      const parsed = Number(val.trim());
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) {
        throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 5');
      }
      return parsed;
    }),
  // Optional header name that carries the client's real IP address, set by the
  // hosting platform's edge proxy.  When set, the rate limiter reads this header
  // directly instead of relying on Express's req.ip hop-counting.
  // Empty / unset → the limiter keys on req.ip as before.
  //
  // Validated against an explicit allowlist so that an operator cannot
  // accidentally trust an arbitrary caller-supplied header.  Add entries only
  // after verifying that the target platform's edge replaces the header.
  CLIENT_IP_HEADER: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val.trim() === '') return undefined;
      const trimmed = val.trim().toLowerCase();
      // Allowlist: only header names known to be set by a trusted edge proxy.
      // "x-real-ip" is documented by Railway.
      const ALLOWED_HEADERS = ['x-real-ip'] as const;
      if (!(ALLOWED_HEADERS as readonly string[]).includes(trimmed)) {
        throw new Error(
          `CLIENT_IP_HEADER must be one of: ${ALLOWED_HEADERS.join(', ')} (got "${trimmed}")`,
        );
      }
      return trimmed;
    }),
  // Diagnostic switch for the client-IP header. When true, the app logs the
  // raw client-IP header it actually receives, so an operator can confirm that
  // the platform's edge REPLACES the header (safe to key the limiter on)
  // instead of APPENDING to it (not safe). Off by default.
  LOG_CLIENT_IP_HEADER: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val.trim() === '') return false;
      const normalized = val.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
      throw new Error(
        `LOG_CLIENT_IP_HEADER must be a boolean (true/false), got "${val.trim()}"`,
      );
    }),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const formattedErrors = parsedEnv.error.issues
    .map((issue) => `  - ${issue.path.join('.') || 'root'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${formattedErrors}`);
}

export interface Config {
  port: number;
  databaseUrl: string;
  nodeEnv: 'development' | 'production' | 'test';
  corsOrigin?: string;
  // How many reverse-proxy hops sit between the public internet and this app.
  // Express derives req.ip from the socket peer plus X-Forwarded-For by walking
  // this many hops back from the app.  The rate limiter keys on req.ip unless
  // CLIENT_IP_HEADER is set, in which case this is the fallback key.
  trustProxyHops: number;
  // Optional HTTP header name whose value is the client's real IP, set by the
  // hosting platform's edge proxy (e.g. "x-real-ip" on Railway).  When set, the
  // rate limiter reads this header instead of Express's req.ip.
  clientIpHeader?: string;
  // When true, the app logs the raw client-IP header it receives (see
  // src/app.ts).  Used to verify that the platform's edge replaces the header
  // before the limiter is allowed to key on it.  Off by default.
  logClientIpHeader: boolean;
  pagination: {
    defaultLimit: number;
    maxLimit: number;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  // Express.json body cap: anything larger is rejected with 413 before the
  // body is buffered, so a huge payload can never reach a route handler.
  jsonBodyLimit: string;
  orders: {
    // Order write limits (POST /api/v1/orders). Chosen as sane API guardrails,
    // far above any legitimate cart (the seed tops out at 5 items per order).
    maxItemsPerOrder: number;
    maxQuantityPerItem: number;
  };
}

export const config: Config = {
  port: parsedEnv.data.PORT,
  databaseUrl: parsedEnv.data.DATABASE_URL,
  nodeEnv: parsedEnv.data.NODE_ENV,
  corsOrigin: parsedEnv.data.CORS_ORIGIN,
  trustProxyHops: parsedEnv.data.TRUST_PROXY_HOPS,
  clientIpHeader: parsedEnv.data.CLIENT_IP_HEADER,
  logClientIpHeader: parsedEnv.data.LOG_CLIENT_IP_HEADER,
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
  rateLimit: {
    windowMs: 60000,
    max: 100,
  },
  jsonBodyLimit: '100kb',
  orders: {
    maxItemsPerOrder: 50,
    maxQuantityPerItem: 1000,
  },
};

