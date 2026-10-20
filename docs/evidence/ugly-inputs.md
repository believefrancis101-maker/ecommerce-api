# Stage 7 - ugly-input evidence

Live `curl.exe` output captured against `npm run dev` at http://localhost:3000/api/v1 on
2026-10-20. Sections 1, 2, 4-7 and 11 were captured at 10:15-10:17 +01:00. Section 9 was
re-captured at 10:57 +01:00 for the Stage 7b `name` / `slug` / `email` filters, and section 10
(the LIKE-wildcard fix) was captured in the same run. Sections 3 and 8 were re-captured at
11:13 +01:00 after the Stage 7c seed freeze (product ids, names and prices changed), so their
`RateLimit-*` counters start a fresh sequence.

This is a development snapshot taken against the local seeded database. The final evidence will
be re-captured against the live URL after deployment.

Notes:

- Every response below is real server output, captured with `curl.exe -s -i` (status line,
  headers, body).
- Helmet's security headers (`Content-Security-Policy`, `Strict-Transport-Security`,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-*`,
  `X-XSS-Protection`, etc.) are omitted for readability: they are identical on every response
  and unrelated to input validation. Everything else is shown verbatim, including the
  `RateLimit-*` / `Retry-After` headers.
- The dev server uses the seeded dev database (`ecommerce`); it was not modified (see the end).

---

## 1. `limit=5000` is clamped to 100

`/categories` has only 20 rows, so the body stays small while `meta.limit` proves the clamp.
The same rule applies to every list endpoint (the pagination schema is shared); the products
equivalent is asserted in `src/query-validation.test.ts`.

### limit=5000 -> 200, meta.limit=100

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/categories?limit=5000"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 99
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 2721
ETag: W/"aa1-/Zf7GFMfOFi6+Zds9u7+ktpgmU8"
Date: Tue, 20 Oct 2026 09:15:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":[{"id":"fd46d528-eb91-49f2-a8eb-bb54ccde88ca","name":"Appliances","slug":"appliances","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"91ffb84d-a2ed-4fb9-96ed-006cf296fdd7","name":"Automotive","slug":"automotive","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"1a15d0d4-1bae-4bc4-a2cc-f65c5ed6cc1e","name":"Baby & Kids","slug":"baby-kids","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"ce561907-8490-40d5-928c-391088abf85c","name":"Beauty & Personal Care","slug":"beauty-personal-care","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"54d3f0f0-e8f1-48f8-9ab7-a9e04fe79437","name":"Books & Stationery","slug":"books-stationery","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"d5482c1f-c30d-4bbc-b151-d95145bae71b","name":"Computers & Accessories","slug":"computers-accessories","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"5fb9220d-9b0f-4d32-a248-6492457c3890","name":"Electronics","slug":"electronics","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"bada9154-3f6e-4ac8-b973-b40a2ffe50e6","name":"Furniture","slug":"furniture","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"72669a05-a8da-421a-809f-96a78f6fe311","name":"Groceries","slug":"groceries","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"710fdb62-248b-4a4f-9b89-635c0100db71","name":"Health & Wellness","slug":"health-wellness","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"d8831eea-55be-4eca-912e-901a028ba3b3","name":"Home & Kitchen","slug":"home-kitchen","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"8c786010-a58e-436c-8314-2ecadc2e8ce5","name":"Men's Fashion","slug":"mens-fashion","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"22a25e7a-2302-4421-a173-58b0ca1de04c","name":"Musical Instruments","slug":"musical-instruments","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"40ddff8c-fd37-42f9-83a9-51a8c8d88e62","name":"Pet Supplies","slug":"pet-supplies","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"21ffc41a-7170-4e4a-9488-2fcfe9e13056","name":"Phones & Tablets","slug":"phones-tablets","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"3ac3b5aa-81d5-4209-aa08-3a2b6e251ee4","name":"Shoes & Bags","slug":"shoes-bags","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"1b1db11f-55df-4fc6-b1c8-6e1707011ab9","name":"Sports & Outdoors","slug":"sports-outdoors","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"c9b32059-66e5-48c6-89df-2e747f75a312","name":"Tools & Industrial","slug":"tools-industrial","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"d5e60e15-ff9a-4745-8acc-c17087e512c9","name":"Toys & Games","slug":"toys-games","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"36dd0863-15f5-48b5-bff4-74409804e327","name":"Women's Fashion","slug":"womens-fashion","createdAt":"2026-01-01T00:00:00.000Z"}],"meta":{"total":20,"limit":100,"offset":0,"hasMore":false}}
```

## 2. A non-positive or empty `limit` is rejected (400)

### limit=0 -> 400 BAD_QUERY_PARAMS

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?limit=0"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 98
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 89
ETag: W/"59-YXqSFZjHau+Qu87LaAh2p0TFu6I"
Date: Tue, 20 Oct 2026 09:15:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"limit: limit must be a positive integer"}}
```

### limit=-5 -> 400 BAD_QUERY_PARAMS

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?limit=-5"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 97
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 89
ETag: W/"59-YXqSFZjHau+Qu87LaAh2p0TFu6I"
Date: Tue, 20 Oct 2026 09:15:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"limit: limit must be a positive integer"}}
```

### limit=abc -> 400 BAD_QUERY_PARAMS

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?limit=abc"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 96
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 89
ETag: W/"59-YXqSFZjHau+Qu87LaAh2p0TFu6I"
Date: Tue, 20 Oct 2026 09:15:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"limit: limit must be a positive integer"}}
```

### limit= (empty) -> 400 BAD_QUERY_PARAMS

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?limit="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 89
ETag: W/"59-YXqSFZjHau+Qu87LaAh2p0TFu6I"
Date: Tue, 20 Oct 2026 09:15:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"limit: limit must be a positive integer"}}
```

## 3. `offset` must be a non-negative integer; `offset=0` is valid

### offset=-1 -> 400 with a clear message

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?offset=-1"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 99
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 95
ETag: W/"5f-3BIJHtZIV2FFrzUPde9vtarWksg"
Date: Tue, 20 Oct 2026 10:13:49 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"offset: offset must be a non-negative integer"}}
```

### offset=abc -> 400 with a clear message

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?offset=abc"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 98
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 95
ETag: W/"5f-3BIJHtZIV2FFrzUPde9vtarWksg"
Date: Tue, 20 Oct 2026 10:13:49 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"offset: offset must be a non-negative integer"}}
```

### offset=0 (with limit=5) -> 200, valid

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?limit=5&offset=0"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 97
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 1707
ETag: W/"6ab-RYMeC/IJDJnSRz8Pka+LK/bl8WI"
Date: Tue, 20 Oct 2026 10:13:49 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":[{"id":"6dc892dc-a7fe-4a59-8964-6964c815ec5f","name":"Everyday Granulated Sugar - 500g","description":"Durable granulated sugar for daily needs.","priceMinor":145400,"currency":"NGN","stock":77,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"72669a05-a8da-421a-809f-96a78f6fe311","name":"Groceries","slug":"groceries"}},{"id":"6a4609c6-6132-478f-9198-8d30a5044926","name":"Everyday Conditioner - 250ml","description":"Everyday conditioner that does the job.","priceMinor":165600,"currency":"NGN","stock":293,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"ce561907-8490-40d5-928c-391088abf85c","name":"Beauty & Personal Care","slug":"beauty-personal-care"}},{"id":"237bf788-8800-411b-b3ee-ff482ced6c10","name":"Essential Tomato Paste","description":"Everyday tomato paste that does the job.","priceMinor":206900,"currency":"NGN","stock":299,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"72669a05-a8da-421a-809f-96a78f6fe311","name":"Groceries","slug":"groceries"}},{"id":"c2da32ae-b594-4fb9-a695-06ea1e434987","name":"Classic Cat Litter","description":"Quality cat litter at a fair price.","priceMinor":246200,"currency":"NGN","stock":236,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"40ddff8c-fd37-42f9-83a9-51a8c8d88e62","name":"Pet Supplies","slug":"pet-supplies"}},{"id":"4231f47e-a9bd-4eae-b84e-8e06f3ffe9ad","name":"Essential Notebook","description":"This notebook offers good value for money.","priceMinor":259400,"currency":"NGN","stock":295,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"54d3f0f0-e8f1-48f8-9ab7-a9e04fe79437","name":"Books & Stationery","slug":"books-stationery"}}],"meta":{"total":400,"limit":5,"offset":0,"hasMore":true}}
```

## 4. Unknown `sort` and invalid `order` are rejected (400)

### sort=bogus -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?sort=bogus"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 91
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 99
ETag: W/"63-mmG+cAgK6km4q3ch1PDnPaDgXMg"
Date: Tue, 20 Oct 2026 09:15:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"sort: sort must be one of: price, name, createdAt"}}
```

### order=sideways -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?order=sideways"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 90
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 121
ETag: W/"79-mEBT/IaD8mI1+/E7PvtfTs2whHc"
Date: Tue, 20 Oct 2026 09:15:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"order: Invalid enum value. Expected 'asc' | 'desc', received 'sideways'"}}
```

## 5. A malformed id returns 404, never 500

### GET /products/abc -> 404 NOT_FOUND

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products/abc"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 404 Not Found
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 89
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 86
ETag: W/"56-GEhB/tot2hzv7qcf9TeA4Ux7h7c"
Date: Tue, 20 Oct 2026 09:15:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"NOT_FOUND","message":"Resource not found: id must be a valid UUID"}}
```

## 6. POST with a missing required field returns 422 naming the field

Body sent (with `customerId` deliberately absent):

```json
{"items":[{"productId":"00000000-0000-4000-8000-000000000000","quantity":1}]}
```

The JSON is passed with `--data "@missing-customer.json"` rather than inline: PowerShell's native-command
argument handling strips the inner double quotes and would send malformed JSON (`400 INVALID_JSON`), which
is a shell artefact rather than API behaviour.

### POST without customerId -> 422 naming customerId

Command:
```console
curl.exe -i -X POST -H "Content-Type: application/json" --data "@missing-customer.json" "http://localhost:3000/api/v1/orders"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 422 Unprocessable Entity
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 99
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 74
ETag: W/"4a-9zsbUFS0zuQIBN5VqpxVG6teClE"
Date: Tue, 20 Oct 2026 09:17:40 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"UNPROCESSABLE_ENTITY","message":"customerId: Required"}}
```

## 7. `minPrice` greater than `maxPrice` returns 400

### minPrice=200&maxPrice=100 -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?minPrice=200&maxPrice=100"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 87
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 110
ETag: W/"6e-2GqThXj1q7EZ66iUO0MbOvC+8G8"
Date: Tue, 20 Oct 2026 09:15:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"maxPrice: maxPrice must be greater than or equal to minPrice"}}
```

## 8. A zero-valued numeric filter is applied, not dropped

`maxPrice=0` matching nothing (rather than falling back to all 400 products) proves the value
is used as a real bound.

### minPrice=0 -> 200 (a real >= 0 bound)

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?minPrice=0&limit=5"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 96
RateLimit-Reset: 59
Content-Type: application/json; charset=utf-8
Content-Length: 1707
ETag: W/"6ab-RYMeC/IJDJnSRz8Pka+LK/bl8WI"
Date: Tue, 20 Oct 2026 10:13:50 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":[{"id":"6dc892dc-a7fe-4a59-8964-6964c815ec5f","name":"Everyday Granulated Sugar - 500g","description":"Durable granulated sugar for daily needs.","priceMinor":145400,"currency":"NGN","stock":77,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"72669a05-a8da-421a-809f-96a78f6fe311","name":"Groceries","slug":"groceries"}},{"id":"6a4609c6-6132-478f-9198-8d30a5044926","name":"Everyday Conditioner - 250ml","description":"Everyday conditioner that does the job.","priceMinor":165600,"currency":"NGN","stock":293,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"ce561907-8490-40d5-928c-391088abf85c","name":"Beauty & Personal Care","slug":"beauty-personal-care"}},{"id":"237bf788-8800-411b-b3ee-ff482ced6c10","name":"Essential Tomato Paste","description":"Everyday tomato paste that does the job.","priceMinor":206900,"currency":"NGN","stock":299,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"72669a05-a8da-421a-809f-96a78f6fe311","name":"Groceries","slug":"groceries"}},{"id":"c2da32ae-b594-4fb9-a695-06ea1e434987","name":"Classic Cat Litter","description":"Quality cat litter at a fair price.","priceMinor":246200,"currency":"NGN","stock":236,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"40ddff8c-fd37-42f9-83a9-51a8c8d88e62","name":"Pet Supplies","slug":"pet-supplies"}},{"id":"4231f47e-a9bd-4eae-b84e-8e06f3ffe9ad","name":"Essential Notebook","description":"This notebook offers good value for money.","priceMinor":259400,"currency":"NGN","stock":295,"createdAt":"2026-01-01T00:00:00.000Z","category":{"id":"54d3f0f0-e8f1-48f8-9ab7-a9e04fe79437","name":"Books & Stationery","slug":"books-stationery"}}],"meta":{"total":400,"limit":5,"offset":0,"hasMore":true}}
```

### maxPrice=0 -> 200 with 0 results (a real <= 0 bound)

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?maxPrice=0"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 59
Content-Type: application/json; charset=utf-8
Content-Length: 68
ETag: W/"44-QERZ5AoXw2TcBFLEAc+s2N2PfRw"
Date: Tue, 20 Oct 2026 10:13:50 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":[],"meta":{"total":0,"limit":20,"offset":0,"hasMore":false}}
```

## 9. An empty filter value is rejected, not silently ignored

### name= (categories) -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/categories?name="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 99
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 87
ETag: W/"57-rKAJLW993SgwQA4JEKGxFrEL6ME"
Date: Tue, 20 Oct 2026 09:57:02 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"name: name must be a non-empty string"}}
```

### slug= (categories) -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/categories?slug="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 98
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 87
ETag: W/"57-3+gjjlX48Z0kk0NnsaE0Wn4bMxY"
Date: Tue, 20 Oct 2026 09:57:02 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"slug: slug must be a non-empty string"}}
```

### name= (customers) -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/customers?name="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 97
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 87
ETag: W/"57-rKAJLW993SgwQA4JEKGxFrEL6ME"
Date: Tue, 20 Oct 2026 09:57:02 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"name: name must be a non-empty string"}}
```

### email= (customers) -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/customers?email="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 96
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 89
ETag: W/"59-O6EI5bkyl/jsqJ3YwSpFRS+P86c"
Date: Tue, 20 Oct 2026 09:57:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"email: email must be a non-empty string"}}
```

### category= (products) -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?category="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 83
ETag: W/"53-t2DiGxTWRf3ySYMoL9ck/v90k2I"
Date: Tue, 20 Oct 2026 09:57:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"category: category must be a slug"}}
```

### minPrice= (products) -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?minPrice="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 94
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 107
ETag: W/"6b-dZZBrwbqdji65Lk0FJbAPyfC96g"
Date: Tue, 20 Oct 2026 09:57:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"minPrice: minPrice must be a non-negative integer in kobo"}}
```

### inStock= (products) -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/products?inStock="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 93
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 129
ETag: W/"81-EPDK85y9hyn2tPZOVEDCtXuFKng"
Date: Tue, 20 Oct 2026 09:57:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"inStock: Invalid enum value. Expected 'true' | 'false' | '1' | '0', received ''"}}
```

### status= (orders) -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/orders?status="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 92
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 144
ETag: W/"90-wN/OxAzFxoHs+/UuHS7KW8llEQ8"
Date: Tue, 20 Oct 2026 09:57:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"status: Invalid enum value. Expected 'pending' | 'paid' | 'shipped' | 'cancelled', received ''"}}
```

### customerId= (orders) -> 400

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/orders?customerId="
```

Response (helmet security headers omitted):
```http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 91
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 93
ETag: W/"5d-n218v6ushb9tz5ytVRdGDfbVHyQ"
Date: Tue, 20 Oct 2026 09:57:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"BAD_QUERY_PARAMS","message":"customerId: customerId must be a valid UUID"}}
```

## 10. LIKE wildcards in text filters are matched literally

Prisma's `contains` compiles to SQL `ILIKE '%value%'` and does not escape the user's LIKE
metacharacters, so an unescaped `%` matched every row and `_` matched any single character.
`escapeLikePattern` in `src/middleware/validation.ts` escapes `\`, `%` and `_`; the filters now
match those characters literally, so both of the probes below return 0 rows (no category name or
customer name contains them).

### name=%25 (categories, a literal `%`) -> 200, 0 rows

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/categories?name=%25"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 90
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 68
ETag: W/"44-QERZ5AoXw2TcBFLEAc+s2N2PfRw"
Date: Tue, 20 Oct 2026 09:57:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":[],"meta":{"total":0,"limit":20,"offset":0,"hasMore":false}}
```

### name=_ (customers, a literal `_`) -> 200, 0 rows

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/customers?name=_"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 89
RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 68
ETag: W/"44-QERZ5AoXw2TcBFLEAc+s2N2PfRw"
Date: Tue, 20 Oct 2026 09:57:03 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":[],"meta":{"total":0,"limit":20,"offset":0,"hasMore":false}}
```

## 11. Exceeding the rate limit returns 429 with `Retry-After`

The limiter allows 100 requests / 60s per IP. After letting the window reset, 105 requests
were sent to `/api/v1/health` in a loop:

```console
for ($i = 0; $i -lt 105; $i++) { curl.exe -s -o NUL -w "%{http_code}`n" "http://localhost:3000/api/v1/health" }
```

Counts over 105 requests: `200` x 100, `429` x 5, other x 0.

One more request, captured in full (this is the 429):

### GET /health once the limit is reached -> 429

Command:
```console
curl.exe -i "http://localhost:3000/api/v1/health"
```

Response (helmet security headers omitted):
```http
HTTP/1.1 429 Too Many Requests
Access-Control-Allow-Origin: *
RateLimit-Policy: 100;w=60
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 58
Retry-After: 60
Content-Type: application/json; charset=utf-8
Content-Length: 92
ETag: W/"5c-QxE7+AF1bKMLR17WreMpt/KS5/U"
Date: Tue, 20 Oct 2026 09:16:20 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"TOO_MANY_REQUESTS","message":"Too many requests, please try again later"}}
```

Waited 60s afterwards so the limiter reset (confirmed by the doc being written after the wait).

---

## Dev database unchanged

Query run against the dev database (`ecommerce`) after all of the above:

```console
SELECT (SELECT count(*) FROM "Product") AS products,
       (SELECT count(*) FROM "Order")   AS orders,
       (SELECT count(*) FROM "OrderItem") AS order_items;
```

```
 products | orders | order_items
----------+--------+-------------
      400 |    500 |        1513
```

