# ecommerce-api

E-commerce REST API built with Node.js, Express, TypeScript, PostgreSQL and Prisma.

**Status:** schema, seed, Express foundation and the Stage 5 read endpoints are in place.
`/api/v1` exposes paginated, filterable, sortable read routes for categories, products,
customers and orders (see [API](#7-api)).

## Requirements

- Node.js 22+ and npm
- Docker (local PostgreSQL 16)

## 1. Environment

Copy `.env.example` to `.env` and fill it in:

```bash
cp .env.example .env
```

`DATABASE_URL` points at `localhost:5432`, so the Docker container name never appears in
application config. Never commit `.env`; keep `.env.example` up to date instead.

## 2. Database (Docker)

Create the container once:

```bash
docker run -d --name ecommerce-postgres \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=ecommerce \
  -p 5432:5432 \
  -v ecommerce-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine
```

Start it in every later session - the container is not guaranteed to stay up between sessions:

```bash
docker start ecommerce-postgres
docker ps --filter name=ecommerce-postgres   # confirm it is Up
```

Open a SQL shell:

```bash
docker exec -it ecommerce-postgres psql -U user -d ecommerce
```

Alternative: add `--restart unless-stopped` to the `docker run` command so Docker starts it
automatically instead of needing `docker start`.

## 3. Install and migrate

```bash
npm install
npx prisma migrate deploy    # apply existing migrations (no prompts)
npx prisma migrate dev       # while developing: create + apply a new migration
```

## 4. Seed

```bash
npm run seed
```

- **Deterministic:** `faker.seed(42)` plus ids from `faker.string.uuid()`, a fixed order
  date window, and a fixed `createdAt` for categories/products/customers - no values depend
  on when the script runs.
- **Idempotent:** `createMany({ skipDuplicates: true })` on all five tables, so re-running
  inserts 0 rows. The script never deletes or truncates.
- **Volumes:** 20 categories, 400 products, 300 customers, 500 orders with 1-5 items each.
- **Caveat:** `npx prisma migrate reset --force` *also* runs the seed, because `prisma.seed`
  is configured in `package.json`. Use `--skip-seed` for an empty database.

## 5. Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Watch mode via `tsx` |
| `npm run build` | Compile to `dist/` with `tsconfig.json` |
| `npm start` | Run the compiled server from `dist/` |
| `npm test` | `vitest run` (builds a throwaway test database first) |
| `npm run seed` | Seed the database |
| `npm run typecheck` | `tsc --noEmit` over `src/` **and** `prisma/seed.ts` |
| `postinstall` | Regenerate the Prisma client (`prisma generate`) after `npm install` |

`typecheck` uses a separate `tsconfig.typecheck.json` (it extends the build config and turns
emit off), so `npm run build` keeps its `dist/` layout unchanged.

## 6. Tests

`npm test` needs Postgres running (the `ecommerce-postgres` container). The Vitest `globalSetup`
hook creates `ecommerce_test`, applies every migration and runs the seed against it, and a
`setupFiles` hook points the worker's `DATABASE_URL` at it before `src/config.ts` / `src/db.ts`
load. The test harness creates and drops its own `ecommerce_test` database, so no `DATABASE_URL`
is needed for `npm test`. Tests therefore never read or mutate your `ecommerce` data.

## 7. API

All routes are under `/api/v1`. Collection endpoints return a data envelope with pagination metadata; single-item endpoints and `/health` return data only without meta:

```json
// Collection responses:
{ "data": [...], "meta": { "total": 20, "limit": 20, "offset": 0, "hasMore": false } }

// Single-item responses & /health:
{ "data": { ... } }

// Error responses:
{ "error": { "code": "NOT_FOUND", "message": "Product not found" } }
```

Every error uses that envelope. The complete set of `code` values the API can return:

| HTTP | `code` | When it is returned |
| --- | --- | --- |
| `400` | `BAD_QUERY_PARAMS` | invalid `limit`/`offset`/`sort`/`order` (including `limit=0` and an empty `limit`), an empty or unknown filter value, a malformed `customerId` filter, `minPrice > maxPrice`, or a bad `cursor` (combined with `offset`, undecodable, empty, or no longer pointing at a row in the result set) |
| `400` | `INVALID_JSON` | the request body is not valid JSON |
| `404` | `NOT_FOUND` | unknown route, unknown **or** malformed `:id`, or a second `DELETE` of an already-deleted order |
| `413` | `PAYLOAD_TOO_LARGE` | the request body exceeds `config.jsonBodyLimit` (`100kb`) |
| `422` | `UNPROCESSABLE_ENTITY` | a write body fails validation, or references a customer/product that does not exist |
| `429` | `TOO_MANY_REQUESTS` | the rate limit is exceeded (`100` requests / `60s` per IP) |
| `500` | `INTERNAL_ERROR` | an unexpected server error; the message is always the generic `"Internal server error"` - the real error is logged server-side only |


| Method & path | Filters | `sort` whitelist |
| --- | --- | --- |
| `GET /categories` | `name` (contains, case-insensitive), `slug` (exact, lowercase) | `name`, `createdAt` |
| `GET /categories/:id` | - | - |
| `GET /categories/:id/products` | `minPrice`, `maxPrice`, `inStock` | `price`, `name`, `createdAt` |
| `GET /products` | `category` (slug), `minPrice`, `maxPrice`, `inStock` | `price`, `name`, `createdAt` |
| `GET /products/:id` | - | - |
| `GET /customers` | `name` (contains, case-insensitive), `email` (contains, case-insensitive) | `name`, `createdAt` |
| `GET /customers/:id` | - | - |
| `GET /orders` | `status`, `customerId` | `createdAt` |
| `GET /orders/:id` | - | - |

Every list accepts `limit` (default 20, max 100), `offset` (default 0), `sort` and `order` (`asc`/`desc`).

- **`limit` is clamped when it is too large, rejected when it is not a positive integer.** `limit=5000` returns
  `200` with `meta.limit = 100` (clamped to `config.pagination.maxLimit`), while `limit=0`, `limit=-5`, `limit=abc`
  and an empty `limit` (`?limit=`) all return `400 BAD_QUERY_PARAMS`. An absent `limit` uses the default (`20`).
  This rule lives in the shared pagination schema, so it applies to every list endpoint.
- `offset=0` is valid (any non-negative integer is); a negative or non-numeric `offset` returns `400 BAD_QUERY_PARAMS`.
- **`GET /products` also supports forward-only cursor paging.** Pass `cursor` - the opaque token from
  `meta.nextCursor` - instead of `offset`, and the page's `meta` becomes `{ total, limit, hasMore, nextCursor }`
  with **no** `offset`. Combining `cursor` with `offset`, an empty or undecodable cursor, and a cursor whose
  product is no longer in the (filtered) result set are all `400 BAD_QUERY_PARAMS`. Offset mode is unchanged
  except that it now also carries `nextCursor` (`null` on the last page), so a client can switch to cursor
  paging mid-browse.
- **An empty filter value is rejected, never silently ignored** - `?name=` / `?slug=` on `/categories`,
  `?name=` / `?email=` on `/customers`, `?category=` / `?minPrice=` / `?maxPrice=` / `?inStock=` on `/products`,
  `?minPrice=` / `?maxPrice=` / `?inStock=` on `/categories/:id/products`, and `?status=` / `?customerId=` on
  `/orders` all return `400 BAD_QUERY_PARAMS` rather than "matching everything". The numeric filters treat `0` as a
  real bound (`minPrice=0` is `>= 0`, `maxPrice=0` is `<= 0`), so a value of `0` is never dropped.
- **Multiple filters on one request combine with `AND`** - e.g. `/customers?name=ann&email=gmail.com` keeps only rows
  that satisfy both, and `/categories?name=electronics&slug=electronics` only the one category matching both.
- `GET /categories` `slug` is an **exact** match (the value is lowercased first, so `slug=ELECTRONICS` matches the
  stored `electronics`; a prefix like `slug=electro` matches nothing), while `name` is a case-insensitive substring.
- `GET /customers` `name` and `email` are both case-insensitive substring (`contains`) matches.
- `GET /categories/:id/products` accepts the **same** `minPrice` / `maxPrice` / `inStock` filters as `GET /products`
  - they come from one shared schema and one shared `where` builder, so a fix to one endpoint can never drift from
  the other. `minPrice > maxPrice` is rejected with `400` on both.

`sort` outside a resource's whitelist, `minPrice` greater than `maxPrice`, an unknown `status` and a malformed
`customerId` all return `400 BAD_QUERY_PARAMS`. A malformed or unknown `:id` returns `404 NOT_FOUND` (never `500`).

- `minPrice` / `maxPrice` are in **kobo** (minor units), matching the stored `priceMinor`.
- If `offset` exceeds the total count (e.g. `GET /api/v1/products?offset=5000`), the response returns `200` with `data: []`, `hasMore: false`, and the accurate `total`.
- `GET /orders` list items include `totalMinor`, computed across the page in one grouped query (`SUM(quantity * unitPriceMinor)` grouped by `orderId`).
- `GET /orders/:id` returns `items` plus `totalMinor`, computed in the query
  (`SUM(quantity * unitPriceMinor)`) and never stored.
- Money totals cast before multiplying: `quantity` and `unitPriceMinor` are both `int4`, so the
  query uses `SUM(quantity::bigint * unitPriceMinor)`. Without the cast `int4 * int4` overflows
  above `2,147,483,647` (e.g. `2 x 2,000,000,000`) before `SUM` ever runs.
- `createdAt` is identical across seeded rows, so every order-by adds `id` as a tie-break
  and offset pagination stays stable page to page.

### Write endpoints

| Method & path | Body | Success |
| --- | --- | --- |
| `POST /orders` | `{ customerId, items: [{ productId, quantity }] }` | `201` + `Location: /api/v1/orders/:id`; body carries `items` and computed `totalMinor` |
| `PATCH /orders/:id` | `{ status }`, one of `pending`, `paid`, `shipped`, `cancelled` | `200` with the **same shape as `GET /orders/:id`** (order head + `items` + computed `totalMinor`) |
| `DELETE /orders/:id` | none | `204` with an empty body |

- Request bodies use **strict** Zod schemas: an unknown field is rejected with `422` naming that
  field instead of being silently dropped. `items` must hold 1–`config.orders.maxItemsPerOrder`
  entries (`50`), each `quantity` must be 1–`config.orders.maxQuantityPerItem`, and
  **`maxQuantityPerItem` is `1000`**. All ids must be UUIDs. `422` messages name the exact location
  (`items[0].quantity`, `items[1].productId`, `note`, `customerId`).
- A well-formed `customerId`/`productId` that does not exist is also a `422` naming the field -
  `customerId: customer does not exist`, `items[0].productId: product does not exist` - because the
  collection URI `/api/v1/orders` itself exists; replying `404` would blame the wrong resource.
- `POST` performs its writes in **one `$transaction`**: the order and its items are inserted
  together, each item's `unitPriceMinor` is copied from the product's current price at order time,
  and `totalMinor` is computed from the inserted rows. It does **not** decrement stock and contains
  no payment logic.
- `PATCH` changes `status` only and enforces **no transition rules**: any of the four statuses may
  move to any other, in any order (there is no state machine). Its response is the full order
  detail, so a client never needs a follow-up `GET`.
- `PATCH`/`DELETE` treat both an **unknown** and a **malformed** `:id` as `404 NOT_FOUND`; a second
  `DELETE` of the same id is likewise `404`.
- The customer/product lookups run **before** the transaction, so a bad reference is rejected
  without opening a write transaction at all.
- Body-size and parse failures are handled before any route: over `config.jsonBodyLimit` (`100kb`)
  -> `413 PAYLOAD_TOO_LARGE`, malformed JSON -> `400 INVALID_JSON`. The rate limiter is mounted
  **above** `express.json`, so these malformed/oversized requests are counted too (they carry
  `RateLimit-*` headers, and a flood of them still hits `429`).

## 8. Layout

```
prisma/schema.prisma      models, CHECK constraints, onDelete rules
prisma/migrations/        versioned SQL migrations
prisma/seed.ts            deterministic, idempotent seed script
src/config.ts             single validated config object
src/server.ts             server entry point (listens on config.port)
src/app.ts                Express app: security, rate limit, routes, error handler
src/db.ts                 one shared PrismaClient
src/middleware/           error handler, UUID + pagination/sort validation
src/routes/               v1 router; one file per resource
src/test/                 test DB setup/teardown hooks
vitest.config.ts          wires the test DB hooks into Vitest
```

## 9. Design decisions

Each decision lists the alternative that was considered.

- **UUID primary keys** (`@id @default(uuid()) @db.Uuid`) instead of sequential integers -
  ids are not enumerable, so they leak nothing about volume or insertion order.
  Alternative: `Int @id @default(autoincrement())`.
- **Money as an integer in minor units** (`priceMinor`, `unitPriceMinor`, in kobo) plus a
  `currency` column defaulting to `"NGN"` - integers are exact, and NGN has a stable
  2-decimal minor unit, so 150000 means NGN 1,500.00. Alternative: `Decimal` or float
  columns (floats are unacceptable for money; `Decimal` is exact but adds conversion work).
- **Order totals are computed from `order_items`, never stored** - a stored total can drift
  from the items it summarises; computing on read keeps one source of truth.
  Alternative: a cached `totalMinor` column for read speed, refreshed on write.
- **Order status is plain text guarded by a Postgres CHECK constraint**
  (`chk_order_status IN ('pending','paid','shipped','cancelled')`) instead of a Prisma enum -
  the constraint enforces the rule at the database boundary, and adding a status later is a
  one-line migration. Alternative: a Prisma enum (type-safe in TypeScript, but every change
  is a migration and the values are not portable to arbitrary text).
- **`onDelete` rules:** `Order -> OrderItem` cascades; `Product` and `Customer` are
  `Restrict` - deleting a product or customer must never silently destroy order history.
- **One typed `config` object** (`src/config.ts`, validated with Zod: port, `DATABASE_URL`,
  `nodeEnv`, pagination 20/100, rate limit 60000ms/100, `jsonBodyLimit` `100kb`, and order write
  limits 50 items / quantity 1000) instead of reading `process.env` in
  handlers - tunable numbers live in one place. It is never logged, because it holds the
  database URL. Alternative: per-handler constants or a `.env` read at each call site.
- **Seed uses `skipDuplicates`, not upserts or truncation** - safe to re-run, never deletes
  data. Alternative: `upsert` on natural keys (works, but more round-trips and still needs
  keys for tables that have none, like products), or truncate-then-insert (destructive).
- **Named Docker volume** (`ecommerce-postgres-data`) instead of an anonymous one - an
  anonymous volume is hash-named and easy to orphan accidentally on `docker rm`.
- **No `uuid` package** - Prisma's `@default(uuid())` and `faker.string.uuid()` cover every
  id the project needs.
- **`createdAt` added to `Category`, `Product` and `Customer`** (a Stage 5 migration with a
  fixed backfill) so `sort=createdAt` is real for every resource. The backfill and the seed
  both use the same fixed timestamp rather than `now()`, so a migrated database and a freshly
  seeded one hold identical values. Alternative: drop `createdAt` from the sort whitelists
  (contradicts the brief), or omit the backfill and stamp existing rows with the migration's
  clock time (breaks reproducibility).
- **Public sort names map to real columns in the route** (`price` -> `priceMinor`), so the
  API never leaks internal field names and the whitelist is the only sortable surface.
  Alternative: expose `priceMinor` directly.
- **Every order-by ends with `id`** - all seeded rows share one `createdAt`, so without a
  deterministic tie-break an offset page could repeat or skip rows. Alternative: vary
  per-row timestamps (more seed machinery for no API benefit).
- **`/products` offers both offset and cursor pagination; the other lists stay offset-only.** Offset can
  jump straight to any page, but if rows are inserted or deleted mid-browse every later page shifts, so a
  client can see a row twice or miss one - and a deep offset makes the database scan and discard all the
  skipped rows. A cursor is stable (it names a row, so it neither skips nor repeats under concurrent
  writes) and stays fast at depth, but it only moves forward and cannot jump to page N. `/products` is the
  largest, busiest collection so it gets both; categories, customers and orders stay offset-only because
  they are small and rarely paged deeply, where the extra `cursor`/`nextCursor` surface would not pay for
  itself. Alternative: cursor-only everywhere (loses direct page jumps for the small lists) or offset-only
  on `/products` (the collection where deep paging hurts most).
  - The token is **opaque by convention**: clients must treat `nextCursor` as a black box and never parse
    or construct it, so the encoding can change without a breaking API change.
  - A **deleted row invalidates the cursor** that named it (and so does a cursor that no longer matches the
    current filters) - the API answers `400 BAD_QUERY_PARAMS` instead of pretending it reached the end.
  - Cursor mode has **no previous page**: it only moves forward, so a client that wants to go back keeps its
    own history of cursors.
  - Every page still runs a `COUNT` for `total`. That is one extra count per request (accepted at this size
    for an accurate `total`); a cursor-only design could drop it by returning `hasMore` alone.
- **Read endpoints reject unknown filter values** (e.g. `status=refunded` -> `400`), because
  silently returning an empty list hides client typos. Alternative: accept any string and
  return `200` with `total: 0`.
- **A body that references a missing row is `422`, not `404`** - an unknown `customerId` or
  `productId` in a `POST /orders` body makes the *request body* semantically invalid, while the
  collection URI `/api/v1/orders` itself exists. `404` is reserved for a `:id` in the path that
  does not exist (and for a second `DELETE`). Alternative: `404` for a missing referenced row
  (more conventional for the referenced entity, but it conflates "the resource in the URL is
  missing" with "a field in your payload points nowhere").
- **The item price is copied at order time** - `POST /orders` writes `unitPriceMinor` from the
  product's *current* `priceMinor` into each `OrderItem`, rather than joining to `Product` on
  read. An order is a historical record: if the product's price later changes, the order must
  keep the price the customer was charged. Alternative: store only `productId`/`quantity` and
  resolve price on read (the order total would silently change whenever a price is edited).
- **The order insert is one `$transaction`** - the `Order` and its `OrderItem`s are written
  together, so a failure part way through (e.g. the item insert) rolls the whole thing back and
  never leaves an empty order behind. Alternative: create the order, then the items in separate
  statements (a crash between them leaves an orphan order).
- **`PATCH` has no status-transition rules** - the endpoint validates only that `status` is one
  of the four allowed values, not *which* transitions are legal; any status may follow any other.
  The brief asked for a status setter, and inventing a state machine would reject valid edits
  (e.g. correcting a mis-set status) for no stated benefit. Alternative: a transition matrix
  (only `pending -> paid -> shipped`, plus cancel rules).
- **Lookups before the transaction** - the `customerId`/`productId` existence checks run before
  `$transaction` opens, so a bad reference is a cheap `422` and no write transaction is ever
  started for a request that cannot succeed. Alternative: check inside the transaction (holds a
  transaction open for work that is known to fail).
- **The rate limiter is mounted above `express.json`** - body-parse and size failures (`400`
  `INVALID_JSON`, `413` `PAYLOAD_TOO_LARGE`) are exactly the cheap, abuse-prone requests a limiter
  exists to cap, so they must be counted. Alternative: limit after the body parser (oversized /
  malformed floods bypass the budget entirely).
- **`500`s never expose the underlying error** - the fallback returns the fixed
  `{"code":"INTERNAL_ERROR","message":"Internal server error"}` and logs the real error (with its
  stack) with `console.error` server-side. A Prisma or SQL message in a response body can leak
  schema, file paths or data. Alternative: echo `err.message` (convenient while developing, a
  disclosure risk in production).
- **Write endpoints are unauthenticated by design** - the brief put auth out of scope, so
  `POST`/`PATCH`/`DELETE` require no credentials. Abuse is bounded by the rate limit (100 requests /
  60s per IP, counting malformed and oversized requests too), and because the seed is deterministic
  and idempotent, re-running it restores any deleted seed rows without touching other data.
  Alternative: API keys or sessions (a whole auth subsystem the brief excluded).
- **Tests run against a throwaway `ecommerce_test` database** built and seeded by a Vitest
  hook and dropped afterwards, rather than against `ecommerce`. Alternative: reuse
  `ecommerce` (fast, but tests would read and could mutate your demo data).
- **Test DB teardown asserts the database name is exactly `ecommerce_test`** before running
  `DROP DATABASE`, guarding against catastrophic drops if configuration or environment variables shift.
- **Single-resource responses and `/health` return `{ data }` with no `meta`** - pagination
  collection metadata (`total`, `limit`, `offset`, `hasMore`) is meaningless for a single entity.
  Lists keep `{ data, meta }`. Alternative: return uniform collection meta on single items (redundant noise).
- **Order list totals computed in one grouped query** - `GET /orders` computes `totalMinor` for
  each order in the page using `GROUP BY "orderId"` and `SUM(quantity * unitPriceMinor)`, avoiding
  N per-row queries. Alternative: compute per row (N+1 queries) or persist totals (risks drift).
- **`asyncHandler` wraps every async route** because Express 4 does not forward rejected
  promises to the error handler, so a thrown `ApiError` would become an unhandled rejection.

## 10. Known warnings

- Prisma prints `The configuration property package.json#prisma is deprecated and will be
  removed in Prisma 7`. The seed wiring still works on Prisma 6; moving it to a
  `prisma.config.ts` file is a Prisma 7 task.
- `npm audit` reports 10 findings (3 moderate, 5 high, 2 critical). All are in tooling:
  `deepmerge-ts` via `prisma` (fixable with `npm audit fix`), and `esbuild` / `tinypool` via
  `vite` / `vitest` (only fixable by `npm audit fix --force`, which installs vitest 5, a
  breaking change). Deliberately not auto-fixed mid-assessment; a dependency upgrade pass
  should be scheduled on its own.
