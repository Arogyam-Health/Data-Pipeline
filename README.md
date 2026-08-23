# Data Pipeline Server

Next.js + Supabase pipeline for **Shiprocket** (webhook push) and **Shopify** (API pull). Dashboards are Next.js + Recharts. The existing Google Apps Script → Google Sheet flow stays live and is not replaced.

---

## 1. What this repo does

1. Ingests Shiprocket webhooks, queues them, and writes `data_pipeline.shiprocket_orders`.
2. Optionally forwards delivered Shiprocket orders to Pabbly (WhatsApp).
3. Pulls Shopify orders via GraphQL Admin API into `data_pipeline.shopify_*`.
4. Serves `/dashboard` (Shiprocket) and `/dashboard/shopify` (Shopify).
5. Does **not** read from Google Sheets. The sheet and Supabase are two independent readers of Shopify.

---

## 2. Current status

1. Shiprocket webhook ingestion — working.
2. Pabbly delivery — working (when enabled).
3. Shiprocket Edge worker + every-minute cron — working (manual Supabase setup).
4. Shopify GraphQL sync (test / backfill / incremental / repair) — working.
5. Shopify local auto-poll while `npm run dev` is running — working (`SHOPIFY_SYNC_ENABLED=true`).
6. Shopify dashboard (Recharts, filters, sheet-style order columns) — working.
7. Raw Shopify JSON — **not stored**.
8. Tests — `npm test`.

---

## 3. Architecture

### 3.1 Shiprocket (push)

```
Shiprocket webhook
  → POST /api/webhooks/shiprocket
  → authenticate x-webhook-key
  → integration_events + pgmq shiprocket_webhooks
  → pg_cron every minute
  → Edge Function shiprocket-worker
  → data_pipeline.shiprocket_orders
  → optional Pabbly
  → /dashboard
```

### 3.2 Shopify (pull, parallel to Google Sheets)

```
Existing Shopify app "Orders to Google Sheet"
        │
   +----+----+
   │         │
   v         v
Apps Script   This repo (SHOPIFY_ACCESS_TOKEN in private .env)
   │         │
   v         v
Google Sheet  GraphQL Admin API
              → data_pipeline.shopify_*
              → analytics.shopify_*
              → /dashboard/shopify
```

Localhost scheduler:

```
npm run dev
  → instrumentation.ts
  → every SHOPIFY_SYNC_INTERVAL_MINUTES (default 15)
  → POST incremental sync (in-process)
```

Cloud scheduler (after the app has a public URL):

```
Supabase pg_cron  7,22,37,52 * * * *
  → POST <PUBLIC_APP_URL>/api/internal/shopify/sync
```

---

## 4. Local setup (point by point)

1. Install: `npm install`
2. Copy env: `cp .env.example .env`
3. Fill **placeholders only** in `.env`. Never commit `.env`.
4. Apply SQL migrations **001 → 012** in order (Supabase SQL Editor or `supabase db push`).
5. Expose schema `analytics` in Supabase → Project Settings → Data API (alongside `public` and `data_pipeline`).
6. Deploy Shiprocket worker: `supabase functions deploy shiprocket-worker`
7. Set worker secret: `supabase secrets set WORKER_SECRET=<your-secret>`
8. Create Shiprocket cron in the SQL Editor (template below). Do **not** put URLs/secrets in a migration file.
9. Run tests: `npm test`
10. Start app: `npm run dev` → `http://localhost:3000`
11. Shiprocket dashboard: `http://localhost:3000/dashboard`
12. Shopify dashboard: `http://localhost:3000/dashboard/shopify` (HTTP Basic)

---

## 5. Environment variables

Copy from `.env.example`. Never use `NEXT_PUBLIC_` for secrets. Never put these values in migrations, git, or docs.

### 5.1 Supabase / app

1. `SUPABASE_URL` — project URL
2. `SUPABASE_SECRET_KEY` — service-role key
3. `NODE_ENV` — `development` locally

### 5.2 Shiprocket / Pabbly / worker

1. `SHIPROCKET_WEBHOOK_SECRET` — `x-webhook-key` on incoming webhooks
2. `WORKER_SECRET` — Edge Function / cron auth
3. `PABBLY_SHIPROCKET_URL` — optional
4. `SHIPROCKET_PABBLY_ENABLED` — `true` / `false` (default `false`)

### 5.3 Shopify

1. `SHOPIFY_SHOP_DOMAIN` — `your-shop.myshopify.com`
2. `SHOPIFY_ACCESS_TOKEN` — existing app token (same app as Apps Script; never commit)
3. `SHOPIFY_API_VERSION` — default `2026-04`
4. `SHOPIFY_SYNC_ENABLED` — `true` to allow incremental + local scheduler
5. `SHOPIFY_SYNC_INTERVAL_MINUTES` — local poll interval (default `15`)
6. `SHOPIFY_INTERNAL_SYNC_SECRET` — Bearer secret for `/api/internal/shopify/*`
7. `SHOPIFY_BACKFILL_DAYS` — default `90` (clamped to ~60 without `read_all_orders`)
8. `SHOPIFY_TEST_FETCH_DAYS` — default `3`
9. `SHOPIFY_INCREMENTAL_BUFFER_MINUTES` — overlap window, default `10`
10. `SHOPIFY_PAGE_SIZE` — default `100` (list queries cap at 25)
11. `SHOPIFY_MAX_FETCH_RETRIES` — default `6`
12. `SHOPIFY_BACKFILL_CHUNK_DAYS` — default `3`

### 5.4 Dashboard

1. `DASHBOARD_USERNAME` — HTTP Basic user for `/dashboard/shopify` and `/api/shopify/*`
2. `DASHBOARD_PASSWORD` — HTTP Basic password

---

## 6. Database migrations (order matters)

1. `001_data_pipeline_schema.sql`
2. `002_shiprocket_orders.sql`
3. `003_shiprocket_pabbly_deliveries.sql`
4. `004_shiprocket_queue.sql`
5. `005_analytics_views.sql`
6. `006_rls_security.sql`
7. `007_cron_setup.sql` — templates only; no project URL/secret
8. `008_analytics_dashboard_views.sql` — Shiprocket analytics
9. `009_shopify_schema.sql`
10. `010_shopify_indexes_and_security.sql`
11. `011_shopify_analytics_views.sql`
12. `012_shopify_dashboard_functions.sql`

After 011–012, expose the `analytics` schema in the Data API or Shopify APIs return `Invalid schema: analytics`.

---

## 7. Shiprocket

### 7.1 Webhook

1. Endpoint: `POST /api/webhooks/shiprocket`
2. Header: `x-webhook-key: <SHIPROCKET_WEBHOOK_SECRET>`
3. Returns quickly after enqueue; the worker does the heavy work.

```bash
curl -X POST http://localhost:3000/api/webhooks/shiprocket \
  -H "Content-Type: application/json" \
  -H "x-webhook-key: <SHIPROCKET_WEBHOOK_SECRET>" \
  -d '{"order_id":199656,"status":"77","current_status":"Delivered","awb":"1234567890"}'
```

### 7.2 Cron (SQL Editor only — placeholders)

```sql
SELECT cron.schedule(
  'shiprocket-worker-trigger',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := '<YOUR_SUPABASE_URL>/functions/v1/shiprocket-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || '<YOUR_WORKER_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### 7.3 Retries and dead letters

1. Backoff: 15s → 30s → 60s → 120s → … cap 15 min.
2. After ~10 failures the event is `dead_letter`.
3. Inspect: `SELECT * FROM data_pipeline.integration_events WHERE status = 'dead_letter';`

### 7.4 Pabbly

1. Enabled only if `SHIPROCKET_PABBLY_ENABLED=true` and `PABBLY_SHIPROCKET_URL` is set.
2. Orders whose id contains `TEST` are skipped so WhatsApp is not sent.
3. Table: `data_pipeline.shiprocket_pabbly_deliveries`.

---

## 8. Shopify

### 8.1 Rules

1. Reuse the existing **Orders to Google Sheet** app. Do not create a second Shopify app.
2. Copy the existing access token into `.env` only. Do not change OAuth, scopes, Apps Script, or the sheet.
3. Shopify does **not** use the Shiprocket PGMQ queue.
4. Incremental sync refuses unless `SHOPIFY_SYNC_ENABLED=true` and a watermark exists.
5. Raw Shopify JSON is never stored.

### 8.2 Scopes (already on the existing app)

1. Required: `read_orders`, `read_customers`, `read_fulfillments`, plus assigned / merchant / third-party fulfillment reads.
2. Optional: `read_all_orders` (do not add automatically). Without it, history is ~60 days.
3. Do not add `read_products` or `read_locations` on this shared app.

### 8.3 Sync modes

1. **Test** — last 3 days. `POST /api/internal/shopify/sync/test`
2. **Backfill** — chunked history. `POST /api/internal/shopify/sync/backfill` and `/backfill/resume`
3. **Incremental** — watermark − 10 minutes → now, by Shopify `updated_at`. `POST /api/internal/shopify/sync`
4. **Repair** — explicit `from`/`to`. Does **not** move the watermark. `POST /api/internal/shopify/sync/repair`
5. **Status** — `GET /api/internal/shopify/sync/status`

All internal routes need:

```
Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>
```

### 8.4 How catch-up works if the laptop is off

1. Orders stay in Shopify. Nothing is lost.
2. On next `npm run dev`, the scheduler waits ~15 seconds, then incremental-syncs from `last_successful_sync_at − 10 minutes` to now.
3. Gap of a night or a few days is fine.
4. Without `read_all_orders`, gaps longer than ~60 days can miss older orders.

### 8.5 Local auto-sync vs cloud cron

1. **Localhost:** Supabase cron cannot reach `http://localhost:3000`. The Next.js process polls itself when `SHOPIFY_SYNC_ENABLED=true`.
2. Stop `npm run dev` → polling stops. Start it again → catch-up runs automatically.
3. **Deployed public URL:** create the offset cron below in the SQL Editor. Never put the filled URL/secret in a migration or git.

```sql
SELECT cron.schedule(
  'shopify-incremental-sync',
  '7,22,37,52 * * * *',
  $$
  SELECT net.http_post(
    url := '<DATA_PIPELINE_APP_URL>/api/internal/shopify/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Offset (`:07/:22/:37/:52`) avoids colliding with Apps Script (`:00/:15/:30/:45`).

### 8.6 Where to look in Supabase

1. Table Editor schema: **`data_pipeline`**, not `public`.
2. Orders: `data_pipeline.shopify_orders`
3. Sort by **`created_at_shopify`**, not row `created_at`.
4. Sync watermark: `data_pipeline.shopify_sync_state.last_successful_sync_at`
5. Run log: `data_pipeline.shopify_sync_runs` (a run dated the 21st is a log row, not “latest order”).

### 8.7 Sheet columns vs this pipeline

| Sheet column | Stored / shown |
|---|---|
| Order Number | Yes |
| Created At | Yes (dashboard in IST) |
| Customer Name | Yes (full name on the dashboard) |
| Total Price | Yes |
| Phone (Shipping Address) | Yes |
| Email | Yes |
| Financial Status | Yes (`PAID`, `PENDING`, `VOIDED`, …) |
| Fulfillment Status | Yes (`FULFILLED`, `UNFULFILLED`, …) |
| Line Items | Yes (`name × qty`) |
| Currency | Yes |
| Id | Yes (`legacyResourceId` as text) |
| Zip (Shipping Address) | Yes |
| Phone | Yes |
| City (Billing Address) | Yes |
| Cancelled At | Yes |
| Cancel Reason | Order cancel reason. “Customer > Last Order” cancel reason is not in GraphQL |
| Staff Note (Cancellation) | Yes when Shopify sends it |
| Transactions count | Yes |
| Number Of Orders (Customer) | Yes |
| Discount Code | Yes when present |
| Total Discounts | Yes |
| Discount Code (Customer > Last Order) | Not available in GraphQL — shown as `—` |
| Raw Shopify JSON | **Excluded on purpose** |

---

## 9. Dashboards

### 9.1 Home

1. `http://localhost:3000` — links to both dashboards.

### 9.2 Shiprocket

1. URL: `/dashboard`
2. Reads Shiprocket analytics / last orders.
3. Not locked by the Shopify Basic auth.

### 9.3 Shopify

1. URL: `/dashboard/shopify`
2. Auth: HTTP Basic (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`).
3. Reads Supabase only. Never calls Shopify GraphQL from the browser.
4. Charts: KPIs, daily sales, financial / fulfillment, products, UTM, discounts, geo, cancellations, sync health.
5. Orders table is sheet-style and wide; **Order Number** and **Customer Name** stay pinned on the left.
6. Date presets: `7d`, `30d`, `90d`, custom.
7. Filters (values that exist in this store):
   - Search — order #, customer name, city
   - Financial — PAID, PENDING, VOIDED
   - Fulfillment — FULFILLED, UNFULFILLED
   - Payment — COD, PREPAID, UNKNOWN
   - Cancelled — cancelled / not cancelled
   - Cancel reason — CUSTOMER, OTHER
8. Product revenue = line price × qty − line discount. Never `SUM(order.total_price)` on line rows.
9. Payment mapping: COD if gateway looks like cash/COD; PREPAID if Shopify Payments / Razorpay / PayU / PhonePe / UPI / card / wallet / GoKwik / etc.

---

## 10. Security (must follow)

1. Never commit `.env`, tokens, passwords, or filled cron SQL.
2. Never put project URLs or secrets in `supabase/migrations/*`.
3. Never prefix secrets with `NEXT_PUBLIC_`.
4. `.gitignore` ignores `.env`, `.env.*` (except `.env.example`), `credentials.json`, and service-account JSON.
5. Shopify token is not written to PostgreSQL and is not returned by APIs.
6. Internal sync routes require Bearer `<SHOPIFY_INTERNAL_SYNC_SECRET>`.
7. Shopify dashboard / `/api/shopify/*` require HTTP Basic.
8. Logs must not include tokens, GraphQL bodies, or raw PII dumps.

---

## 11. Useful commands

```bash
npm install
npm test
npm run dev
npm run lint
npm run typecheck

# Shopify (replace the Bearer placeholder)
curl -X POST http://localhost:3000/api/internal/shopify/sync/test \
  -H "Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>"

curl http://localhost:3000/api/internal/shopify/sync/status \
  -H "Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>"

curl -X POST http://localhost:3000/api/internal/shopify/sync \
  -H "Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>"
```

---

## 12. Troubleshooting

1. Sheet has today’s orders, dashboard does not — Apps Script is running; this app was not. Start `npm run dev` with `SHOPIFY_SYNC_ENABLED=true` and a watermark, or run incremental/repair.
2. Incremental `409 SYNC_DISABLED` — set `SHOPIFY_SYNC_ENABLED=true` and restart Next.js.
3. Incremental `WATERMARK_MISSING` — run test or complete backfill first.
4. `Invalid schema: analytics` — expose `analytics` in Supabase Data API.
5. Looking in Supabase Table Editor and seeing nothing — switch schema from `public` to `data_pipeline`.
6. Last order looks old — sort `shopify_orders.created_at_shopify`, not `shopify_sync_runs`.
7. Customer name “missing” — hard-refresh; the name column is pinned next to Order Number.
8. Filter looks empty — only statuses that exist in the store are listed (no fake REFUNDED/AUTHORIZED if Shopify never sent them).
9. Local cron from Supabase does nothing — expected. Use the in-app scheduler or a public URL.

---

## 13. Production cutover (do not skip approval)

1. Keep Apps Script + Growth MIS sheet running.
2. Run this pipeline in parallel.
3. Compare sheet vs `data_pipeline.shopify_orders` (see `SHOPIFY_VALIDATION.md`).
4. Do not switch production traffic until explicitly approved.
5. After a public deploy, add the Shopify pg_cron job with placeholders filled **only** in the SQL Editor.

---

## 14. How to add another integration

1. Module under `src/modules/<provider>/`
2. Isolated tables in `data_pipeline`
3. Webhook **or** pull sync — do not reuse Shopify incremental for webhook providers
4. Analytics views in `analytics`
5. Own cron / worker — do not break Shiprocket `* * * * *` or Shopify offset cron

---

## 15. Extra docs

1. [`SHOPIFY_SETUP.md`](./SHOPIFY_SETUP.md) — Shopify scopes, sync modes, cron, security.
2. [`SHOPIFY_VALIDATION.md`](./SHOPIFY_VALIDATION.md) — sheet vs Supabase checks.
3. [`METABASE_SETUP.md`](./METABASE_SETUP.md) — Shiprocket Metabase only. Shopify uses `/dashboard/shopify`, not Metabase.
4. [`.env.example`](./.env.example) — empty placeholders.
