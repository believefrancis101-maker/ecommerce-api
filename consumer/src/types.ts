export interface Category {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  currency: string;
  stock: number;
  createdAt: string;
  category: {
    id: string;
    name: string;
    slug: string;
  };
}

/**
 * `meta` of a cursor page. The API deliberately omits `offset` on cursor pages
 * (a cursor only moves forward) and reports `nextCursor: null` on the last
 * page, so both are modelled explicitly here.
 */
export interface CursorPaginationMeta {
  total: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: CursorPaginationMeta;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export type SortField = 'price' | 'name';
export type SortDirection = 'asc' | 'desc';

export type ApiFailureKind =
  /** `fetch` itself rejected: no response was ever received. */
  | 'network'
  /** The API answered 429 (rate limit exceeded). */
  | 'rate-limit'
  /** The API answered 400 because the cursor no longer points into the result set. */
  | 'stale-cursor'
  /** Any other non-2xx answer: the envelope's `error.message` is shown. */
  | 'api';

export interface ApiFailure {
  kind: ApiFailureKind;
  message: string;
}

/** Outcome of a request: success, a classified failure, or a cancellation. */
export type RequestOutcome<T> =
  | { status: 'success'; response: ApiSuccessResponse<T> }
  | { status: 'failure'; failure: ApiFailure }
  | { status: 'aborted' };
