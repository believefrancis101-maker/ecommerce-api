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

// Parses a filter schema against the query string and turns the first failure
// into 400 BAD_QUERY_PARAMS, naming the offending param. Shared by every list
// route so filter errors look identical everywhere. A present-but-empty value
// (`?name=`) fails the schema's `.min(1)` and is rejected instead of being
// silently dropped, so an empty filter can never "match everything" by accident.
export const parseFilterQuery = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.length ? `${String(first.path[0])}: ` : '';
    throw new ApiError(400, 'BAD_QUERY_PARAMS', `${field}${first?.message ?? 'Invalid query parameters'}`);
  }
  return result.data as z.infer<T>;
};

// Prisma's `contains` compiles to SQL `ILIKE '%value%'` and does NOT escape the
// user's LIKE metacharacters, so `name=%` would match every row and `name=_`
// would match any single character. Escape `\`, `%` and `_` so a text filter
// matches those characters literally; Postgres' default LIKE escape character
// is the backslash, so `\%` / `\_` / `\\` are read as literals.
export const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

// Cursor pagination. The token is opaque by design: it is the URL-safe base64 of
// the last row's id, and clients only ever echo back what `meta.nextCursor`
// returned, so the encoding can change later without breaking a contract.
export const encodeCursor = (id: string): string => Buffer.from(id, 'utf8').toString('base64url');

// Strict decode: anything that does not decode to a UUID is a 400. This matters
// because Prisma's `cursor` compiles to `... > (SELECT ... WHERE id = $cursor)`;
// a token that is not a real id would make that subquery NULL and Prisma would
// answer 200 with an empty page instead of reporting a bad request.
export const decodeCursor = (cursor: string): string => {
  const parsed = uuidSchema.safeParse(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!parsed.success) {
    throw new ApiError(400, 'BAD_QUERY_PARAMS', 'cursor: must be a cursor returned by this API');
  }
  return parsed.data;
};

// Reads the optional `cursor` query param and returns the decoded id (or
// undefined when absent). `cursor` and `offset` are two different paging modes
// and cannot be mixed; an empty `?cursor=` is rejected like every other empty
// query value rather than silently ignored.
export const parseCursorQuery = (req: Request): string | undefined => {
  const raw = req.query.cursor;
  if (raw === undefined) return undefined;

  if (typeof raw !== 'string' || raw === '') {
    throw new ApiError(400, 'BAD_QUERY_PARAMS', 'cursor: must be a non-empty string');
  }

  if (req.query.offset !== undefined) {
    throw new ApiError(400, 'BAD_QUERY_PARAMS', 'cursor: cannot be combined with offset');
  }

  return decodeCursor(raw);
};
