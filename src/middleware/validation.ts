import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { ApiError } from '../utils/response';

const uuidSchema = z.string().uuid({ message: 'Invalid UUID format' });

export const validateUuidParam = (paramName: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    const parsed = uuidSchema.safeParse(value);

    if (!parsed.success) {
      // Malformed ID -> 404 NOT_FOUND (never 500) per requirements.
      return next(new ApiError(404, 'NOT_FOUND', `Resource not found: ${paramName} must be a valid UUID`));
    }

    // Attach validated value if desired (read-only)
    req.params[paramName] = parsed.data;
    return next();
  };
};

const sortOrderSchema = z.enum(['asc', 'desc']).optional();

export type SortConfig = {
  field: string;
  direction: 'asc' | 'desc';
};

export type PaginationResult = {
  limit: number;
  offset: number;
  sort?: SortConfig;
};

export const createPaginationQuerySchema = (sortWhitelist: string[]) => {
  return z
    .object({
      limit: z
        .string()
        .optional()
        .transform((v) => {
          if (v === undefined || v === null || v === '') return config.pagination.defaultLimit;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) {
            // Bad query param -> 400
            throw new ApiError(400, 'BAD_QUERY_PARAMS', 'limit must be a non-negative integer');
          }
          return Math.floor(n);
        })
        .transform((n) => {
          if (n === 0) return config.pagination.defaultLimit;
          if (n > config.pagination.maxLimit) return config.pagination.maxLimit;
          return n;
        }),
      offset: z
        .string()
        .optional()
        .transform((v) => {
          if (v === undefined || v === null || v === '') return 0;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) {
            // Negative offset -> 400 with clear message
            throw new ApiError(400, 'BAD_QUERY_PARAMS', 'offset must be >= 0');
          }
          return Math.floor(n);
        }),
      sort: z
        .string()
        .optional()
        .transform((v) => {
          if (!v) return undefined;
          if (!sortWhitelist.includes(v)) {
            // Unknown sort field -> 400
            throw new ApiError(400, 'BAD_QUERY_PARAMS', `sort must be one of: ${sortWhitelist.join(', ')}`);
          }
          return v;
        }),
      order: sortOrderSchema,
    })
    .transform((d) => {
      const limit = d.limit;
      const offset = d.offset;
      const sort: SortConfig | undefined = d.sort
        ? { field: d.sort, direction: d.order ?? 'asc' }
        : undefined;
      return { limit, offset, sort } as PaginationResult;
    });
};

export const parsePaginationQuery = <T extends z.ZodTypeAny>(schema: T, req: Request) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    // result.error.issues may contain thrown ApiError cases; re-throw ApiError if present
    const first = result.error.issues[0];
    const cause = (first as unknown as { cause?: unknown })?.cause;
    if (cause instanceof ApiError) {
      throw cause;
    }
    throw new ApiError(400, 'BAD_QUERY_PARAMS', first?.message ?? 'Invalid query parameters');
  }
  return result.data as z.infer<T>;
};
