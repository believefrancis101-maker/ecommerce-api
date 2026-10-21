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
  // this many hops back from the app; the rate limiter keys on req.ip.
  trustProxyHops: number;
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

