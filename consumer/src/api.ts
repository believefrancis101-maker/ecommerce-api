import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  Category,
  CursorPaginationMeta,
  Product,
  RequestOutcome,
  SortDirection,
  SortField,
} from './types';

/** Products per page. */
export const PAGE_SIZE = 12;

/**
 * Resolves the API base URL from `import.meta.env.VITE_API_URL` and from
 * nothing else: there is no default and no fallback value baked into the
 * bundle, so a misconfigured build can never silently talk to the wrong
 * server.
 *
 * The value must be an absolute URL with the `https:` scheme and a non-empty
 * hostname. Anything else - missing, empty, unparseable, plain `http:` or
 * hostless - is rejected, and the app then renders a configuration error and
 * issues no request at all.
 */
function resolveApiBaseUrl(): { baseUrl: string; problem: string | null } {
  const raw = import.meta.env.VITE_API_URL;

  if (typeof raw !== 'string' || raw.trim() === '') {
    return {
      baseUrl: '',
      problem: 'VITE_API_URL is not set. Add the live API URL to consumer/.env.local.',
    };
  }

  const trimmed = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      baseUrl: '',
      problem: `VITE_API_URL is not a valid absolute URL: ${trimmed}`,
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      baseUrl: '',
      problem: `VITE_API_URL must use the https: scheme, the live API is served over TLS: ${trimmed}`,
    };
  }

  if (parsed.hostname === '') {
    return {
      baseUrl: '',
      problem: `VITE_API_URL must contain a hostname: ${trimmed}`,
    };
  }

  // The documented value is the API origin ("https://host"), but the versioned
  // base ("https://host/api/v1") is accepted as well: drop that suffix so the
  // per-request paths below never produce "/api/v1/api/v1/...".
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');

  return { baseUrl: `${parsed.origin}${path}`, problem: null };
}

const resolved = resolveApiBaseUrl();

/** Resolved base URL, e.g. "https://host". Empty when the config is invalid. */
export const API_BASE_URL = resolved.baseUrl;

/** Non-null when VITE_API_URL is missing, empty, not https or malformed. */
export const CONFIG_PROBLEM = resolved.problem;

export interface ProductQuery {
  /** Opaque cursor from a previous `meta.nextCursor`; null on the first page. */
  cursor: string | null;
  /** Category slug; empty means "all categories". */
  category: string;
  sort: SortField;
  order: SortDirection;
  /** Maximum price in kobo; null means the control is unset. */
  maxPriceMinor: number | null;
}

/**
 * Builds the products URL. The API answers 400 BAD_QUERY_PARAMS for an empty
 * query value, so an unset control is omitted from the URL entirely rather
 * than sent as an empty string.
 */
export function buildProductsUrl(baseUrl: string, query: ProductQuery): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));

  if (query.cursor !== null && query.cursor !== '') {
    params.set('cursor', query.cursor);
  }

  if (query.category !== '') {
    params.set('category', query.category);
  }

  params.set('sort', query.sort);
  params.set('order', query.order);

  if (query.maxPriceMinor !== null) {
    params.set('maxPrice', String(query.maxPriceMinor));
  }

  return `${baseUrl}/api/v1/products?${params.toString()}`;
}

/** Categories are a small fixed set: one page, sorted by name. */
export function buildCategoriesUrl(baseUrl: string): string {
  const params = new URLSearchParams();
  params.set('limit', '100');
  params.set('sort', 'name');

  return `${baseUrl}/api/v1/categories?${params.toString()}`;
}

/**
 * Converts the "max price (NGN)" control to kobo, the unit the API filters
 * with. Returns null for an empty or non-positive input so the parameter is
 * omitted entirely instead of being sent empty (which the API rejects).
 */
export function parseMaxPriceToMinor(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  const naira = Number(trimmed);
  if (!Number.isFinite(naira) || naira <= 0) {
    return null;
  }

  return Math.round(naira * 100);
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

const nairaFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `priceMinor` is kobo, so the displayed amount is kobo / 100. */
export function formatNaira(priceMinor: number): string {
  return nairaFormatter.format(priceMinor / 100);
}

/**
 * Performs a request and classifies every outcome the UI has to react to.
 * Nothing is thrown: the caller switches on `status`.
 */
export async function requestJson<T>(
  url: string,
  signal: AbortSignal,
): Promise<RequestOutcome<T>> {
  let response: Response;

  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (isAbortError(error)) {
      return { status: 'aborted' };
    }
    // The request never reached the API (offline, DNS failure, blocked call).
    return {
      status: 'failure',
      failure: { kind: 'network', message: 'Cannot reach the API' },
    };
  }

  if (response.status === 429) {
    // NOTE: `Retry-After` is deliberately NOT read here. A browser only exposes
    // cross-origin response headers that the server lists in
    // `Access-Control-Expose-Headers`, and this API does not expose
    // `Retry-After`, so `response.headers.get('Retry-After')` would always be
    // null. The message therefore states the documented 60s window instead.
    return {
      status: 'failure',
      failure: { kind: 'rate-limit', message: 'Too many requests, try again in a minute' },
    };
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const envelope = (await response.json()) as ApiErrorResponse;
      if (envelope?.error?.message) {
        message = envelope.error.message;
      }
    } catch {
      // The body was not JSON: the generic message above is used.
    }

    // A 400 whose message mentions the cursor means the cursor no longer
    // points at a row of the current result set. The caller shows the message
    // and resets to page 1. Every other 400 is a plain API error: its
    // `error.message` is shown as-is.
    if (response.status === 400 && /cursor/i.test(message)) {
      return { status: 'failure', failure: { kind: 'stale-cursor', message } };
    }

    return { status: 'failure', failure: { kind: 'api', message } };
  }

  try {
    return { status: 'success', response: (await response.json()) as ApiSuccessResponse<T> };
  } catch {
    return {
      status: 'failure',
      failure: { kind: 'api', message: 'The API returned a response that could not be read' },
    };
  }
}

export async function fetchCategories(
  baseUrl: string,
  signal: AbortSignal,
): Promise<RequestOutcome<Category[]>> {
  return requestJson<Category[]>(buildCategoriesUrl(baseUrl), signal);
}

export async function fetchProducts(
  baseUrl: string,
  query: ProductQuery,
  signal: AbortSignal,
): Promise<
  RequestOutcome<{ products: Product[]; meta: CursorPaginationMeta | null }>
> {
  const outcome = await requestJson<Product[]>(buildProductsUrl(baseUrl, query), signal);

  if (outcome.status === 'success') {
    return {
      status: 'success',
      response: {
        data: {
          products: outcome.response.data ?? [],
          meta: outcome.response.meta ?? null,
        },
      },
    };
  }

  return outcome;
}
