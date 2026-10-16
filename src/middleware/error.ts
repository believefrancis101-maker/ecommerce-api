import { Request, Response, NextFunction } from 'express';
import { ApiError, ErrorEnvelope, isApiError } from '../utils/response';

const toSafeMessage = (err: unknown): string => {
  if (err instanceof Error) {
    // Intentionally do not leak stack traces to clients.
    return err.message || 'Internal Server Error';
  }
  return 'Internal Server Error';
};

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (isApiError(err)) {
    const envelope: ErrorEnvelope = {
      error: {
        code: err.code,
        message: err.message,
      },
    };
    res.status(err.status).json(envelope);
    return;
  }

  // Fallback: unknown/unexpected errors -> 500 INTERNAL_ERROR with no stack trace leaked.
  const envelope: ErrorEnvelope = {
    error: {
      code: 'INTERNAL_ERROR',
      message: toSafeMessage(err),
    },
  };
  res.status(500).json(envelope);
};
