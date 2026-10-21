# ecommerce-api Consumer App

A single-page **React 19 + Vite + TypeScript** app that reads the `ecommerce-api` catalogue from the
**live** API. It is the external proof that the API works for a browser on another
origin: it calls the deployed Railway URL over the network, never a local server.

Scope is deliberately tiny — a list, a filter control, a next-page button, and the empty and error
states. No router, no state library, no UI framework, no login, no cart. Plain CSS.

---

## Configuration

The app reads exactly one environment variable, and only from `import.meta.env`:

| Variable | Example | Notes |
| :--- | :--- | :--- |
| `VITE_API_URL` | `https://ecommerce-api-production-3c59.up.railway.app` | The **public API origin**: no trailing slash, no `/api/v1`. The app appends `/api/v1/...` itself. |

- There is **no default and no fallback** baked into the bundle.
- `VITE_API_URL` must be an absolute URL with the **`https:`** scheme and a non-empty hostname. If it
  is missing, empty, unparseable, plain `http:` or hostless, the page renders a visible configuration
  error and issues **no requests**.
- `consumer/.env.local` holds the real value and is gitignored. `consumer/.env.example` holds the
  placeholder.
- Vite inlines `VITE_*` variables **at build time**. Changing the value in CI/Vercel requires a
  rebuild, not just a restart.

## Scripts

```bash
npm install

npm run dev      # dev server on http://localhost:5173
npm run build    # tsc -b (type-check) + production build into dist/
npm run preview  # serve the production build
npm run lint     # oxlint
```

## How it talks to the API

| Concern | Implementation |
| :--- | :--- |
| Base URL | `src/api.ts` → `resolveApiBaseUrl()` reads `import.meta.env.VITE_API_URL` only |
| Categories | `GET /api/v1/categories?limit=100&sort=name` |
| Products | `GET /api/v1/products?limit=12&sort=…&order=…` with **cursor** pagination |
| Next page | Sends `meta.nextCursor`; disabled when `!meta.hasMore` |
| Previous page | Walks a client-side stack of previously used cursors; disabled on page 1 |
| Category filter | `category=<slug>` — omitted entirely when unset |
| Max price | Typed in NGN, sent as `maxPrice=<naira × 100>` kobo — omitted entirely when unset |
| Empty parameters | The API answers `400 BAD_QUERY_PARAMS` for an empty query value, so unset controls are **never** sent as `""` |
| Price display | `priceMinor` is kobo: `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })` over `priceMinor / 100` |
| Cancellation | Every request carries an `AbortController`; the effect cleanup aborts the previous one, so a fast control change can never paint a stale response |

## States

| State | Rendering |
| :--- | :--- |
| Loading | Skeleton cards; filters, Previous and Next are disabled |
| Empty | "No products match the filters" + **Reset Filters** |
| Network failure (`fetch` threw) | "Cannot reach the API" + **Retry** |
| HTTP 429 | "Too many requests, try again in a minute" + **Retry** |
| HTTP 400, stale cursor | The API's own message, and the app resets to page 1 |
| Any other API error | `error.message` from the `{ error: { code, message } }` envelope + **Retry** |
| Bad configuration | Configuration error; no request is made |

`Retry-After` is deliberately not read: a browser can only read cross-origin response headers that
the server lists in `Access-Control-Expose-Headers`, and the API does not expose it — the value
would always be `null`. See the comment in `src/api.ts`.

## CORS

This app is a browser client on a different origin than the API, so the API's CORS rules decide
whether the responses reach it. The API (`src/app.ts` in the parent project) allows an origin when:

1. the request carries **no `Origin` header** (curl, server-to-server, native clients), or
2. the origin is listed **exactly** in the API's `CORS_ORIGIN` variable (comma-separated), or
3. the origin's hostname **ends with `.vercel.app`** — any subdomain, either scheme, but not the
   apex `vercel.app`, or
4. `NODE_ENV` is **not** `production` **and** the origin matches
   `^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$` — `http:` only, any port.

Anything else gets no `Access-Control-Allow-Origin` header and the browser blocks the response.
Rule 3 is what makes a Vercel deployment work without touching the Railway configuration.

## Source layout

```
src/
  api.ts                 base URL resolution, URL building, request/response handling
  types.ts               API response types
  App.tsx                state, effects and composition
  App.css                layout, controls, results bar, product cards
  states.css             empty / error / configuration / skeleton styles
  index.css              theme variables and page reset
  main.tsx               entry point
  components/
    FilterBar.tsx        category / sort / direction / max-price controls
    ProductGrid.tsx      grid of product cards
    ProductCard.tsx      one product
    SkeletonGrid.tsx     loading placeholders
    ResultsBar.tsx       "Showing X to Y of Z" + Previous / Next
    StatusPanel.tsx      empty state and error state
```

## Deployment

See the **Consumer Deployment (Vercel)** section of the repository's [`../DEPLOY.md`](../DEPLOY.md)
for the step-by-step Vercel runbook (import settings, `VITE_API_URL`, build-time inlining, and how
to confirm in DevTools that requests reach the live API without CORS errors).
