import { Request, Response, NextFunction } from 'express';
import { ApiError, ErrorEnvelope, isApiError } from '../utils/response';

// body-parser failures are ordinary Errors tagged with a `type`, not ApiErrors.
type BodyParserError = Error & { type?: string; status?: number };

const isBodyParserError = (err: unknown): err is BodyParserError =>
  err instanceof Error && typeof (err as BodyParserError).type === 'string';

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (isApiError(err)) {
    // Covers 400/404/413/422/429 ApiErrors thrown by routes and middleware.
    const envelope: ErrorEnvelope = {
      error: {
        code: err.code,
        message: err.message,
      },
    };
    res.status(err.status).json(envelope);
    return;
  }

  // Malformed JSON body -> 400 INVALID_JSON (never a 500).
  if (isBodyParserError(err) && err.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
    } satisfies ErrorEnvelope);
    return;
  }

  // Body larger than config.jsonBodyLimit -> 413 PAYLOAD_TOO_LARGE.
  if (isBodyParserError(err) && err.type === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit' },
    } satisfies ErrorEnvelope);
    return;
  }

  // Fallback: unknown/unexpected errors -> 500 with a GENERIC message. The real
  // error (message + stack) is logged server-side only, so a client can never
  // learn internals (Prisma/SQL text, file paths, secrets) from a 500 body.
  console.error('[error] Unhandled error:', err);
  const envelope: ErrorEnvelope = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  };
  res.status(500).json(envelope);
};
