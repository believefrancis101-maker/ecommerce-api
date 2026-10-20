import { Request, Response, NextFunction } from 'express';

export type SuccessMeta = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

// Cursor paging has no page number to jump to, so it reports no `offset` and
// adds `nextCursor` instead. A distinct shape keeps a cursor page from ever
// advertising a meaningless `offset`.
export type CursorMeta = {
  total: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type CollectionMeta = SuccessMeta | CursorMeta;

export type SuccessEnvelope<T = unknown> = {
  data: T;
  meta: CollectionMeta;
};

// Single-resource responses and /health carry data only: collection meta
// (total/limit/offset/hasMore) is meaningless for a single row.
export type ItemEnvelope<T = unknown> = {
  data: T;
};

export type ErrorPayload = {
  code: string;
  message: string;
};

export type ErrorEnvelope = {
  error: ErrorPayload;
};

export const ok = <T>(data: T, meta: CollectionMeta): SuccessEnvelope<T> => ({
  data,
  meta,
});

export const okItem = <T>(data: T): ItemEnvelope<T> => ({ data });

// hasMore is derived from how many rows we actually returned, not from
// limit+offset arithmetic, so a short tail page reports false.
export const listMeta = (total: number, limit: number, offset: number, returned: number): SuccessMeta => ({
  total,
  limit,
  offset,
  hasMore: offset + returned < total,
});

// Cursor-page metadata. `hasMore` is decided by the caller (it fetches one row
// past the page to detect it), and `nextCursor` is the encoded id of the last
// row on this page, or null at the end of the table. Deliberately no `offset`:
// a cursor only moves forward.
export const cursorMeta = (total: number, limit: number, hasMore: boolean, nextCursor: string | null): CursorMeta => ({
  total,
  limit,
  hasMore,
  nextCursor,
});

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }
}

export const isApiError = (err: unknown): err is ApiError => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as ApiError;
  return typeof e.status === 'number' && typeof e.code === 'string' && typeof e.message === 'string';
};
