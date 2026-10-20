import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler } from './middleware/error';
import { ApiError, ok, SuccessEnvelope } from './utils/response';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());

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
