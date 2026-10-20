import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { ApiError } from '../utils/response';

const uuidSchema = z.string().uuid({ message: 'Invalid UUID format' });

export const validateUuidParam = (paramName: string) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    const parsed = uuidSchema.safeParse(value);

    if (!parsed.success) {
      // Malformed ID -> 404 NOT_FOUND (never 500) per requirements.
      return next(new ApiError(404, 'NOT_FOUND', `Resource not found: ${paramName} must be a valid UUID`));
    }

    req.params[paramName] = parsed.data;
    return next();
  };
};

const sortOrderSchema = z.enum(['asc', 'desc']).optional();

// Express 5's types make every route param `string | string[]` (they can repeat),
// but validateUuidParam has already proven this one is a single valid UUID.
export const uuidParam = (req: Request, paramName: string): string => req.params[paramName] as string;

export type SortConfig = {
  field: string;
  direction: 'asc' | 'desc';
};

export type PaginationResult = {
  limit: number;
  offset: number;
  sort?: SortConfig;
};

// Reads a non-empty query integer. Empty/absent means "not supplied"; anything
// else must be a plain non-negative integer. Failures surface as ordinary Zod
// issues (=> 400) rather than ApiErrors thrown from inside a Zod transform,
// which required digging them back out of `issues[0].cause`.
const queryInt = (label: string) =>
  z.preprocess(
    (raw) => (raw === '' || raw === null ? undefined : raw),
    z
      .string()
      .regex(/^\d+$/, `${label} must be a non-negative integer`)
      .optional()
  );

// `limit` is stricter than `offset`: absent means "use the default", but every
// supplied value must be a positive integer. An explicit 0, a negative number,
// a non-number or an empty value (`?limit=`) is a client error rather than a
// silent fallback to the default page size. Values above `maxLimit` are clamped.
const limitInt = z.preprocess(
  (raw) => (raw === null ? undefined : raw),
  z
    .string()
    .regex(/^\d+$/, 'limit must be a positive integer')
    .refine((value) => Number(value) > 0, 'limit must be a positive integer')
    .optional()
);

export const createPaginationQuerySchema = (sortWhitelist: string[]) =>
  z
    .object({
      limit: limitInt,
      offset: queryInt('offset'),
      sort: z.string().optional(),
      order: sortOrderSchema,
    })
    .superRefine((value, ctx) => {
      if (value.sort !== undefined && !sortWhitelist.includes(value.sort)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sort'],
          message: `sort must be one of: ${sortWhitelist.join(', ')}`,
        });
      }
    })
    .transform((value): PaginationResult => {
      const requested = value.limit === undefined ? config.pagination.defaultLimit : Number(value.limit);
      // Anything above maxLimit is clamped so a caller can never ask this API
      // for the whole table. An explicit limit=0 is rejected by limitInt above,
      // so `requested` is always at least 1 here.
      const limit = Math.min(requested, config.pagination.maxLimit);
      const offset = value.offset === undefined ? 0 : Number(value.offset);

      return {
        limit,
        offset,
        sort: value.sort ? { field: value.sort, direction: value.order ?? 'asc' } : undefined,
      };
    });

export const parsePaginationQuery = <T extends z.ZodTypeAny>(schema: T, req: Request) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.length ? `${String(first.path[0])}: ` : '';
    throw new ApiError(400, 'BAD_QUERY_PARAMS', `${field}${first?.message ?? 'Invalid query parameters'}`);
  }
  return result.data as z.infer<T>;
};

// Optional, non-empty string filter (e.g. `q`). A present-but-empty value
// (`?q=`) is rejected instead of being silently dropped, so an empty filter can
// never "match everything" by accident.
export const optionalQueryString = (req: Request, key: string): string | undefined => {
  const raw = req.query[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ApiError(400, 'BAD_QUERY_PARAMS', `${key}: ${key} must be a non-empty string`);
  }
  return raw;
};
