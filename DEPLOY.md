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
| `NODE_ENV` | `production` | Enables production runtime mode. |
| `CORS_ORIGIN` | `https://your-consumer.vercel.app` | *(Optional / set after consumer deployment)* Allowed production origin. `*.vercel.app` domains are also permitted automatically. |

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

## Step 10: Vercel Consumer App Deployment (Stage 10 Preview)

When deploying the frontend consumer in Stage 10 to Vercel:
1. In the Vercel project settings, set:
   - **`VITE_API_URL`**: `https://LIVE_URL_PLACEHOLDER/api/v1`
2. Deploy the consumer.
3. If necessary, add the custom consumer domain to `CORS_ORIGIN` in Railway.
