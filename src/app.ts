import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler } from './middleware/error';
import { ApiError, ok, SuccessEnvelope } from './utils/response';

const app = express();

// Number of reverse-proxy hops between the public internet and this process.
// Express builds req.ip from the socket peer and the X-Forwarded-For header by
// walking that many hops back from the app, and the rate limiter keys on
// req.ip - so this value decides whose IP the budget is charged to.
//
// Railway's edge terminates TLS and forwards to the deployment, and it does
// not publish a stable proxy CIDR range, so the hop count is an environment
// setting (TRUST_PROXY_HOPS) rather than a constant baked into the code.
// Trusting too few hops keys the limiter on a Railway proxy node instead of
// the visitor; trusting too many lets a caller pick the leftmost, caller
// supplied X-Forwarded-For value and rotate it to reset the budget.
app.set('trust proxy', config.trustProxyHops);

app.use(helmet());
const defaultLocalOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const configuredOrigins = config.corsOrigin
  ? config.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

const isAllowedVercelOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return url.hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, mobile apps, server-to-server)
      if (!origin) return callback(null, true);

      // Check explicitly configured origins
      if (configuredOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow deployed Vercel frontend (production and preview deployments)
      if (isAllowedVercelOrigin(origin)) {
        return callback(null, true);
      }

      // Allow local development origins in non-production environments
      if (config.nodeEnv !== 'production') {
        if (defaultLocalOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
      }

      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: (req, res, next) => {
    // Return 429 in the error envelope with a Retry-After header.
    const retryAfter = Math.ceil(config.rateLimit.windowMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    next(new ApiError(429, 'TOO_MANY_REQUESTS', 'Too many requests, please try again later'));
  },
});

// The limiter sits ABOVE express.json on purpose: malformed and oversized
// requests are rejected by the body parser (400 / 413), and if the limiter ran
// after it those cheap-to-reject-but-abuse-prone requests would bypass the
// budget entirely. Here every request is counted and carries RateLimit headers
// before the body is even parsed.
app.use(limiter);
app.use(express.json({ limit: config.jsonBodyLimit }));

// Mount v1 routes under /api/v1
import v1Router from './routes/v1';

app.use('/api/v1', v1Router);

// Unknown route -> 404
app.use((_req, res, next) => {
  next(new ApiError(404, 'NOT_FOUND', 'Not Found'));
});

// Central error handler (must be last)
app.use(errorHandler);

export default app;
