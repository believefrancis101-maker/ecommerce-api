# ecommerce-api

E-commerce REST API built with Node.js, Express, TypeScript, PostgreSQL and Prisma.

**Status:** database schema, CHECK constraints and a repeatable seed script are in place.
The HTTP layer (`/api/v1`) is the next stage, so no endpoints are documented here yet.

## Requirements

- Node.js 22+ and npm
- Docker (local PostgreSQL 16)

## 1. Environment

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

- **Deterministic:** `faker.seed(42)` plus ids from `faker.string.uuid()`, and a fixed order
  date window - no values depend on when the script runs.
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
| `npm test` | `vitest run` |
| `npm run seed` | Seed the database |
| `npm run typecheck` | `tsc --noEmit` over `src/` **and** `prisma/seed.ts` |

`typecheck` uses a separate `tsconfig.typecheck.json` (it extends the build config and turns
emit off), so `npm run build` keeps its `dist/` layout unchanged.

## 6. Layout

```
prisma/schema.prisma      models, CHECK constraints, onDelete rules
prisma/migrations/        versioned SQL migrations
prisma/seed.ts            deterministic, idempotent seed script
src/config.ts             single validated config object
src/{middleware,routes,schemas}   HTTP layer (next stage)
```

## 7. Design decisions

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

## 8. Known warnings

- Prisma prints `The configuration property package.json#prisma is deprecated and will be
  removed in Prisma 7`. The seed wiring still works on Prisma 6; moving it to a
  `prisma.config.ts` file is a Prisma 7 task.
- `npm audit` reports 10 findings (3 moderate, 5 high, 2 critical). All are in tooling:
  `deepmerge-ts` via `prisma` (fixable with `npm audit fix`), and `esbuild` / `tinypool` via
  `vite` / `vitest` (only fixable by `npm audit fix --force`, which installs vitest 5, a
  breaking change). Deliberately not auto-fixed mid-assessment; a dependency upgrade pass
  should be scheduled on its own.
