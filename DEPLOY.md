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
| `TRUST_PROXY_HOPS` | `1` | *(Optional, default `1`)* Number of reverse-proxy hops Express trusts when deriving `req.ip`. Still needed for Express internals (`req.ip`, `req.ips`) and as the limiter's fallback. See [Rate Limiting](README.md#rate-limiting). |
| `CLIENT_IP_HEADER` | `x-real-ip` | *(Recommended on Railway)* HTTP header whose value is the client's real IP, set by Railway's edge proxy. The rate limiter reads this header directly instead of using Express's `req.ip` hop-counting. Empty by default; allowlisted to `x-real-ip` only. See [Step 9](#step-9-rate-limit--security-verification). |
| `LOG_CLIENT_IP_HEADER` | `false` | *(Optional, default `false`)* Diagnostic: logs the raw `X-Real-IP` the process receives, so you can confirm the edge **replaces** the header rather than appending to it. At most 10 distinct values per process. Switch on for the Step 9 verification, switch off afterwards. See [Step 9 → Check 0](#check-0--read-the-raw-x-real-ip-out-of-the-railway-logs-do-this-first). |

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

The rate limiter keys on the client's IP address.  There are two mechanisms, and this step proves which one is working on **this** deployment:

| Mechanism | How it keys | When to use it |
| :--- | :--- | :--- |
| **Hop counting** (default) | Express's `req.ip`, derived from the socket peer + `X-Forwarded-For` by walking `TRUST_PROXY_HOPS` hops back | Platforms with a **documented, stable** proxy chain |
| **Header** (opt-in) | The value of a platform-set header, read directly | Railway, whose internal mesh makes the hop count unstable |

When `CLIENT_IP_HEADER=x-real-ip` is set, the limiter reads the IP from Railway's `X-Real-IP` header directly, bypassing Express's `req.ip` hop-counting.  The header *name* is validated against an allowlist at boot (currently `x-real-ip` only, so `x-forwarded-for` can never be selected); the header *value* is validated with `net.isIP()` and must be a single, trimmed, ≤45-character string with no commas, otherwise it falls back to `req.ip`.

> [!IMPORTANT]
> **Run Check 0 first.**  The header mechanism is only safe if Railway's edge **replaces** `X-Real-IP` rather than appending to it.  The forged-header tests alone cannot tell those two apart, so the raw header value is read out of the Railway logs and compared with your own public IP.

### Variables for this verification run

Set these on the **ecommerce-api** service in Railway (Variables tab) and **redeploy** — Railway injects variables into the container at start, so a restart is not enough.

| Variable | Value | Why |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production runtime mode (CORS). Required. |
| `CLIENT_IP_HEADER` | `x-real-ip` | The mechanism under test. |
| `LOG_CLIENT_IP_HEADER` | `true` | Turns on the raw-header diagnostic that Check 0 needs. |
| `TRUST_PROXY_HOPS` | *unset* | Not used while the header mechanism is under test; it is only the fallback. |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | As above — do not change. |
| `CORS_ORIGIN` | *your consumer origin* | As above — do not change. |

Run the checks in order: **Check 0 → 1 → 2 → 3 → 4**.

### Check 0 — Read the raw `X-Real-IP` out of the Railway logs (do this FIRST)

This is the check that decides whether the header mechanism may be used at all.

**Step 0a — note your own public IP:**

```powershell
curl.exe -s https://ifconfig.me
```

Write the value down; call it `MY_IP` (for example `203.0.113.7`).

**Step 0b — send one request with a forged `X-Real-IP`:**

```powershell
$LIVE_URL = "https://LIVE_URL_PLACEHOLDER"

curl.exe -s -o NUL -w "%{http_code}`n" `
  -H "X-Real-IP: 99.99.99.99" `
  "$LIVE_URL/api/v1/health"
```

**Step 0c — read the log line.**  In Railway, open the **ecommerce-api** service → **Logs** and find the line that starts with `[ratelimit] x-real-ip raw=`:

```
[ratelimit] x-real-ip raw=203.0.113.7 req.ip=10.0.0.5
```

Compare the `raw=` value with `MY_IP` and apply the decision table:

| Logged `raw=` value | Meaning | Action |
| :--- | :--- | :--- |
| exactly `MY_IP`, **no comma** | Railway's edge **replaces** `X-Real-IP` — the forged value was stripped | ✅ **Keep `CLIENT_IP_HEADER=x-real-ip`.** Continue with Check 1. |
| `99.99.99.99, <MY_IP>` (a **comma list**) | Railway's edge **appends** to `X-Real-IP` | ❌ **Unset `CLIENT_IP_HEADER`**, set `TRUST_PROXY_HOPS=2` instead, redeploy, and re-run **Check 1**. |
| `99.99.99.99` (the forged value) | the header is **not overwritten** → spoofable | ❌ **Unset `CLIENT_IP_HEADER`.** Do not use it. |

> [!CAUTION]
> The middle row is the dangerous one.  If Railway appends, the app receives a comma list, rejects it, falls back to `req.ip` — and the forged-header tests below still answer `429`, **for the wrong reason**.  Only the raw value in the log distinguishes the two.

> [!NOTE]
> The diagnostic logs at most **10 distinct values per process**, and each value is truncated to 100 characters.  Only `X-Real-IP` and `req.ip` are ever printed — never any other header.  If the log line is missing entirely, the request may have hit a **different Railway instance** than the one you deployed to; send a couple more requests until you see one.

### Check 1 — Parallel flood: prove there is a **single** bucket

The flood must be **parallel**.  A sequential loop can be spread across proxy hops and hide a keying problem.

```powershell
$LIVE_URL = "https://LIVE_URL_PLACEHOLDER"

# One line per request: the status code and the limiter's own remaining-count
# header.  The syntax is %header{Name} - note there is NO extra %{ ... }
# around it, and the closing brace belongs to the header name.
# %header{} needs curl 7.84+; Windows 10/11 ships curl 8.x.
# Check with: curl.exe --version
#
# The output is captured first so it can be summarised below - do NOT run the
# flood twice, the second run would start inside an already-exhausted window.
$out = curl.exe -s -o NUL `
  -w "%{http_code} %header{RateLimit-Remaining}`n" `
  --parallel --parallel-max 50 `
  "$LIVE_URL/api/v1/health?n=[1-300]"

$ok  = @($out | Where-Object { $_ -like "200 *" } | ForEach-Object { ($_ -split " ")[1] })
$bad = @($out | Where-Object { $_ -like "429 *" })

"200 count      : $($ok.Count)"
"429 count      : $($bad.Count)"
"remaining seen : $(($ok | Sort-Object -Unique -Property { [int]$_ }) -join ',')"
"duplicates     : $(($ok | Group-Object | Where-Object Count -gt 1 | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', ')"
```

**Expected:**

```
200 count      : 100
429 count      : 200
remaining seen : 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99
duplicates     :
```

**Why this is the assertion that matters.**  The remaining count is assigned when the request is counted, and with `--parallel-max 50` the first 50 requests are in flight together, so the values arrive in an arbitrary order — the countdown is visible as a **set**, not as a sequence.  The decisive signal is that **`99…0` each appears exactly once**.  Two interleaved countdowns would repeat values and leave gaps.

**Failure signature:** `duplicates` is non-empty, or the `429` count is `0`.  Both mean the requests landed in more than one bucket — the limiter is keying on a Railway proxy hop, not on the client.  Cross-check by looking for more than one value in the `x-hikari-trace` response header: one trace value per counter confirms it.

A run against a limiter that is **keyed on a proxy hop** (two interleaved buckets) produces exactly this, and it is what the live deployment showed before this change:

```
200 count      : 200
429 count      : 100
remaining seen : 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99
duplicates     : 99 x2, 98 x2, 97 x2, … 1 x2, 0 x2
```

Every remaining value appears **twice**: two countdowns, two buckets, no limit.  The `duplicates` line is the check — it is empty on a healthy deployment and full on a broken one.

### Check 2 — Forged `X-Forwarded-For` after the flood

Run this **while the budget from Check 1 is still exhausted** (within the same 60-second window):

```powershell
# Must return 429 — a forged XFF must not buy a fresh budget.
curl.exe -s -o NUL -w "%{http_code}`n" `
  -H "X-Forwarded-For: 99.99.99.99" `
  "$LIVE_URL/api/v1/health"

# Rotating the forged value must not help either.
1..5 | ForEach-Object {
  curl.exe -s -o NUL -w "%{http_code}`n" `
    -H "X-Forwarded-For: 10.0.0.$_" `
    "$LIVE_URL/api/v1/health"
}
```

**Expected:** every line `429`.

### Check 3 — Forged `X-Real-IP` after the flood

Run this **while the budget is still exhausted**:

```powershell
# Must return 429 — the edge should replace X-Real-IP, so a forged value never
# reaches the app.  If this returns 200, the header is spoofable and
# CLIENT_IP_HEADER must NOT be used.
curl.exe -s -o NUL -w "%{http_code}`n" `
  -H "X-Real-IP: 99.99.99.99" `
  "$LIVE_URL/api/v1/health"

# The same forged value again: a spoofable header keeps answering 200 (a fresh
# bucket), it never turns into 429.
1..5 | ForEach-Object {
  curl.exe -s -o NUL -w "%{http_code}`n" `
    -H "X-Real-IP: 99.99.99.99" `
    "$LIVE_URL/api/v1/health"
}

# Rotating the forged value must not help either.
1..5 | ForEach-Object {
  curl.exe -s -o NUL -w "%{http_code}`n" `
    -H "X-Real-IP: 10.0.0.$_" `
    "$LIVE_URL/api/v1/health"
}
```

**Expected:** every line `429`.

> [!CAUTION]
> If any line prints `200`, **stop**: `X-Real-IP` is spoofable on this deployment and `CLIENT_IP_HEADER` must be unset.

> [!NOTE]
> This check proves that the forged value is **not used as the key**.  It cannot by itself distinguish "the edge replaces the header" from "the edge appends to it" — in the appended case the app sees a comma list, rejects it, falls back to `req.ip`, and still answers `429`.  **Check 0 is what settles that.**

### Check 4 — Second network

After the 60-second rate-limit window resets, open a browser or terminal on your **smartphone connected to mobile data** (not Wi-Fi — a different public IP) and visit:

`https://LIVE_URL_PLACEHOLDER/api/v1/health`

**Expected:** `200 OK` with `{"data":{"status":"ok"}}`.  This confirms the rate limit is per-client-IP, not per-proxy-node or global.

If `429`: the phone's IP may share a budget with your laptop (unlikely on mobile data), or the limiter is keying on a proxy node.  Re-run Check 1 from the phone's network to isolate.

### After the checks — switch the diagnostic off

Once Checks 0–4 have passed, turn the diagnostic **off** again and redeploy:

1. On the **ecommerce-api** service in Railway, open **Variables** and set:
   ```
   LOG_CLIENT_IP_HEADER=false
   ```
2. Leave `CLIENT_IP_HEADER=x-real-ip` in place (that is the mechanism you just verified).
3. Redeploy the service.
4. Re-run **Check 1** once to confirm the limiter still behaves exactly as before the change was made.

The diagnostic is a temporary verification tool, not a permanent logging setting: it prints client IP addresses into the platform logs.

### If Checks 0–4 all pass

The rate limiter is correctly keying on the client's real IP via `X-Real-IP`.  No further changes are needed.

> [!IMPORTANT]
> Re-run these checks after any Railway infrastructure change (region migration, plan change, custom domain) that might alter the proxy chain.  Railway's overwrite behaviour is documented and confirmed by staff, but is not contractually guaranteed — these checks serve as an ongoing canary.

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
