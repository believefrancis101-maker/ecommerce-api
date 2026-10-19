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

`typecheck` uses a separate `tsconfig.typecheck.json` (it extends the build config and turns
emit off), so `npm run build` keeps its `dist/` layout unchanged.

## 6. Tests

`npm test` needs no environment setup: a Vitest `globalSetup` hook creates `ecommerce_test`,
applies every migration and runs the seed against it, and a `setupFiles` hook points the
worker's `DATABASE_URL` at it before `src/config.ts` / `src/db.ts` load. The database is
dropped again in teardown. Tests therefore never read or mutate your `ecommerce` data, and a
clean checkout can run `npm test` without exporting `DATABASE_URL` by hand.

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

| Method & path | Filters | `sort` whitelist |
| --- | --- | --- |
| `GET /categories` | `q` (name, slug) | `name`, `createdAt` |
| `GET /categories/:id` | - | - |
| `GET /categories/:id/products` | - | `price`, `name`, `createdAt` |
| `GET /products` | `category` (slug), `minPrice`, `maxPrice`, `inStock` | `price`, `name`, `createdAt` |
| `GET /products/:id` | - | - |
| `GET /customers` | `q` (name, email) | `name`, `createdAt` |
| `GET /customers/:id` | - | - |
| `GET /orders` | `status`, `customerId` | `createdAt` |
| `GET /orders/:id` | - | - |

Every list accepts `limit` (default 20, max 100, clamped), `offset` (default 0), `sort` and
`order` (`asc`/`desc`). `sort` outside a resource's whitelist, a non-numeric `limit`/`offset`,
`minPrice` greater than `maxPrice`, an unknown `status` and a malformed `customerId` all return `400 BAD_QUERY_PARAMS`. A
malformed or unknown `:id` returns `404 NOT_FOUND` (never `500`).

- `minPrice` / `maxPrice` are in **kobo** (minor units), matching the stored `priceMinor`.
- If `offset` exceeds the total count (e.g. `GET /api/v1/products?offset=5000`), the response returns `200` with `data: []`, `hasMore: false`, and the accurate `total`.
- `GET /orders` list items include `totalMinor`, computed across the page in one grouped query (`SUM(quantity * unitPriceMinor)` grouped by `orderId`).
- `GET /orders/:id` returns `items` plus `totalMinor`, computed in the query
  (`SUM(quantity * unitPriceMinor)`) and never stored.
- `createdAt` is identical across seeded rows, so every order-by adds `id` as a tie-break
  and offset pagination stays stable page to page.

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
  `nodeEnv`, pagination 20/100, rate limit 60000ms/100) instead of reading `process.env` in
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
- **Read endpoints reject unknown filter values** (e.g. `status=refunded` -> `400`), because
  silently returning an empty list hides client typos. Alternative: accept any string and
  return `200` with `total: 0`.
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
