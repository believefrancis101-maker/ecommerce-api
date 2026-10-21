import express from 'express';
import type { Request } from 'express';
import net from 'node:net';
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

// ---------------------------------------------------------------------------
// Diagnostic: the raw client-IP header this process actually receives
// ---------------------------------------------------------------------------
// Why this exists: before the limiter is allowed to key on a platform supplied
// client-IP header, an operator has to know whether the platform's edge
// REPLACES that header (safe - the value is the client's address) or APPENDS
// to it (not safe - the value is a list, and the client controls the first
// entry). It is gated by LOG_CLIENT_IP_HEADER (default false) and it reads the
// header even when CLIENT_IP_HEADER is unset, so the header can be inspected
// before anything is switched on.
//
// The rules this function obeys:
//   - it prints ONLY the client-IP header and req.ip - never another header,
//     never the request body, never the config object;
//   - the raw value is truncated to 100 characters;
//   - at most 10 DISTINCT raw values are logged per process lifetime, so a
//     caller cannot flood the log;
//   - the same value is never logged twice.
//
// The "already seen" set lives at module scope, so it is emptied whenever the
// module is loaded again - which is how the tests get a fresh budget per app
// instance.
const DIAGNOSTIC_HEADER = 'x-real-ip';
const DIAGNOSTIC_MAX_DISTINCT = 10;
const DIAGNOSTIC_MAX_LENGTH = 100;
const diagnosticValuesSeen = new Set<string>();

/** Keeps a single logged value from being arbitrarily long. */
const truncateForLog = (value: string): string => value.slice(0, DIAGNOSTIC_MAX_LENGTH);

function logRawClientIpHeader(req: Request): void {
  if (!config.logClientIpHeader) return;

  const raw = req.headers[DIAGNOSTIC_HEADER];
  // A repeated header arrives as an array. Node joins repeated headers with
  // ", " for every header that is not in its discard-duplicates list, and
  // x-real-ip is not in that list, so in practice this is a plain string.
  // The join is kept so the log shows exactly what the app received.
  const value =
    raw === undefined ? '<absent>' : Array.isArray(raw) ? raw.join(', ') : raw;

  // Already logged this exact value, or the distinct-value budget is spent.
  if (diagnosticValuesSeen.has(value)) return;
  if (diagnosticValuesSeen.size >= DIAGNOSTIC_MAX_DISTINCT) return;
  diagnosticValuesSeen.add(value);

  // req.ip is Express's own value. With "trust proxy" switched on, Express
  // derives it from X-Forwarded-For, so it can be a caller supplied string -
  // it is truncated for the same reason the header value is.
  console.info(
    `[ratelimit] ${DIAGNOSTIC_HEADER} raw=${truncateForLog(value)} req.ip=${truncateForLog(req.ip ?? 'undefined')}`,
  );
}

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Diagnostic hook: records what the raw client-IP header looks like on
    // this deployment. Gated off by default; see the block above.
    logRawClientIpHeader(req);

    // When a platform-specific client IP header is configured (e.g.
    // CLIENT_IP_HEADER=x-real-ip on Railway), read the IP directly from that
    // header.  This bypasses Express's req.ip hop-counting, which relies on a
    // stable X-Forwarded-For hop count that Railway does not guarantee.
    if (config.clientIpHeader) {
      const raw = req.headers[config.clientIpHeader];
      // Accept exactly one value: a plain string with no commas.
      if (typeof raw === 'string') {
        const value = raw.trim();
        if (
          value.length > 0 &&
          value.length <= 45 && // safety bound: the longest possible IPv6 literal is 39 characters
          !value.includes(',') && // reject comma-separated lists
          net.isIP(value) // must be a syntactically valid IPv4 or IPv6 address
        ) {
          return value;
        }
      }
      // Header missing, empty, multi-valued, oversized, or not an IP address.
      // Fall back to req.ip — never return a shared constant like "unknown",
      // because that would pool every fallback request into one bucket.
    }
    // req.ip is undefined only when the socket has already been destroyed, i.e.
    // the request never produced a usable peer address. '127.0.0.1' is a
    // shared constant, but it is only reachable in that broken state, so it
    // can never pool real traffic into one bucket.
    return req.ip ?? '127.0.0.1';
  },
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
