# ecommerce-api

E-commerce REST API built with Node.js, Express 4, TypeScript, PostgreSQL (via Docker), and Prisma 6.

- **Live API URL:** `https://ecommerce-api-production-3c59.up.railway.app`
- **Deployed Consumer App:** `https://ecommerce-api-eight-gamma.vercel.app/` (source in `/consumer` — React + Vite + TypeScript)
- **Repository:** `https://github.com/believefrancis101-maker/ecommerce-api`
- **Status:** API stages 1-9 complete. 149 tests passing. Frozen deterministic seed. Stage 10 consumer app implemented in `/consumer`, **deployed to Vercel** at the URL above, and verified against the live API.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Resources & Data Model](#resources--data-model)
3. [Endpoint Reference](#endpoint-reference)
4. [Pagination, Filtering, and Sorting](#pagination-filtering-and-sorting)
5. [Error Handling](#error-handling)
6. [Rate Limiting](#rate-limiting)
7. [Running Locally from a Fresh Clone](#running-locally-from-a-fresh-clone)
8. [Consumer App](#consumer-app)
9. [Tests](#tests)
10. [Deployment](#deployment)
11. [Design Decisions](#design-decisions)
12. [Evidence](#evidence)
13. [Deployment URLs](#deployment-urls)

---

## Quick Start

Prerequisites: Node.js 22+, npm, and Docker.

```bash
# 1. Clone and enter repository
git clone https://github.com/believefrancis101-maker/ecommerce-api.git
cd ecommerce-api

# 2. Start PostgreSQL in Docker
docker run -d --name ecommerce-postgres \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=ecommerce \
  -p 5432:5432 \
  -v ecommerce-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine

# 3. Configure environment
cp .env.example .env

# 4. Install dependencies, migrate, and seed
npm install
npx prisma migrate deploy
npx prisma db seed

# 5. Start development server (port 3000)
npm run dev
```

Verify the running server:
```bash
curl -s "http://localhost:3000/api/v1/health"
```
```json
{
  "data": {
    "status": "ok"
  }
}
```

---

## Resources & Data Model

The API manages five core resources: `Category`, `Product`, `Customer`, `Order`, and `OrderItem`.

### Entity Relationship Diagram

```mermaid
erDiagram
    Category ||--o{ Product : "contains (1:N)"
    Product ||--o{ OrderItem : "ordered in (1:N)"
    Customer ||--o{ Order : "places (1:N)"
    Order ||--|{ OrderItem : "contains (1:N, cascade)"
```

### Database Rules & Constraints

- **Primary Keys:** UUID v4 (`@id @default(uuid()) @db.Uuid`) on all tables.
- **Foreign Keys & Deletion Rules:**
  - `Product.categoryId -> Category.id`: `ON DELETE RESTRICT` (cannot delete a category containing products).
  - `Order.customerId -> Customer.id`: `ON DELETE RESTRICT` (cannot delete a customer with order history).
  - `OrderItem.orderId -> Order.id`: `ON DELETE CASCADE` (deleting an order cascades and deletes its line items).
  - `OrderItem.productId -> Product.id`: `ON DELETE RESTRICT` (cannot delete a product referenced in orders).
- **Unique Constraints:**
  - `Category`: `name` is unique (`Category_name_key`); `slug` is unique (`Category_slug_key`).
  - `Customer`: `email` is unique (`Customer_email_key`).
- **PostgreSQL CHECK Constraints:**
  - `Order`: `chk_order_status` enforces `status IN ('pending', 'paid', 'shipped', 'cancelled')`.
  - `Product`: `chk_product_price` enforces `priceMinor >= 0`.
  - `Product`: `chk_product_stock` enforces `stock >= 0`.
  - `OrderItem`: `chk_order_item_quantity` enforces `quantity >= 1`.
  - `OrderItem`: `chk_order_item_unit_price` enforces `unitPriceMinor >= 0`.

---

### Resource Schemas

#### Category
| Field | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `id` | `UUID` | Yes | Primary key |
| `name` | `String` | Yes | Unique category title |
| `slug` | `String` | Yes | Unique URL-safe slug derived from name |
| `createdAt` | `DateTime` | Yes | Creation timestamp (ISO 8601) |

#### Product
| Field | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `id` | `UUID` | Yes | Primary key |
| `categoryId` | `UUID` | Yes | Foreign key to `Category.id` (`onDelete: Restrict`) |
| `name` | `String` | Yes | Product name |
| `description` | `String` | No | Optional description |
| `priceMinor` | `Integer` | Yes | Price in kobo (NGN minor units); CHECK `priceMinor >= 0` |
| `currency` | `String` | Yes | Defaults to `"NGN"` |
| `stock` | `Integer` | Yes | Inventory stock count; CHECK `stock >= 0` |
| `createdAt` | `DateTime` | Yes | Creation timestamp (ISO 8601) |

#### Customer
| Field | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `id` | `UUID` | Yes | Primary key |
| `name` | `String` | Yes | Full name |
| `email` | `String` | Yes | Unique email address |
| `createdAt` | `DateTime` | Yes | Creation timestamp (ISO 8601) |

#### Order
| Field | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `id` | `UUID` | Yes | Primary key |
| `customerId` | `UUID` | Yes | Foreign key to `Customer.id` (`onDelete: Restrict`) |
| `status` | `String` | Yes | Order status; CHECK `status IN ('pending', 'paid', 'shipped', 'cancelled')` |
| `currency` | `String` | Yes | Defaults to `"NGN"` |
| `createdAt` | `DateTime` | Yes | Creation timestamp (ISO 8601) |
| `updatedAt` | `DateTime` | Yes | Update timestamp (ISO 8601) |

#### OrderItem
| Field | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `id` | `UUID` | Yes | Primary key |
| `orderId` | `UUID` | Yes | Foreign key to `Order.id` (`onDelete: Cascade`) |
| `productId` | `UUID` | Yes | Foreign key to `Product.id` (`onDelete: Restrict`) |
| `quantity` | `Integer` | Yes | Count ordered; CHECK `quantity >= 1`, max 1000 |
| `unitPriceMinor` | `Integer` | Yes | Unit price in kobo copied from product at order time; CHECK `unitPriceMinor >= 0` |

### Seed Data & Determinism

The dataset is produced by `prisma/seed.ts` and is **frozen** — once it has been seeded into production, the generation logic must not change, because changing it produces different ids and a second dataset next to the first.

| Resource | Rows | Kind |
| :--- | ---: | :--- |
| `Category` | **20** | A **small fixed reference set** — a hard-coded list of 20 real store categories. Its length *is* the count (no separate constant that could drift). |
| `Product` | **400** | A **few hundred** main-resource rows, distributed round-robin so every category has stock. |
| `Customer` | **300** | A **few hundred** main-resource rows. |
| `Order` | **500** | A **few hundred** main-resource rows. |
| `OrderItem` | **1513** | Emergent: 1–5 distinct products per order. |

So the shape is deliberate: **categories are a small reference set** (a lookup table), while **products, customers and orders are the few-hundred-row main resources** the pagination, filtering and sorting features are exercised against.

**Repeatability is guaranteed, not hoped for:**

- `faker.seed(42)` fixes the random stream, so every run generates byte-for-byte the same data.
- Timestamps do not depend on when the script runs: order dates come from a fixed window, and every seeded row carries a fixed `createdAt`.
- Rows are inserted with `skipDuplicates: true`, so re-running the script is idempotent — it inserts 0 rows the second time and the before/after count tables are identical.
- The seed refuses to run against a non-local database unless `CONFIRM_PRODUCTION_SEED=yes` is set explicitly, and it prints the masked host name when it does.
- **Proof of determinism:** the product ids can be checksummed, and the checksum is stable across a fresh clone, the local development database and production:
  ```sql
  SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM "Product";
  -- 6e893584d823dec20fbc918bb310d4e6
  ```
  That digest covers **all** 400 product ids, ascending by id, comma-joined with no spaces, MD5 of the UTF-8 string.

Run it with `npx prisma db seed` (see [Running Locally from a Fresh Clone](#running-locally-from-a-fresh-clone) for the full sequence).

---

## Endpoint Reference

All endpoints are mounted under `/api/v1`. 

> [!NOTE]
> **PowerShell Users:** Use `curl.exe` instead of `curl` (which is aliased to `Invoke-WebRequest`). For JSON request bodies, write the payload to a `.json` file and pass `--data "@body.json"` to prevent PowerShell from stripping quotes.

Every example below targets `https://ecommerce-api-production-3c59.up.railway.app`. Collection outputs use `limit=2` and are shortened for brevity.

---

### 1. Health Check

#### `GET /api/v1/health`
Returns server operational status.

- **Query Parameters:** None
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/health"
  ```
- **Response (`200 OK`):**
  ```json
  {
    "data": {
      "status": "ok"
    }
  }
  ```

---

### 2. Categories

#### `GET /api/v1/categories`
List categories with pagination, sorting, and search filters.

- **Query Parameters:**
  - `limit` (`integer`, optional, default: `20`, max: `100`): Page size.
  - `offset` (`integer`, optional, default: `0`, min: `0`): Number of records to skip.
  - `sort` (`string`, optional, default: `name`): Whitelist: `name`, `createdAt`.
  - `order` (`string`, optional, default: `asc`): `asc` or `desc`.
  - `name` (`string`, optional): Case-insensitive substring match.
  - `slug` (`string`, optional): Exact lowercase slug match.
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/categories?limit=2"
  ```
- **Response (`200 OK`, shortened):**
  ```json
  {
    "data": [
      {
        "id": "fd46d528-eb91-49f2-a8eb-bb54ccde88ca",
        "name": "Appliances",
        "slug": "appliances",
        "createdAt": "2026-01-01T00:00:00.000Z"
      },
      {
        "id": "91ffb84d-a2ed-4fb9-96ed-006cf296fdd7",
        "name": "Automotive",
        "slug": "automotive",
        "createdAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "meta": {
      "total": 20,
      "limit": 2,
      "offset": 0,
      "hasMore": true
    }
  }
  ```

#### `GET /api/v1/categories/:id`
Retrieve a single category by UUID.

- **Path Parameters:**
  - `id` (`UUID`, required): Category ID.
- **Query Parameters:** None
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/categories/fd46d528-eb91-49f2-a8eb-bb54ccde88ca"
  ```
- **Response (`200 OK`):**
  ```json
  {
    "data": {
      "id": "fd46d528-eb91-49f2-a8eb-bb54ccde88ca",
      "name": "Appliances",
      "slug": "appliances",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

#### `GET /api/v1/categories/:id/products`
List all products belonging to a specific category.

- **Path Parameters:**
  - `id` (`UUID`, required): Category ID.
- **Query Parameters:**
  - `limit` (`integer`, optional, default: `20`, max: `100`): Page size.
  - `offset` (`integer`, optional, default: `0`, min: `0`): Number of records to skip.
  - `sort` (`string`, optional, default: `createdAt`): Whitelist: `price`, `name`, `createdAt`.
  - `order` (`string`, optional, default: `desc`): `asc` or `desc`.
  - `minPrice` (`integer`, optional, min: `0`): Minimum price in kobo.
  - `maxPrice` (`integer`, optional, min: `0`): Maximum price in kobo (must be `>= minPrice`).
  - `inStock` (`string`, optional): `true`, `false`, `1`, or `0`.
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/categories/fd46d528-eb91-49f2-a8eb-bb54ccde88ca/products?limit=2"
  ```
- **Response (`200 OK`, shortened):**
  ```json
  {
    "data": [
      {
        "id": "0a9ba142-db35-4f9c-943c-aa89b45d48bf",
        "name": "Premium Microwave",
        "priceMinor": 6449600,
        "currency": "NGN",
        "stock": 254,
        "createdAt": "2026-01-01T00:00:00.000Z"
      },
      {
        "id": "0be2abea-f558-460b-acb5-850811c0f8f0",
        "name": "Original Vacuum Cleaner",
        "priceMinor": 10681500,
        "currency": "NGN",
        "stock": 254,
        "createdAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "meta": {
      "total": 20,
      "limit": 2,
      "offset": 0,
      "hasMore": true
    }
  }
  ```

---

### 3. Products

#### `GET /api/v1/products`
List products across all categories with dual pagination (offset or forward cursor).

- **Query Parameters:**
  - `limit` (`integer`, optional, default: `20`, max: `100`): Page size.
  - `offset` (`integer`, optional, default: `0`, min: `0`): Offset paging (mutually exclusive with `cursor`).
  - `cursor` (`string`, optional): Base64URL opaque token from previous `meta.nextCursor` (mutually exclusive with `offset`).
  - `sort` (`string`, optional, default: `price`): Whitelist: `price`, `name`, `createdAt`.
  - `order` (`string`, optional, default: `asc`): `asc` or `desc`.
  - `category` (`string`, optional): Category slug (e.g. `groceries`).
  - `minPrice` (`integer`, optional, min: `0`): Minimum price in kobo.
  - `maxPrice` (`integer`, optional, min: `0`): Maximum price in kobo.
  - `inStock` (`string`, optional): `true`, `false`, `1`, or `0`.
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/products?limit=2"
  ```
- **Response (`200 OK`, shortened):**
  ```json
  {
    "data": [
      {
        "id": "6dc892dc-a7fe-4a59-8964-6964c815ec5f",
        "name": "Everyday Granulated Sugar - 500g",
        "description": "Durable granulated sugar for daily needs.",
        "priceMinor": 145400,
        "currency": "NGN",
        "stock": 77,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "category": {
          "id": "72669a05-a8da-421a-809f-96a78f6fe311",
          "name": "Groceries",
          "slug": "groceries"
        }
      },
      {
        "id": "6a4609c6-6132-478f-9198-8d30a5044926",
        "name": "Everyday Conditioner - 250ml",
        "description": "Everyday conditioner that does the job.",
        "priceMinor": 165600,
        "currency": "NGN",
        "stock": 293,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "category": {
          "id": "ce561907-8490-40d5-928c-391088abf85c",
          "name": "Beauty & Personal Care",
          "slug": "beauty-personal-care"
        }
      }
    ],
    "meta": {
      "total": 400,
      "limit": 2,
      "offset": 0,
      "hasMore": true,
      "nextCursor": "NmE0NjA5YzYtNjEzMi00NzhmLTkxOTgtOGQzMGE1MDQ0OTI2"
    }
  }
  ```

#### `GET /api/v1/products/:id`
Retrieve a single product by UUID.

- **Path Parameters:**
  - `id` (`UUID`, required): Product ID.
- **Query Parameters:** None
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/products/6dc892dc-a7fe-4a59-8964-6964c815ec5f"
  ```
- **Response (`200 OK`):**
  ```json
  {
    "data": {
      "id": "6dc892dc-a7fe-4a59-8964-6964c815ec5f",
      "name": "Everyday Granulated Sugar - 500g",
      "description": "Durable granulated sugar for daily needs.",
      "priceMinor": 145400,
      "currency": "NGN",
      "stock": 77,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "category": {
        "id": "72669a05-a8da-421a-809f-96a78f6fe311",
        "name": "Groceries",
        "slug": "groceries"
      }
    }
  }
  ```

---

### 4. Customers

#### `GET /api/v1/customers`
List customers with pagination, sorting, and name/email search filters.

- **Query Parameters:**
  - `limit` (`integer`, optional, default: `20`, max: `100`): Page size.
  - `offset` (`integer`, optional, default: `0`, min: `0`): Offset.
  - `sort` (`string`, optional, default: `name`): Whitelist: `name`, `createdAt`.
  - `order` (`string`, optional, default: `asc`): `asc` or `desc`.
  - `name` (`string`, optional): Case-insensitive substring match.
  - `email` (`string`, optional): Case-insensitive substring match.
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/customers?limit=2"
  ```
- **Response (`200 OK`, shortened):**
  ```json
  {
    "data": [
      {
        "id": "ae3a192b-4792-4b4a-a2b2-63b4ee3916ba",
        "name": "Abagail Bogisich",
        "email": "abagail.bogisich.210@example.com",
        "createdAt": "2026-01-01T00:00:00.000Z"
      },
      {
        "id": "7b3d933a-d64d-4a77-83a5-f779ec7b9737",
        "name": "Adam Raynor",
        "email": "adam.raynor.155@example.com",
        "createdAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "meta": {
      "total": 300,
      "limit": 2,
      "offset": 0,
      "hasMore": true
    }
  }
  ```

#### `GET /api/v1/customers/:id`
Retrieve a single customer by UUID.

- **Path Parameters:**
  - `id` (`UUID`, required): Customer ID.
- **Query Parameters:** None
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/customers/ae3a192b-4792-4b4a-a2b2-63b4ee3916ba"
  ```
- **Response (`200 OK`):**
  ```json
  {
    "data": {
      "id": "ae3a192b-4792-4b4a-a2b2-63b4ee3916ba",
      "name": "Abagail Bogisich",
      "email": "abagail.bogisich.210@example.com",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

---

### 5. Orders

#### `GET /api/v1/orders`
List orders with status and customer filters. Totals are computed across the page in one grouped query (`totalMinor`).

- **Query Parameters:**
  - `limit` (`integer`, optional, default: `20`, max: `100`): Page size.
  - `offset` (`integer`, optional, default: `0`, min: `0`): Offset.
  - `sort` (`string`, optional, default: `createdAt`): Whitelist: `createdAt`.
  - `order` (`string`, optional, default: `desc`): `asc` or `desc`.
  - `status` (`string`, optional): Whitelist: `pending`, `paid`, `shipped`, `cancelled`.
  - `customerId` (`UUID`, optional): Valid customer UUID.
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/orders?limit=2"
  ```
- **Response (`200 OK`, shortened):**
  ```json
  {
    "data": [
      {
        "id": "ef6ac626-cc32-4e0b-b0de-41746a35ca5a",
        "customerId": "d0e7aaea-9182-4b8a-801b-110fb545ca22",
        "status": "paid",
        "currency": "NGN",
        "createdAt": "2026-08-30T13:36:16.257Z",
        "updatedAt": "2026-08-31T02:36:16.257Z",
        "totalMinor": 7481800
      },
      {
        "id": "29687052-7eff-4f0b-a4dd-6744fe341fe8",
        "customerId": "743a0c13-6755-4fa0-b6e4-1c990293884f",
        "status": "paid",
        "currency": "NGN",
        "createdAt": "2026-08-30T10:30:46.455Z",
        "updatedAt": "2026-09-02T01:30:46.455Z",
        "totalMinor": 13654800
      }
    ],
    "meta": {
      "total": 500,
      "limit": 2,
      "offset": 0,
      "hasMore": true
    }
  }
  ```

#### `GET /api/v1/orders/:id`
Retrieve full order details including line items and dynamically computed `totalMinor`.

- **Path Parameters:**
  - `id` (`UUID`, required): Order ID.
- **Query Parameters:** None
- **cURL:**
  ```bash
  curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/orders/ef6ac626-cc32-4e0b-b0de-41746a35ca5a"
  ```
- **Response (`200 OK`):**
  ```json
  {
    "data": {
      "id": "ef6ac626-cc32-4e0b-b0de-41746a35ca5a",
      "customerId": "d0e7aaea-9182-4b8a-801b-110fb545ca22",
      "status": "paid",
      "currency": "NGN",
      "createdAt": "2026-08-30T13:36:16.257Z",
      "updatedAt": "2026-08-31T02:36:16.257Z",
      "items": [
        {
          "id": "5d5a2842-9afa-48ed-988f-9b1b41db6630",
          "productId": "a3620387-83ab-45ea-bb40-dd15aad26160",
          "quantity": 1,
          "unitPriceMinor": 7481800
        }
      ],
      "totalMinor": 7481800
    }
  }
  ```

#### `POST /api/v1/orders`
Create an order and its items in a single atomic `$transaction`. Copies `unitPriceMinor` from product catalog at order time.

- **Headers:** `Content-Type: application/json`
- **Request Body Rules:**
  - `customerId`: Valid UUID of an existing customer (missing -> `422`).
  - `items`: 1 to 50 items (`config.orders.maxItemsPerOrder`).
  - `items[].productId`: Valid UUID of an existing product (missing -> `422`, duplicate -> `422`).
  - `items[].quantity`: Integer between 1 and 1000 (`config.orders.maxQuantityPerItem`).
  - Schema is `.strict()`: extra fields trigger `422`.
- **cURL:**
  ```bash
  curl -i -X POST "https://ecommerce-api-production-3c59.up.railway.app/api/v1/orders" \
    -H "Content-Type: application/json" \
    -d '{
      "customerId": "ae3a192b-4792-4b4a-a2b2-63b4ee3916ba",
      "items": [
        {
          "productId": "6dc892dc-a7fe-4a59-8964-6964c815ec5f",
          "quantity": 2
        }
      ]
    }'
  ```
- **Response (`201 Created`):**
  - **Location Header:** `/api/v1/orders/d1006e2d-edd3-48cd-869f-7959092079b9`
  ```json
  {
    "data": {
      "id": "d1006e2d-edd3-48cd-869f-7959092079b9",
      "customerId": "ae3a192b-4792-4b4a-a2b2-63b4ee3916ba",
      "status": "pending",
      "currency": "NGN",
      "createdAt": "2026-10-20T11:12:31.309Z",
      "updatedAt": "2026-10-20T11:12:31.309Z",
      "items": [
        {
          "id": "45a765c7-cddc-4153-93a5-f4fee7cb5e5b",
          "productId": "6dc892dc-a7fe-4a59-8964-6964c815ec5f",
          "quantity": 2,
          "unitPriceMinor": 145400
        }
      ],
      "totalMinor": 290800
    }
  }
  ```

#### `PATCH /api/v1/orders/:id`
Update an order's status. Returns the complete order detail matching `GET /orders/:id`.

- **Path Parameters:**
  - `id` (`UUID`, required): Order ID.
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  - `status` (`string`, required): One of `pending`, `paid`, `shipped`, `cancelled`.
- **cURL:**
  ```bash
  curl -i -X PATCH "https://ecommerce-api-production-3c59.up.railway.app/api/v1/orders/d1006e2d-edd3-48cd-869f-7959092079b9" \
    -H "Content-Type: application/json" \
    -d '{"status":"paid"}'
  ```
- **Response (`200 OK`):**
  ```json
  {
    "data": {
      "id": "d1006e2d-edd3-48cd-869f-7959092079b9",
      "customerId": "ae3a192b-4792-4b4a-a2b2-63b4ee3916ba",
      "status": "paid",
      "currency": "NGN",
      "createdAt": "2026-10-20T11:12:31.309Z",
      "updatedAt": "2026-10-20T11:12:31.327Z",
      "items": [
        {
          "id": "45a765c7-cddc-4153-93a5-f4fee7cb5e5b",
          "productId": "6dc892dc-a7fe-4a59-8964-6964c815ec5f",
          "quantity": 2,
          "unitPriceMinor": 145400
        }
      ],
      "totalMinor": 290800
    }
  }
  ```

#### `DELETE /api/v1/orders/:id`
Permanently delete an order and cascade-delete its order items.

- **Path Parameters:**
  - `id` (`UUID`, required): Order ID.
- **cURL:**
  ```bash
  curl -i -X DELETE "https://ecommerce-api-production-3c59.up.railway.app/api/v1/orders/d1006e2d-edd3-48cd-869f-7959092079b9"
  ```
- **Response (`204 No Content`):**
  - Empty body. A second `DELETE` to the same ID returns `404 NOT_FOUND`.

---

## Pagination, Filtering, and Sorting

### 1. Pagination Modes: Offset vs. Cursor

All list endpoints (`/categories`, `/categories/:id/products`, `/products`, `/customers`, `/orders`) support offset pagination. In addition, `/products` supports forward-only cursor pagination.

#### Offset Pagination
- `limit`: Number of rows to return (default: `20`, max: `100`).
- `offset`: Number of rows to skip (default: `0`).
- **Response Metadata:**
  ```json
  "meta": { "total": 400, "limit": 20, "offset": 0, "hasMore": true }
  ```
- If `offset` exceeds `total` (e.g. `?offset=5000`), the API returns `200 OK` with `data: []`, `hasMore: false`, and the accurate `total`.

#### Cursor Pagination (`GET /api/v1/products`)
Cursor pagination provides stable, drift-free forward scrolling:
- Pass `cursor=<token>` using the opaque string returned in `meta.nextCursor`.
- `meta` switches to cursor format with **no** `offset`:
  ```json
  "meta": { "total": 400, "limit": 2, "hasMore": true, "nextCursor": "YzJkYTMyYWUtYjU5NC00ZmI5LWE2OTUtMDZlYTFlNDM0OTg3" }
  ```
- **Rules & Restrictions:**
  - Combining `cursor` and `offset` on the same request returns `400 BAD_QUERY_PARAMS`.
  - An empty or malformed cursor returns `400 BAD_QUERY_PARAMS`.
  - If the product named by the cursor has been deleted or no longer satisfies the request filters, the API returns `400 BAD_QUERY_PARAMS` rather than mistakenly pretending the client reached the end of the list.
  - Forward-only: clients traverse forward using `nextCursor`; backward navigation is handled client-side.

#### Worked Cursor Example

**Step 1: Request Page 1**
```bash
curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/products?limit=2"
```
```json
{
  "data": [
    {
      "id": "6dc892dc-a7fe-4a59-8964-6964c815ec5f",
      "name": "Everyday Granulated Sugar - 500g",
      "priceMinor": 145400
    },
    {
      "id": "6a4609c6-6132-478f-9198-8d30a5044926",
      "name": "Everyday Conditioner - 250ml",
      "priceMinor": 165600
    }
  ],
  "meta": {
    "total": 400,
    "limit": 2,
    "offset": 0,
    "hasMore": true,
    "nextCursor": "NmE0NjA5YzYtNjEzMi00NzhmLTkxOTgtOGQzMGE1MDQ0OTI2"
  }
}
```

**Step 2: Request Page 2 with `cursor=NmE0NjA5YzYtNjEzMi00NzhmLTkxOTgtOGQzMGE1MDQ0OTI2`**
```bash
curl -s "https://ecommerce-api-production-3c59.up.railway.app/api/v1/products?limit=2&cursor=NmE0NjA5YzYtNjEzMi00NzhmLTkxOTgtOGQzMGE1MDQ0OTI2"
```
```json
{
  "data": [
    {
      "id": "237bf788-8800-411b-b3ee-ff482ced6c10",
      "name": "Essential Tomato Paste",
      "priceMinor": 206900
    },
    {
      "id": "c2da32ae-b594-4fb9-a695-06ea1e434987",
      "name": "Classic Cat Litter",
      "priceMinor": 246200
    }
  ],
  "meta": {
    "total": 400,
    "limit": 2,
    "hasMore": true,
    "nextCursor": "YzJkYTMyYWUtYjU5NC00ZmI5LWE2OTUtMDZlYTFlNDM0OTg3"
  }
}
```

---

### 2. Clamp-Versus-Reject Rule

The shared pagination validation schema enforces a strict clamp-versus-reject contract across every list endpoint:
- **Clamped:** If `limit` is a positive integer greater than `maxLimit` (`100`), it is clamped to `100`. For example, `?limit=5000` succeeds with `200 OK` and `meta.limit = 100`.
- **Rejected:** If `limit` is `0`, negative (e.g. `?limit=-5`), non-numeric (`?limit=abc`), or empty (`?limit=`), the request is rejected with `400 BAD_QUERY_PARAMS`.

---

### 3. Filtering Rules

- **Empty Filter Values Rejected:** Empty parameters (e.g. `?name=`, `?slug=`, `?minPrice=`, `?status=`) return `400 BAD_QUERY_PARAMS` rather than being silently ignored.
- **Literal LIKE Wildcards:** Special SQL wildcard characters (`%` and `_`) passed in text search filters (`name`, `email`) are escaped and matched literally. A search for `?name=%25` searches for a literal `%` character and returns 0 rows.
- **Multiple Filters Combine with AND:** Supplying multiple filters (e.g. `/customers?name=ann&email=gmail.com`) returns only entities matching both constraints.
- **Price Bounds in Minor Units:** `minPrice` and `maxPrice` are integers representing kobo (`150000` = NGN 1,500.00). Setting `minPrice > maxPrice` returns `400 BAD_QUERY_PARAMS`.

---

### 4. Sorting Whitelists

Every endpoint orders by a strict whitelist, with `id` appended as a deterministic tie-breaker:
- `GET /categories`: `name`, `createdAt` (default: `name asc`).
- `GET /categories/:id/products`: `price`, `name`, `createdAt` (default: `createdAt desc`).
- `GET /products`: `price`, `name`, `createdAt` (default: `price asc`).
- `GET /customers`: `name`, `createdAt` (default: `name asc`).
- `GET /orders`: `createdAt` (default: `createdAt desc`).

Supplying an unknown sort column returns `400 BAD_QUERY_PARAMS`.

---

## Error Handling

All error responses use a predictable, standard error envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Product not found"
  }
}
```

### Complete Error Code Reference

| HTTP | Error `code` | Scenario |
| :--- | :--- | :--- |
| `400` | `BAD_QUERY_PARAMS` | Invalid query parameters (`limit=0`, negative offset, invalid sort column, empty filter string, malformed UUID in query, `minPrice > maxPrice`, bad cursor token, or cursor combined with offset). |
| `400` | `INVALID_JSON` | Request payload body is not valid JSON. |
| `404` | `NOT_FOUND` | Unknown route, non-existent entity `:id`, malformed `:id` (non-UUID path parameter), or second `DELETE` of an already-deleted order. |
| `413` | `PAYLOAD_TOO_LARGE` | Request payload body exceeds `config.jsonBodyLimit` (`100kb`). |
| `422` | `UNPROCESSABLE_ENTITY` | Request body fails schema validation (extra keys, quantity outside 1–1000, >50 items, duplicate products), or references a customer/product UUID that does not exist in the database. |
| `429` | `TOO_MANY_REQUESTS` | IP exceeds rate limit (`100` requests / `60s`). Includes `Retry-After` header. |
| `500` | `INTERNAL_ERROR` | Unhandled server error. Body always returns generic message `"Internal server error"`; underlying errors are logged server-side only. |

---

## Rate Limiting

Rate limiting is enforced by `express-rate-limit` in `src/app.ts`:
- **Limit:** `100` requests per `60` seconds (`windowMs: 60000`) per IP address.
- **Headers Sent:**
  - `RateLimit-Limit`: `100`
  - `RateLimit-Remaining`: Count of remaining requests in the active window.
  - `RateLimit-Reset`: Seconds remaining until quota reset.
- **Rate Limit Exceeded:**
  - Status: `429 Too Many Requests`
  - Header: `Retry-After: 60`
  - Body:
    ```json
    {
      "error": {
        "code": "TOO_MANY_REQUESTS",
        "message": "Too many requests, please try again later"
      }
    }
    ```
- **Architectural Placement:** The limiter is mounted **above** `express.json()`. Oversized payloads (`413`) and malformed JSON floods (`400`) are counted against the caller's budget before payload parsing occurs.

### Client IP, `CLIENT_IP_HEADER` and `TRUST_PROXY_HOPS`

By default the limiter keys on `req.ip`.  Express derives `req.ip` from the socket peer plus the `X-Forwarded-For` header by walking **one hop per trusted proxy** back from the app (`app.set('trust proxy', n)` in `src/app.ts`), and `n` is read from the environment as **`TRUST_PROXY_HOPS`** (integer `0`–`5`, default `1`) and applied at boot.

| `TRUST_PROXY_HOPS` | `X-Forwarded-For: a, b` | `req.ip` / limiter key | Meaning |
| :--- | :--- | :--- | :--- |
| `1` | `a, b` | `b` — the **rightmost** entry | one proxy in front of the app |
| `2` | `a, b` | `a` — the **leftmost** entry | two proxies in front of the app |

Trusting **too few** hops keys the limiter on a proxy node rather than the visitor, so every client behind that node shares one budget. Trusting **too many** hops lets the caller choose the leftmost, caller-supplied entry and rotate it to reset the budget.

#### Why hop-counting is not enough on Railway

Railway's edge terminates TLS and forwards the request through an **internal mesh of proxies**.  The edge sets `X-Forwarded-For` to the client's address, and the internal hops then **append** their own addresses, so the header the app finally sees carries a **variable number of entries**.  The live deployment proved this: a 160-request flood produced **no** `429`s and `RateLimit-Remaining` counted down in **two interleaved sequences** that matched **two distinct `x-hikari-trace` values** — the requests were landing on two different internal hops, so the budget was charged to Railway's infrastructure instead of to the visitor.

Because the number of internal hops is not guaranteed to be stable, a fixed `TRUST_PROXY_HOPS` cannot be relied on: one hop too few charges a proxy node, one hop too many hands the key to the caller-supplied leftmost entry.

#### The opt-in header mechanism

To remove the hop count from the equation, the rate limiter supports an **opt-in** `CLIENT_IP_HEADER` environment variable.  It is **empty by default**, so local development and every non-Railway host keep keying on `req.ip` and never trust a caller-supplied header.

The header *name* is validated against an **explicit allowlist** — currently `x-real-ip` only — so an operator cannot accidentally trust an arbitrary caller-supplied header.  Setting it to a non-allowlisted name (e.g. `x-forwarded-for`) causes the app to **refuse to start** rather than silently trusting it.

When set, the `keyGenerator` reads the client IP directly from that header, bypassing Express's `req.ip` hop-counting entirely.  The header *value* is validated strictly:

- Must be a single value (no commas).
- Trimmed, at most 45 characters (a safety bound — the longest possible IPv6 literal is 39 characters).
- Must pass `net.isIP()` (rejects non-IP strings, ports, brackets, garbage).
- If missing, empty, multi-valued, oversized, or not a valid IP → **falls back to `req.ip`** (never a shared constant like `"unknown"`).

#### Verifying that the platform really replaces the header

Railway's staff state that the edge **replaces** (overwrites, not appends) `X-Forwarded-For` and `X-Real-IP`.  That is the behaviour the header mechanism depends on, so it has to be **verified on the deployment you are actually running**, not assumed.

`LOG_CLIENT_IP_HEADER` (boolean, default `false`) is a small diagnostic that makes that possible.  When it is on, the app logs the **raw** `X-Real-IP` value it received next to the address Express resolved on its own:

```
[ratelimit] x-real-ip raw=203.0.113.7 req.ip=203.0.113.9
```

The diagnostic reads the header **even when `CLIENT_IP_HEADER` is unset**, so the header can be inspected *before* anything is switched on.  It prints nothing but that header and `req.ip`, truncates each value to 100 characters, and logs **at most 10 distinct values per process**, so a caller cannot flood the log.

The three possible outcomes, and what each one means:

| Logged `raw=` value | Meaning | Action |
| :--- | :--- | :--- |
| exactly your public IP, no comma | the edge **replaces** the header | safe → keep `CLIENT_IP_HEADER=x-real-ip` |
| `<forged>, <your IP>` (a comma list) | the edge **appends** to the header | **do not** enable the header; use `TRUST_PROXY_HOPS=2` and re-verify |
| your forged value | the header is **not overwritten** → spoofable | **do not** enable the header |

This matters because a forged-header test **cannot** tell "replaced" and "appended" apart on its own: in the appended case the app sees a comma list, rejects it, falls back to `req.ip`, and still answers `429` — for the wrong reason.  See [DEPLOY.md → Step 9](DEPLOY.md#step-9-rate-limit--security-verification) for the full procedure.

#### Two strategies for different platforms

- **Railway (header-based):** Set `CLIENT_IP_HEADER=x-real-ip`.  The limiter reads the client's address straight from the header and no longer depends on how many internal hops the request crossed.  Run the Step 9 checks — including the raw-header inspection — before trusting it.
- **Other platforms (hop-count-based):** Use `TRUST_PROXY_HOPS` alone.  Match the hop count to the platform's documented, stable proxy chain.  `CLIENT_IP_HEADER` stays empty.

`TRUST_PROXY_HOPS` is **kept** even when `CLIENT_IP_HEADER` is set: it still controls Express's `req.ip` for everything else (logging, `req.ips`), and it is what the limiter falls back to if the header is missing or invalid.

#### Known limitation: IPv6 addresses are not grouped into a subnet

The key is the **full** IP address.  For IPv4 that is exactly right.  For IPv6 it is not: an IPv6 subscriber is normally given a routed `/64`, which contains roughly 2^64 addresses, so a client can rotate addresses **inside its own prefix** and receive a fresh budget for each one.  The limiter can therefore be bypassed by an IPv6 client that rotates its address.

`express-rate-limit` **7.5.1** (the version pinned here) has no helper for this: its default key generator returns `req.ip` unchanged and the package exports no IPv6 helper.  The helper — `ipKeyGenerator(ip, ipv6Subnet?)`, which reduces an IPv6 address to its `/56` prefix by default — was introduced in **`express-rate-limit` 8.0.0**, and 7.5.1 is the last release of the 7.x line, so **no same-major upgrade can fix this**.  Moving to 8.x would be a major-version upgrade of the rate limiter (8.x also changes `max` → `limit`, drops `onLimitReached`, and adds an `ERR_ERL_KEY_GEN_IPV6` validation that requires the custom key generator to call `ipKeyGenerator`), so it has deliberately **not** been done here.

The mitigation, when the platform is upgraded to 8.x, is to route both the header value and the `req.ip` fallback through the library helper:

```ts
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
// ...
keyGenerator: (req) => ipKeyGenerator(resolveClientIp(req), 64),
```

Until then, treat the limiter as a **guardrail rather than an enforcement mechanism** for IPv6 clients, and consider a platform-level control (Railway WAF / firewall rules) if that matters.

Verify the live deployment with the checks in [DEPLOY.md → Step 9: Rate Limit & Security Verification](DEPLOY.md#step-9-rate-limit--security-verification).

All mechanisms (`CLIENT_IP_HEADER` on/off and config allowlist, the `LOG_CLIENT_IP_HEADER` diagnostic, `TRUST_PROXY_HOPS` hop counts, and forged-header protection) are covered by `src/client-ip-header.test.ts` and `src/trust-proxy.test.ts`.

---

## Running Locally from a Fresh Clone

Follow these exact steps to clone, configure, migrate, seed, and run the service locally:

```bash
# 1. Clone repository
git clone https://github.com/believefrancis101-maker/ecommerce-api.git
cd ecommerce-api

# 2. Run local PostgreSQL 16 container
docker run -d --name ecommerce-postgres \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=ecommerce \
  -p 5432:5432 \
  -v ecommerce-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine

# 3. Create .env from template
cp .env.example .env

# 4. Install dependencies (triggers prisma generate in postinstall)
npm install

# 5. Apply migrations
npx prisma migrate deploy

# 6. Seed deterministic database
npx prisma db seed

# 7. Start server in watch mode
npm run dev
```

### Verification
In a second terminal, verify the service is running:
```bash
curl -s "http://localhost:3000/api/v1/health"
```

---

## Consumer App

`consumer/` is a self-contained **React 19 + Vite + TypeScript** single-page app that acts as an *external* consumer of the deployed API. It exists to prove the API works from the outside: it talks to the live Railway deployment over the network, never to a local server.

It is deliberately minimal — no router, no state library, no UI framework, no login, no cart. Plain CSS.

**The deployed app is live at `https://ecommerce-api-eight-gamma.vercel.app/`.** See [Deployment URLs](#deployment-urls) for how that was verified.

### Running it

```bash
cd consumer
npm install

# The real API URL lives in consumer/.env.local (gitignored).
# consumer/.env.example holds the same value for reference:
#   VITE_API_URL=https://ecommerce-api-production-3c59.up.railway.app

npm run dev        # dev server on http://localhost:5173
npm run build      # type-check (tsc -b) + production build into dist/
npm run preview    # serve the production build
```

`VITE_API_URL` is read **only** from `import.meta.env` — there is no default and no fallback baked into the bundle. It must be an **absolute URL with the `https:` scheme and a non-empty hostname**; if it is missing, empty, unparseable, plain `http:` or hostless, the page renders a visible configuration error and issues **no requests at all**. The value is the public API **origin** (no trailing slash); the app appends `/api/v1/...` itself. A value that already ends in `/api/v1` is accepted too — the suffix is stripped so the path never doubles up.

### What it does

| Area | Behaviour |
| :--- | :--- |
| Categories dropdown | `GET /api/v1/categories?limit=100&sort=name` |
| Product list | `GET /api/v1/products` with **cursor** pagination, 12 per page |
| Next | Sends `meta.nextCursor`; disabled when `!meta.hasMore` |
| Previous | Walks a client-side stack of previously used cursors; disabled on page 1 |
| Filters | Category (slug), sort field (`price` / `name`), sort direction (`asc` / `desc`), max price in NGN (converted to kobo, ×100) |
| Empty parameters | Never sent — the API answers `400` for an empty query value, so unset controls are omitted from the URL entirely |
| Reset | Changing any control returns to page 1 and clears the cursor stack |
| Display | Product name, category name, price (`priceMinor` / 100 via `Intl.NumberFormat('en-NG', { currency: 'NGN' })`), stock, and `Showing X to Y of <meta.total>` |
| Cancellation | Every request is made with an `AbortController`; a superseded request is aborted so a fast control change can never render a stale response |

### States

| State | What the user sees |
| :--- | :--- |
| Loading | Skeleton cards; every control (filters, Previous, Next) is disabled |
| Empty | "No products match the filters" + a **Reset Filters** button |
| Network failure | "Cannot reach the API" + **Retry** |
| HTTP 429 | "Too many requests, try again in a minute" + **Retry** |
| HTTP 400 (stale cursor) | The API's own message, and the app resets to page 1 |
| Any other API error | `error.message` from the `{ error: { code, message } }` envelope + **Retry** |

`Retry-After` is deliberately **not** read: browsers only expose cross-origin response headers listed in `Access-Control-Expose-Headers`, and the API does not expose `Retry-After`, so the value would always be `null`. See the comment in `consumer/src/api.ts`.

### Isolation from the root project

- The consumer has its own `package.json`, lockfile, `tsconfig` files and `node_modules`; it is never part of the API's dependency tree.
- The root `tsconfig.json` and `tsconfig.typecheck.json` both `"exclude": ["node_modules", "dist", "consumer"]`, so `npm run typecheck` and `npm run build` never compile consumer sources.
- The root Vitest config has no `include` override, and the consumer contains no test files, so `npm test` collects only the API's 11 test files.

---

## Tests

Run the Vitest test suite:
```bash
npm test
```

### Test Isolation Architecture
- The test harness uses a `globalSetup` hook in `src/test/global-setup.ts`.
- Tests run against an isolated throwaway database named `ecommerce_test`.
- Setup creates `ecommerce_test`, deploys all migrations, and runs the frozen seed against it.
- Teardown asserts the database name is strictly `ecommerce_test` before executing `DROP DATABASE ... WITH (FORCE)`.
- **Zero Test Contamination:** Your local `ecommerce` development database is never touched or mutated by test runs.
- **Suite Results:** 149 tests passing across 11 test files (`orders.write`, `products`, `categories`, `query-validation`, `orders`, `customers`, `rate-limit-body`, `app`, `rate-limit`, `trust-proxy`, `client-ip-header`).

---

## Deployment

The application is deployed across two platforms: the backend API and PostgreSQL database are hosted on **Railway**, while the React + Vite consumer application is hosted on **Vercel**. For detailed step-by-step setup, smoke testing, and verification procedures, refer to the [Production Deployment Runbook](DEPLOY.md).

### Environment Variables Matrix

| Platform | Variable | Type | Description |
| :--- | :--- | :--- | :--- |
| **Railway (API)** | `DATABASE_URL` | Private Reference | `${{Postgres.DATABASE_URL}}` (connects over internal private mesh) |
| **Railway (API)** | `NODE_ENV` | Configuration | `production` (**required** — see [CORS Behaviour](#cors-behaviour)) |
| **Railway (API)** | `PORT` | Dynamic | Injected automatically by Railway runtime |
| **Railway (API)** | `CORS_ORIGIN` | Configuration | Optional comma-separated list of **exact** allowed origins. `*.vercel.app` subdomains are permitted automatically. See [CORS Behaviour](#cors-behaviour) for the full rule set. |
| **Railway (API)** | `TRUST_PROXY_HOPS` | Configuration | `1` (optional) — number of reverse-proxy hops Express trusts when deriving `req.ip`. Used by the limiter as the fallback when `CLIENT_IP_HEADER` is unset or its value is rejected. See [Rate Limiting](#rate-limiting). |
| **Railway (API)** | `CLIENT_IP_HEADER` | Configuration | `x-real-ip` (optional) — HTTP header whose value is the client's real IP, set by the platform edge proxy. Validated against an allowlist (currently `x-real-ip` only); empty by default. When set, the rate limiter reads this header directly instead of using `req.ip`. See [Rate Limiting](#rate-limiting). |
| **Railway (API)** | `LOG_CLIENT_IP_HEADER` | Configuration | `false` (optional) — diagnostic that logs the raw `X-Real-IP` the process receives, so the edge's "replaces vs appends" behaviour can be verified. At most 10 distinct values per process, each truncated to 100 characters. Switch on for the Step 9 verification and off again afterwards. See [Rate Limiting](#rate-limiting). |
| **Vercel (Consumer)** | `VITE_API_URL` | Build-time | `https://ecommerce-api-production-3c59.up.railway.app` (public API origin, no trailing slash; the consumer appends `/api/v1` itself). Baked in at consumer build time. |

### Deployment Overview
1. **Database:** PostgreSQL 16 provisioned on Railway. Production migrations run forward-only via `npx prisma migrate deploy` in the pre-deploy phase.
2. **API Service:** Express application built and started via Nixpacks (`npm run build` -> `npm start`). Verified by automated healthchecks on `/api/v1/health`.
3. **Consumer App:** Built and deployed on Vercel from `/consumer`, pointing `VITE_API_URL` to `https://ecommerce-api-production-3c59.up.railway.app`. See [Consumer Deployment (Vercel)](DEPLOY.md#consumer-deployment-vercel) for the full runbook.

### Deployed Instances

| Component | Platform | URL | Verified |
| :--- | :--- | :--- | :--- |
| API | Railway | `https://ecommerce-api-production-3c59.up.railway.app` | `GET /api/v1/health` -> `200 {"data":{"status":"ok"}}`; `Server: railway-hikari` |
| Consumer | Vercel | `https://ecommerce-api-eight-gamma.vercel.app/` | `200`, `Server: Vercel`, serves the app's `index.html` |

The deployed consumer is the **same code** as this repository: its built assets are byte-identical to a local `npm run build` of `consumer/` at this commit.

| Asset | SHA-256 (deployed = local build) |
| :--- | :--- |
| `assets/index-7igqbLHZ.js` | `2691707183C3EF22C703EEEEBB0FE84206B6582A3BEDF43261AAFF62FB764468` |
| `assets/index-BFtSHkXy.css` | `62576107B5F3913A74AD8BE1A7BBDE82AF2D49640E38A7E86F00274AD299265C` |
| `favicon.svg` | `6E667EAE8F523F6ABCA0498A95EB8DB0557CCAB4ECA98D4CE719CF3A6E20CDA2` |

Because Vite inlines `VITE_API_URL` into the bundle, an identical content hash proves the deployment was built from this source **and** targets the live API origin. The deployed bundle contains exactly one API URL (`https://ecommerce-api-production-3c59.up.railway.app`) and **no** `localhost` / `127.0.0.1` reference.

### CORS Behaviour

The API mounts the `cors` package with a **function** for `origin` (`src/app.ts`), so every request is decided by that callback, in this order:

1. **No `Origin` header** → allowed. This covers `curl`, server-to-server calls and native clients.
2. **`CORS_ORIGIN` list** → allowed. The variable is split on commas, trimmed, and empty entries dropped; the match is **exact string equality** against the request's `Origin` header.
3. **Vercel deployments** → allowed. `isAllowedVercelOrigin()` parses the origin and allows it when the **hostname ends with `.vercel.app`**. That matches any subdomain (`https://my-app.vercel.app`) over either scheme, but **not** the apex `vercel.app`, which has no leading dot.
4. **Local development origins** → allowed **only when `NODE_ENV !== 'production'`**. The regex `^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$` matches any `http://localhost[:port]` or `http://127.0.0.1[:port]` on any port. The scheme must be `http`, so `https://localhost:5173` does **not** match and is refused.
5. **Everything else** → refused (`callback(null, false)`). The `cors` package then omits `Access-Control-Allow-Origin`, so the browser blocks the response.

Allowed methods are `GET, POST, PATCH, DELETE, OPTIONS`; allowed request headers are `Content-Type, Authorization`.

**What changes when `NODE_ENV=production`:** rule 4 is skipped entirely, so local development origins are refused. The allowed set is then only: requests without an `Origin` header, the origins listed in `CORS_ORIGIN`, and `*.vercel.app` subdomains.

> [!NOTE]
> `NODE_ENV` defaults to `development` when the variable is unset (`src/config.ts`). A deployment that omits `NODE_ENV=production` therefore keeps allowing local origins.

Live probe against the deployed API (`GET /api/v1/products?limit=1`, `Origin` header set by hand):

| `Origin` | `Access-Control-Allow-Origin` | Verdict |
| :--- | :--- | :--- |
| `http://localhost:5173` | `http://localhost:5173` | allowed (rule 4) |
| `http://localhost:9999` | `http://localhost:9999` | allowed (rule 4) |
| `http://127.0.0.1:5173` | `http://127.0.0.1:5173` | allowed (rule 4) |
| `https://localhost:5173` | *(none)* | refused — rule 4 is `http:` only |
| `https://my-app.vercel.app` | `https://my-app.vercel.app` | allowed (rule 3) |
| `https://consumer-ecommerce-api.vercel.app` | `https://consumer-ecommerce-api.vercel.app` | allowed (rule 3) |
| `https://evil.vercel.app` | `https://evil.vercel.app` | allowed (rule 3) — any `*.vercel.app` subdomain |
| `https://vercel.app` | *(none)* | refused — the apex has no leading dot |
| `https://example.com` | *(none)* | refused (rule 5) |
| `http://example.com` | *(none)* | refused (rule 5) |

Allowed responses carry `Vary: Origin, accept-encoding`; refused responses carry no `Access-Control-Allow-Origin`.

> [!NOTE]
> This table was captured against the deployment as it was running at the time. The three local-origin rows (`http://localhost:5173`, `http://localhost:9999`, `http://127.0.0.1:5173`) are **rule 4**, and rule 4 is the **only** rule that depends on `NODE_ENV`. They read "allowed" while the deployment runs with `NODE_ENV !== 'production'` and flip to "refused" once `NODE_ENV=production` is actually in effect — re-run the probe after changing that variable to refresh them.

To check whether `NODE_ENV=production` is in effect, use a local origin, which is the only probe that distinguishes the two modes:

```bash
curl -i -H "Origin: http://localhost:5173" "https://ecommerce-api-production-3c59.up.railway.app/api/v1/products?limit=1"
# NODE_ENV != 'production' (rule 4 active):  Access-Control-Allow-Origin: http://localhost:5173
# NODE_ENV == 'production'  (rule 4 skipped): no Access-Control-Allow-Origin header
```

An origin such as `https://example.com` is refused by rule 5 in **both** modes, so it returns no `Access-Control-Allow-Origin` either way and cannot confirm that the variable was applied.

---

## Design Decisions

Each decision below lists the rationale alongside the alternative considered.

1. **Normalized Five-Resource Schema:** `Category`, `Product`, `Customer`, `Order`, `OrderItem`. Normalized tables model distinct domain lifecycles, enforce referential integrity (`RESTRICT` on products/customers; `CASCADE` on order items), and allow database indexing on query filters (`categoryId`, `priceMinor`, `status`). *Alternative considered:* A denormalized document structure storing order items in a JSON column on `Order`. Rejected because relational tables guarantee referential integrity and enable performant SQL aggregations.
2. **UUID Primary Keys:** Uses UUID v4 (`@id @default(uuid()) @db.Uuid`) across all entities. UUIDs prevent resource enumeration attacks and leak no volume or creation order. *Alternative considered:* Sequential autoincrement integers (`Int @id @default(autoincrement())`). Rejected because sequential integers expose business transaction volumes and facilitate ID-scraping attacks.
3. **Money Stored as Integer Kobo:** Prices and unit prices are stored in minor units (`priceMinor`, `unitPriceMinor` in kobo) with a `currency` column (`"NGN"`). Whole integer arithmetic eliminates IEEE-754 floating-point rounding errors. *Alternative considered:* Decimal columns or floating-point numbers. Floats introduce precision loss; Decimal types introduce conversion overhead across runtime layers.
4. **Computed Order Totals:** Order totals are evaluated on read via `SUM(quantity::bigint * unitPriceMinor)` and never stored on `Order`. Casting `quantity` to `bigint` prevents integer overflow on 32-bit integers before summation. *Alternative considered:* Storing a cached `totalMinor` column on `Order`. Rejected because cached totals risk data drift when items are written or modified.
5. **Database-Level CHECK Constraints:** Constraints (`chk_order_status`, `chk_product_price`, `chk_product_stock`, `chk_order_item_quantity`, `chk_order_item_unit_price`) are enforced by PostgreSQL. Guarantees data integrity at the database boundary regardless of client or script access. *Alternative considered:* Application-only Zod validation or Prisma enums. Application checks fail if data is written through external scripts; Prisma enums require migrations to add values and lack text portability.
6. **Dual Pagination on `/products`:** `/products` supports both offset and cursor pagination; smaller resources use offset only. Cursor pagination provides fast, drift-free forward scrolling under active inventory updates. *Alternative considered:* Cursor-only everywhere or offset-only everywhere. Offset-only degrades at depth on large collections; cursor-only eliminates direct page jumps on small collections where offset is lightweight.
7. **Uniform Success and Error Envelopes:** Collections return `{ data, meta }`; single items and `/health` return `{ data }`. All errors return `{ error: { code, message } }`. Guarantees predictable client consumption and strong typing. *Alternative considered:* Bare root arrays (`[...]`) and unstructured errors. Bare arrays prevent returning pagination metadata; unstructured errors complicate frontend error handling.
8. **Semantic 422 for Missing Referenced Entities:** If an order write payload references a nonexistent `customerId` or `productId`, the API responds with `422 UNPROCESSABLE_ENTITY` naming the field, rather than `404 NOT_FOUND`. `404` is reserved strictly for non-existent endpoint URLs and missing `:id` path parameters. *Alternative considered:* Returning `404 NOT_FOUND` for missing foreign references. Rejected because the target collection URL `/api/v1/orders` exists; blaming `404` falsely indicates that the route or endpoint was not found.
9. **Rate Limiting Above Body Parser:** The rate limit of 100 requests per 60 seconds is mounted above `express.json()`. Oversized payloads (`413`) and malformed JSON floods (`400`) are metered against the caller's quota before body parsing occurs. *Alternative considered:* Mounting the limiter below body parsing, or using per-route limits. Mounting below body parser permits DDoS vectors via malformed/oversized payload flooding; complex tiering is unnecessary for an unauthenticated public API.
10. **Unauthenticated Write Endpoints:** `POST`, `PATCH`, and `DELETE` on orders require no authentication tokens by explicit project specification. Abuse is bounded by IP rate limiting, strict payload size limits (100kb), write constraints (max 50 items, max 1000 quantity), and an idempotent seed script. *Alternative considered:* API keys or JWT sessions. Rejected because authentication was excluded from the assessment brief and adds external state without requirement.

---

## Evidence

Post-deployment evidence checklist for graded assessment submission:

- [x] **Live API URL:** `https://ecommerce-api-production-3c59.up.railway.app` — verified reachable, `GET /api/v1/health` returns `200 {"data":{"status":"ok"}}`
- [x] **Deployed Consumer URL:** `https://ecommerce-api-eight-gamma.vercel.app/` — verified reachable, serves this repository's `consumer/` build
- [ ] **Paginated cURL Screenshot:** `docs/evidence/curl-pagination.png` — **not yet captured.** Terminal screenshot of a paginated JSON response. Command: `curl.exe -s -i "https://ecommerce-api-production-3c59.up.railway.app/api/v1/products?limit=2&sort=name&order=asc"` (the `meta` block shows `total`, `limit`, `offset`, `hasMore`, `nextCursor`)
- [ ] **Rate Limiting 429 Screenshot:** `docs/evidence/rate-limit-429.png` — **not yet captured.** Terminal screenshot of a `429` response with its `Retry-After` header. Capture it once the live limiter is confirmed to key on a single client-IP bucket (see [Rate Limiting](#rate-limiting)); before that the budget is split across Railway's internal hops, so a flood does not reliably produce a `429`
- [ ] **Consumer Application Screenshot:** `docs/evidence/consumer-app.png` — the file exists, but it is a **local preview** capture and must be **replaced** by a capture taken from `https://ecommerce-api-eight-gamma.vercel.app/`

  > [!WARNING]
  > The consumer screenshots below are **local preview captures** (the production build served from `localhost`), taken while verifying the app against the live API. The consumer **is** now deployed at `https://ecommerce-api-eight-gamma.vercel.app/`, so these are **to be replaced by screenshots taken from that deployed URL**.
  >
  > That replacement stops being optional once `NODE_ENV=production` is in effect. Rule 4 is skipped, so the API stops sending `Access-Control-Allow-Origin` for `http://localhost:<port>`, and a consumer served from `localhost` can no longer read the live API from a browser — the request is blocked by CORS and the app surfaces it as "Cannot reach the API". In production mode the only browser origins that can call the API are `*.vercel.app` subdomains and the exact origins listed in `CORS_ORIGIN`.

  Consumer states, each captured from the running app against the live API:

  | Screenshot | State |
  | :--- | :--- |
  | [`consumer-app.png`](docs/evidence/consumer-app.png) | Product list, first page (12 of 400) |
  | [`consumer-loading-state.png`](docs/evidence/consumer-loading-state.png) | Loading (skeletons, all controls disabled) |
  | [`consumer-empty-state.png`](docs/evidence/consumer-empty-state.png) | Empty state (max price 1 NGN) |
  | [`consumer-network-error.png`](docs/evidence/consumer-network-error.png) | Network failure — "Cannot reach the API" |
  | [`consumer-rate-limit-429.png`](docs/evidence/consumer-rate-limit-429.png) | HTTP 429 — "Too many requests, try again in a minute" |
  | [`consumer-stale-cursor-400.png`](docs/evidence/consumer-stale-cursor-400.png) | HTTP 400 stale cursor — API message, reset to page 1 |
  | [`consumer-api-error-400.png`](docs/evidence/consumer-api-error-400.png) | Other API error — `error.message` from the envelope |
  | [`consumer-config-error.png`](docs/evidence/consumer-config-error.png) | Configuration error — `VITE_API_URL=http://example.com` (not `https:`), no requests made |
- [x] **Seed Script Link:** [`prisma/seed.ts`](prisma/seed.ts) — deterministic; see [Seed Data & Determinism](#seed-data--determinism) for the row counts and the product-id checksum
- [x] **Ugly-Inputs / Edge-Case Evidence:** [`docs/evidence/ugly-inputs.md`](docs/evidence/ugly-inputs.md)

---

## Deployment URLs

The placeholders have been replaced with the real, verified deployment URLs. There are no placeholders left in this document.

| What | URL |
| :--- | :--- |
| Repository (GitHub) | `https://github.com/believefrancis101-maker/ecommerce-api` |
| API (Railway) | `https://ecommerce-api-production-3c59.up.railway.app` |
| API base path | `https://ecommerce-api-production-3c59.up.railway.app/api/v1` |
| Consumer (Vercel) | `https://ecommerce-api-eight-gamma.vercel.app/` |

The API's public hostname is also recorded in `consumer/README.md` and `consumer/.env.example`; the consumer's `VITE_API_URL` is baked into the deployed bundle at build time, so changing it requires a Vercel rebuild (see [Consumer Deployment (Vercel)](DEPLOY.md#consumer-deployment-vercel)).
