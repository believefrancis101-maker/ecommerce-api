import { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 does NOT catch rejected promises from async handlers, so every
// async route must be wrapped or a thrown ApiError becomes an unhandled
// rejection instead of a JSON error envelope.
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
