# Production Deployment Runbook

This guide covers deploying the **ecommerce-api** to **Railway** (Express API + PostgreSQL) and preparing it for connection with the **React + Vite consumer** on **Vercel**.

---

## Architecture & Principles

1. **Isolation of Secrets:** No production connection strings, credentials, or keys are committed to the repository.
2. **Private Networking in Production:** Within Railway, the API communicates with PostgreSQL over the private internal network mesh (`DATABASE_URL=${{Postgres.DATABASE_URL}}`).
3. **Forward-Only Migrations:** Production uses `npx prisma migrate deploy` in Railway's pre-deploy hook. Migrations are strictly forward-only: never run `migrate dev`, `migrate reset`, or `db push` in production.
4. **Guarded Seeding:** The seed script refuses to run against any non-local database host unless `CONFIRM_PRODUCTION_SEED=yes` is explicitly supplied.
5. **Session-Scoped Production Seeding:** The initial seed is executed from your local terminal using the public TCP proxy connection string (`DATABASE_PUBLIC_URL`), scoped strictly to a single terminal session and immediately cleared.

---

## Prerequisites

- [Railway Account](https://railway.com/) with GitHub repository access.
- Local Windows PowerShell environment with Node.js 22+ and `curl.exe`.
- Docker running locally (for your local development database).

---

## Step 1: Create Railway Project and PostgreSQL Service

1. Log into your **Railway Dashboard**.
2. Click **New Project** → **Provision PostgreSQL**.
   - This creates a PostgreSQL 16 database service named `Postgres`.
3. In the project canvas, click **Create** → **GitHub Repo** → select `ecommerce-api`.
   - This adds your Express API service linked to the repository.

---

## Step 2: Configure Environment Variables on Railway

Select the **ecommerce-api** service, navigate to the **Variables** tab, and configure:

| Variable | Value | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Cross-service reference resolving to the private internal database network. |
| `NODE_ENV` | `production` | Enables production runtime mode. **Must be set**, otherwise it defaults to `development` and local development origins stay CORS-allowed. See [CORS Behaviour](#cors-behaviour). |
| `CORS_ORIGIN` | `https://your-consumer.vercel.app` | *(Optional / set after consumer deployment)* Comma-separated list of **exact** allowed origins. `*.vercel.app` subdomains are permitted automatically, so this is only needed for a custom domain. |

> [!NOTE]
> `PORT` is dynamically injected by Railway at runtime; do not define it manually.

---

## Step 3: Configure Build & Deploy Settings

Railway will automatically detect `railway.json` in the root of the repository. You can verify these values in the **Settings** tab of the `ecommerce-api` service:

- **Builder:** `NIXPACKS`
- **Build Command:** `npm run build` (runs `tsc`)
- **Pre-Deploy Command:** `npx prisma migrate deploy`
- **Start Command:** `npm start` (runs `node dist/server.js`)
- **Healthcheck Path:** `/api/v1/health`
- **Healthcheck Timeout:** `300` seconds
- **Restart Policy:** `On Failure` (max retries: 10)

---

## Step 4: Generate Public Domain for the API

1. Under the **ecommerce-api** service, navigate to **Settings** → **Networking** → **Public Networking**.
2. Click **Generate Domain**.
3. Copy the assigned URL (e.g., `https://ecommerce-api-production-xxxx.up.railway.app`).
   - This URL replaces `https://LIVE_URL_PLACEHOLDER` in documentation and consumer configuration.

---

## Step 5: Enable Public Database Access (Temporary for Seeding)

To run the initial seed from your laptop into the production database:

1. Click on the **Postgres** service in Railway.
2. Go to **Settings** → **Networking** → **Public Networking**.
3. Click **Enable Public Access**.
4. Switch to the **Connect** or **Variables** tab and copy the **`DATABASE_PUBLIC_URL`**.
   - It will look like: `postgresql://postgres:password@monorail.proxy.rlwy.net:12345/railway`
   - If missing `sslmode`, append `?sslmode=require` to ensure encrypted transmission.

---

## Step 6: Apply Migrations and Seed Production from Your Laptop

Open a Windows PowerShell terminal. Set `DATABASE_URL` and `CONFIRM_PRODUCTION_SEED` **strictly for this session only**:

```powershell
# 1. Set session-scoped variables (replace with your actual DATABASE_PUBLIC_URL)
$env:DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@monorail.proxy.rlwy.net:PORT/railway?sslmode=require"
$env:CONFIRM_PRODUCTION_SEED="yes"

# 2. Deploy migrations to production database
npx prisma migrate deploy

# 3. Seed deterministic baseline into production database
npm run seed

# 4. Immediately clear session credentials
Remove-Item Env:\DATABASE_URL
Remove-Item Env:\CONFIRM_PRODUCTION_SEED
```

### Expected Output
The seed script will detect `CONFIRM_PRODUCTION_SEED=yes`, display the masked production hostname (e.g., `mo***net`), and print row counts before and after:
```console
[Seed] CONFIRM_PRODUCTION_SEED=yes detected. Seeding non-local database host: "mo***net"
[Seed] Deterministic seed (faker.seed(42))
[Seed] Row counts BEFORE run: (all 0)
[Seed] Inserting 20 categories...
[Seed] Inserting 300 customers...
[Seed] Inserting 400 products...
[Seed] Inserting 500 orders...
[Seed] Inserting order items (1 to 5 per order)...
[Seed] Row counts AFTER run:
  categories: 20
  products:   400
  customers:  300
  orders:     500
  orderItems: 1513
[Seed] Done.
```

---

## Step 7: Verify Production Database State

Connect to the production database via `psql` using `DATABASE_PUBLIC_URL`:

```powershell
# Verify row counts
@"
SELECT 'Category' as tbl, count(*) from "Category"
UNION ALL SELECT 'Product', count(*) from "Product"
UNION ALL SELECT 'Customer', count(*) from "Customer"
UNION ALL SELECT 'Order', count(*) from "Order"
UNION ALL SELECT 'OrderItem', count(*) from "OrderItem";
"@ | psql "postgresql://postgres:YOUR_PASSWORD@monorail.proxy.rlwy.net:PORT/railway?sslmode=require"

# Verify deterministic product-id MD5 hash
@"
SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM "Product";
"@ | psql "postgresql://postgres:YOUR_PASSWORD@monorail.proxy.rlwy.net:PORT/railway?sslmode=require"
```

**Verification Expectations:**
- Category: `20`
- Product: `400`
- Customer: `300`
- Order: `500`
- OrderItem: `1513`
- Product-ID MD5: **`6e893584d823dec20fbc918bb310d4e6`**

> [!TIP]
> Once seeding and verification are complete, you may disable **Public Networking** on the PostgreSQL service in Railway if external access is no longer required.

---

## Step 8: Production Smoke-Test Suite

Run these smoke tests from PowerShell against your live URL (`$LIVE_URL = "https://your-app.up.railway.app"`):

```powershell
$LIVE_URL = "https://LIVE_URL_PLACEHOLDER"

# 1. Health check (Expected: 200 OK, {"data":{"status":"ok"}})
curl.exe -i "$LIVE_URL/api/v1/health"

# 2. Paginated products (Expected: 200 OK, data array + meta)
curl.exe -s "$LIVE_URL/api/v1/products?limit=2"

# 3. Limit clamping (Expected: 200 OK, meta.limit = 100)
curl.exe -s "$LIVE_URL/api/v1/products?limit=5000"

# 4. Unknown route (Expected: 404 NOT_FOUND)
curl.exe -i "$LIVE_URL/api/v1/nonexistent-route"

# 5. Invalid order body (Expected: 422 UNPROCESSABLE_ENTITY)
curl.exe -i -X POST "$LIVE_URL/api/v1/orders" `
  -H "Content-Type: application/json" `
  -d '{"invalidField":"data"}'

# 6. Rate-limiting flood (Sends 105 requests in a loop; verify 429 with Retry-After)
1..105 | ForEach-Object {
  curl.exe -s -o /dev/null -w "%{http_code}`n" "$LIVE_URL/api/v1/health"
}
```

---

## Step 9: Rate Limit & Security Verification

### A. Per-Client Rate Limit Independence
1. From your laptop, run the 105-request flood loop above until `curl.exe` receives `429 Too Many Requests`.
2. Immediately open a browser or terminal on your **smartphone (connected to mobile data, not Wi-Fi)** and visit:
   `https://LIVE_URL_PLACEHOLDER/api/v1/health`
3. **Verify:** The phone receives `200 OK` (`{"data":{"status":"ok"}}`), proving the rate limit is strictly partitioned per client IP and does not block other users.

### B. Spoofed Header Protection (`trust proxy = 1`)
1. From your laptop, attempt to bypass the rate limit by forging an IP in the `X-Forwarded-For` header:
   ```powershell
   1..105 | ForEach-Object {
     curl.exe -s -o /dev/null -w "%{http_code}`n" `
       -H "X-Forwarded-For: 1.2.3.4" `
       "$LIVE_URL/api/v1/health"
   }
   ```
2. **Verify:** The requests still hit `429 Too Many Requests`. Because `app.set('trust proxy', 1)` is enabled, Express trusts only the immediate Railway reverse proxy hop and correctly evaluates the real client IP rather than arbitrary spoofed header values.

---

## CORS Behaviour

The API mounts the `cors` package with a **function** for `origin` (`src/app.ts`), so every request is decided by that callback, in this order:

1. **No `Origin` header** → allowed. Covers `curl`, server-to-server calls and native clients.
2. **`CORS_ORIGIN` list** → allowed. The variable is split on commas, trimmed, and empty entries dropped; the match is **exact string equality** against the request's `Origin` header.
3. **Vercel deployments** → allowed. `isAllowedVercelOrigin()` parses the origin and allows it when the **hostname ends with `.vercel.app`**. That matches any subdomain (`https://my-app.vercel.app`) over either scheme, but **not** the apex `vercel.app`, which has no leading dot.
4. **Local development origins** → allowed **only when `NODE_ENV !== 'production'`**. The regex `^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$` matches any `http://localhost[:port]` or `http://127.0.0.1[:port]` on any port. The scheme must be `http`, so `https://localhost:5173` does **not** match and is refused.
5. **Everything else** → refused (`callback(null, false)`). The `cors` package then omits `Access-Control-Allow-Origin`, so the browser blocks the response.

Allowed methods are `GET, POST, PATCH, DELETE, OPTIONS`; allowed request headers are `Content-Type, Authorization`.

### What changes when `NODE_ENV=production`

Rule 4 is skipped entirely, so local development origins are refused. The allowed set is then only:

- requests with **no `Origin` header** (curl, server-to-server, native clients),
- the **exact** origins listed in `CORS_ORIGIN`,
- any **`*.vercel.app` subdomain**.

`NODE_ENV` defaults to `development` when the variable is unset (`src/config.ts`), so a deployment that omits `NODE_ENV=production` keeps allowing local origins.

Verify the live deployment with a **single discriminating request**. Only rule 4 depends on `NODE_ENV`, so the probe must use a local origin:

```bash
curl -i -H "Origin: http://localhost:5173" "https://LIVE_URL_PLACEHOLDER/api/v1/products?limit=1"
# NODE_ENV != 'production' (rule 4 active):  Access-Control-Allow-Origin: http://localhost:5173
# NODE_ENV == 'production'  (rule 4 skipped): no Access-Control-Allow-Origin header
```

> [!IMPORTANT]
> `Origin: https://example.com` is **not** a valid check. Rule 5 refuses it in both modes, so it comes back without an `Access-Control-Allow-Origin` header either way and cannot tell you whether `NODE_ENV=production` is actually in effect. The `http://localhost[:port]` origin is the only probe that distinguishes the two modes — use it every time you change this variable.

---

## Consumer Deployment (Vercel)

The React + Vite consumer lives in the `consumer/` directory of this repository and is deployed as its **own Vercel project**, separate from the Railway API service.

### 1. Import the repository

1. Log into the **Vercel Dashboard** (`https://vercel.com`).
2. Click **Add New…** → **Project** → **Import** (or **Add New…** → **Project** → *Import Git Repository*).
3. Select the **same GitHub repository** Railway deploys and click **Import**.
   - If Vercel asks for repository access, grant the Vercel GitHub App read access to it.
   - One repository can feed several Vercel projects; the Railway service and the Vercel project deploy independently from the same source.

### 2. Configure the project settings

In the project's **Settings** → **General**:

| Setting | Value |
| :--- | :--- |
| **Framework Preset** | `Vite` |
| **Root Directory** | `consumer` |
| **Install Command** | `npm install` (default) |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Node.js Version** | `22.x` or newer |

> [!IMPORTANT]
> The **Root Directory must be `consumer`**. The consumer is a self-contained project with its own `package.json`, lockfile, `tsconfig` files and `node_modules`. Leaving the Root Directory at the repository root would build the Express API (`tsc`) instead of the web app.

### 3. Set the API URL environment variable

In **Settings** → **Environment Variables**, add:

| Variable | Value | Environments |
| :--- | :--- | :--- |
| `VITE_API_URL` | `https://LIVE_URL_PLACEHOLDER` | Production, Preview, Development |

- Use the **public API origin**: no trailing slash, and **without** `/api/v1`. The consumer appends `/api/v1/...` to the value itself.
- The same variable is read locally from `consumer/.env.local` (gitignored). `consumer/.env.example` carries the placeholder.
- The app refuses to start against anything that is not an **absolute `https:` URL with a non-empty hostname**: if the variable is missing, empty, unparseable, plain `http:` or hostless, the page renders a configuration error and issues **no requests**.

> [!WARNING]
> **Vite inlines `VITE_*` variables at build time.** They are baked into the JavaScript bundle and are *not* read when the page runs. Editing `VITE_API_URL` in the Vercel dashboard therefore changes **nothing until you redeploy**: open the **Deployments** tab → **⋯** on the latest deployment → **Redeploy** (or push a new commit). Without that redeploy the old URL keeps being served.

### 4. Deploy

1. Click **Deploy**.
2. Wait for the build to finish. The log should show `vite v… building for production…` followed by `✓ built in …`.
3. Open the generated URL (`https://<project>-<hash>.vercel.app`). The catalog renders and the first request goes to `https://LIVE_URL_PLACEHOLDER/api/v1/products?limit=12&sort=name&order=asc`.

### 5. Confirm in the browser that requests hit the live API and no CORS error occurs

1. Open the deployed URL, open **DevTools** → **Network** tab, and reload the page.
2. Filter the list by **Fetch/XHR** to hide static assets.
3. **Confirm the target host.** The `products` and `categories` requests show a `Request URL` of
   `https://LIVE_URL_PLACEHOLDER/api/v1/products?limit=12&sort=name&order=asc`.
   The host is the Railway API — never a local address.
4. **Confirm the response.** Select the `products` request → **Response** tab shows `{"data":[…],"meta":{"total":400,…}}`.
5. **Confirm CORS.** Select the same request → **Response Headers** shows
   `access-control-allow-origin: https://<your-project>.vercel.app`.
   A `*.vercel.app` subdomain is allowed by rule 3 of [CORS Behaviour](#cors-behaviour), so no extra Railway configuration is needed for a Vercel-hosted consumer. The **Console** tab must stay free of `Access to fetch … has been blocked by CORS policy`.
6. **Confirm the paging.** Click **Next**: a second `products` request appears whose `Request URL` contains `cursor=…` and whose `Response` shows the next 12 products.

### 6. Optional: custom domain

If you point a custom domain at the consumer, add its origin to the API's `CORS_ORIGIN` variable on Railway (comma-separated), then redeploy the API. `*.vercel.app` origins are already permitted automatically.
