# Data Pipeline Server

Next.js + Supabase pipeline for **Shiprocket** (webhook push), **Shopify** (API pull), **Meta Ads** (Marketing API pull), and **GA4** (Analytics Data API pull via Vercel OIDC + Google WIF). Dashboards are Next.js + Recharts. Existing Google Apps Script → Google Sheet flows stay live and are not replaced.

---

## 1. What this repo does

1. Ingests Shiprocket webhooks, queues them, and writes `data_pipeline.shiprocket_orders`.
2. Optionally forwards delivered Shiprocket orders to Pabbly (WhatsApp).
3. Pulls Shopify orders via GraphQL Admin API into `data_pipeline.shopify_*`.
4. Pulls Meta Ads Insights via Marketing API into `data_pipeline.meta_*` using the same existing token/account as Apps Script.
5. Pulls GA4 Daily / Channel / UTM reports into `data_pipeline.ga4_*` using Vercel OIDC + Google Workload Identity Federation. No Google private key.
6. Serves `/dashboard` (Shiprocket analytics), `/dashboard/shiprocket` (explorer), `/dashboard/shopify` (Shopify), `/dashboard/meta` (Meta), and `/dashboard/ga4` (GA4).
7. Does **not** read from Google Sheets. Sheets and Supabase are independent readers.

---

## 2. Current status

1. Shiprocket webhook ingestion — working.
2. Pabbly delivery — working (when enabled).
3. Shiprocket Edge worker + every-minute cron — working (manual Supabase setup).
4. Shopify GraphQL sync (test / backfill / incremental / repair) — working.
5. Shopify local auto-poll while `npm run dev` is running — working (`SHOPIFY_SYNC_ENABLED=true`).
6. Shopify dashboard (Recharts, filters, sheet-style order columns) — working.
7. Meta Ads sync + `/dashboard/meta` (Recharts) — added as a parallel pipeline. `META_SYNC_ENABLED=false` until a one-day test passes.
8. GA4 sync + `/dashboard/ga4` (Recharts) — added as a parallel pipeline. `GA4_SYNC_ENABLED=false` until WIF + a one-day test pass.
9. Raw Shopify/Meta/GA4 JSON — **not stored**.
10. Tests — `npm test`.

---

## 3. Architecture

### 3.1 Shiprocket (push)

```
Shiprocket webhook
  → POST /api/webhooks/delivery-events
  → authenticate x-api-key
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
Vercel Cron  7,22,37,52 * * * *
  → GET /api/internal/shopify/sync
     Authorization: Bearer $CRON_SECRET

# Hobby fallback (or extra reliability):
Supabase pg_cron  7,22,37,52 * * * *
  → POST https://<vercel-app>/api/internal/shopify/sync
```

---

## 4. Local setup (point by point)

1. Install: `npm install`
2. Copy env: `cp .env.example .env`
3. Fill **placeholders only** in `.env`. Never commit `.env`.
4. Apply SQL migrations **001 → 024** in order (Supabase SQL Editor or `supabase db push`).
5. Expose schema `analytics` in Supabase → Project Settings → Data API (alongside `public` and `data_pipeline`).
6. Deploy Shiprocket worker: `supabase functions deploy shiprocket-worker`
7. Set worker secret: `supabase secrets set WORKER_SECRET=<your-secret>`
8. Create Shiprocket cron in the SQL Editor (template below). Do **not** put URLs/secrets in a migration file.
9. Run tests: `npm test`
10. Start app: `npm run dev` → `http://localhost:3000`
11. Shiprocket analytics: `http://localhost:3000/dashboard`
12. Shiprocket explorer: `http://localhost:3000/dashboard/shiprocket` (HTTP Basic)
13. Shopify dashboard: `http://localhost:3000/dashboard/shopify` (HTTP Basic)
14. Meta dashboard: `http://localhost:3000/dashboard/meta` (HTTP Basic)
15. GA4 dashboard: `http://localhost:3000/dashboard/ga4` (HTTP Basic)

---

## 5. Environment variables

Copy from `.env.example`. Never use `NEXT_PUBLIC_` for secrets. Never put these values in migrations, git, or docs.

### 5.1 Supabase / app

1. `SUPABASE_URL` — project URL
2. `SUPABASE_SECRET_KEY` — service-role key
3. `NODE_ENV` — `development` locally

### 5.2 Shiprocket / Pabbly / worker

1. `SHIPROCKET_WEBHOOK_SECRET` — `x-api-key` on incoming webhooks (Shiprocket dashboard Auth Token)
2. `WORKER_SECRET` — Edge Function / cron auth
3. `PABBLY_SHIPROCKET_URL` — optional
4. `SHIPROCKET_PABBLY_ENABLED` — `true` / `false` (default `false`). Keep false during parallel validation.
5. `SHIPROCKET_INTERNAL_SYNC_SECRET` — optional Bearer secret for `/api/internal/shiprocket/*` (falls back to `WORKER_SECRET`)
6. `SHIPROCKET_APPS_SCRIPT_WEBHOOK_URL` — existing Apps Script Web App URL used to fan-out the raw webhook (required before switching Shiprocket's single URL)
7. `SHIPROCKET_LOG_WEBHOOK_PAYLOAD` — `true` / `false` (default `false`). When true, prints the full incoming webhook JSON to the server console.

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

### 5.4 Meta Ads

1. `META_ACCESS_TOKEN` — existing Apps Script token (never commit)
2. `META_AD_ACCOUNT_ID` — existing `act_…` account
3. `META_API_VERSION` — default `v23.0`
4. `META_SYNC_ENABLED` — `true` to allow scheduled today sync
5. `META_INTERNAL_SYNC_SECRET` — Bearer secret for `/api/internal/meta/*`
6. `META_BACKFILL_DAYS` — default `90`
7. `META_BACKFILL_CHUNK_DAYS` — default `3`
8. `META_PAGE_LIMIT` — default `500`
9. `META_MAX_RETRIES` — default `5`
10. `META_RECENT_REPAIR_DAYS` — default `2` (3 calendar dates)
11. `META_EXTENDED_INSIGHTS_ENABLED` — default `false`
12. `META_METADATA_SYNC_ENABLED` — default `false`
13. `META_BREAKDOWN_SYNC_ENABLED` — default `false`

See [`META.md`](./META.md) and [`META_SETUP.md`](./META_SETUP.md).

### 5.5 GA4

1. `GA4_PROPERTY_ID` — GA4 property ID (`123…` or `properties/123…`)
2. `GCP_PROJECT_ID` / `GCP_PROJECT_NUMBER` — WIF project identifiers (not secrets)
3. `GCP_SERVICE_ACCOUNT_EMAIL` — impersonated GA4 pipeline service account
4. `GCP_WORKLOAD_IDENTITY_POOL_ID` / `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`
5. `GA4_SYNC_ENABLED` — `true` to allow scheduled recent sync (default `false`)
6. `GA4_INTERNAL_SYNC_SECRET` — Bearer secret for `/api/internal/ga4/*`
7. Backfill / retry knobs — see [`.env.example`](./.env.example) and [`GA4_SETUP.md`](./GA4_SETUP.md)

Do **not** set `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` or `GOOGLE_SERVICE_ACCOUNT_JSON`.

### 5.6 Dashboard

1. `DASHBOARD_USERNAME` — HTTP Basic user for `/dashboard/shopify`, `/dashboard/meta`, `/dashboard/ga4`, `/dashboard/shiprocket`, `/api/shopify/*`, `/api/meta/*`, `/api/ga4/*`, `/api/shiprocket/*`
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
13. `013_meta_ads_schema.sql`
14. `014_meta_ads_indexes_security.sql`
15. `015_meta_ads_analytics.sql`
16. `016_meta_ads_dashboard_functions.sql`
17. `017_meta_ads_filters.sql` — Meta dashboard query filters
18. `018_ga4_schema.sql`
19. `019_ga4_indexes_security.sql`
20. `020_ga4_analytics.sql`
21. `021_ga4_dashboard_functions.sql`
22. `022_shiprocket_enrichment.sql` — extra webhook fields, enrichment, scans
23. `023_shiprocket_indexes_security.sql`
24. `024_shiprocket_legacy_analytics.sql` — Sheet-label view + explorer + data quality
25. `025_shiprocket_remittance.sql` — billing fields + remittance tables
26. `026_shiprocket_remittance_indexes_security.sql`
27. `027_shiprocket_order_360.sql` — one-row-per-order explorer + remittance summary

After 011–027, expose the `analytics` schema in the Data API or Shopify/Meta/GA4 APIs return `Invalid schema: analytics`.

---

## 7. Shiprocket

### 7.1 Webhook (single Shiprocket URL fan-out)

Shiprocket allows only one webhook URL. To keep Apps Script + Sheet + production Pabbly intact **and** land the same raw event in Supabase:

```
SHIPROCKET  (one URL)
    → POST /api/webhooks/delivery-events
         → forward raw body to existing Apps Script URL
         → enqueue into Supabase
```

1. Copy the **current** Apps Script Web App URL from Shiprocket (do not change it yet) into `SHIPROCKET_APPS_SCRIPT_WEBHOOK_URL`.
2. Deploy / restart this app. Keep `SHIPROCKET_PABBLY_ENABLED=false`.
3. Test fan-out with curl (below). Confirm a **test** event hits the Sheet **and** Supabase before switching.
4. Only then change Shiprocket's one webhook URL to:

   `https://<your-app>/api/webhooks/delivery-events?hook_key=<SHIPROCKET_WEBHOOK_SECRET>`

5. Do **not** edit the Apps Script, Sheet, or production Pabbly URL.

Auth accepted: `x-api-key` (Shiprocket dashboard), `Authorization: Bearer`, `x-webhook-secret`, `x-webhook-key`, or `?hook_key=`.

If the Apps Script forward fails, this route returns **502** so Shiprocket retries. Production Sheet is not silently dropped.

```bash
curl -X POST "http://localhost:3000/api/webhooks/delivery-events?hook_key=<SHIPROCKET_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"sr_order_id":"1000000001","order_id":"12345678","current_status":"Delivered","awb":"TESTAWB001"}'
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
2. **Default is false.** Apps Script remains the production Pabbly sender during parallel validation.
3. Preview without sending: `GET /api/internal/shiprocket/pabbly-preview/{srOrderId}`.
4. Table: `data_pipeline.shiprocket_pabbly_deliveries`.
5. See [`SHIPROCKET_VALIDATION.md`](./SHIPROCKET_VALIDATION.md).

### 7.5 Dashboard / enrichment / remittance

1. Canonical Shiprocket UI: `http://localhost:3000/dashboard/shiprocket` (HTTP Basic). `/dashboard` is the global hub only.
2. Shopify enrichment backfill: `POST /api/internal/shiprocket/enrichment/backfill`
3. Reconciliation is **not** invented — no Shiprocket REST URLs were added.
4. Remittance is XLS/XLSX import only. Official remittance API was not verified.
5. Import: `POST /api/internal/shiprocket/remittance/import` (Bearer) or the Data Quality upload on the dashboard.
6. One CRF/UTR can cover many AWBs. UTR is not unique per order.
7. Keep `SHIPROCKET_PABBLY_ENABLED=false` during parallel validation.

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
3. **Vercel:** `vercel.json` schedules `GET /api/internal/shopify/sync` at `:07/:22/:37/:52`. Vercel sends `Authorization: Bearer $CRON_SECRET`. Set `CRON_SECRET` to the same value as `SHOPIFY_INTERNAL_SYNC_SECRET`, and set `SHOPIFY_SYNC_ENABLED=true`. Hobby plans only allow one cron per day — use Pro, or the Supabase cron below.
4. **Supabase fallback** (any Vercel plan): create the offset cron in the SQL Editor. Never put the filled URL/secret in a migration or git.

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

### 9.3 Shopify / Meta nav

Both dashboards link to each other and to Shiprocket. Runtime behavior of Shiprocket and Shopify is unchanged.

### 9.4 Shopify

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

### 9.4 Meta Ads

1. URL: `/dashboard/meta`
2. Auth: same HTTP Basic as Shopify.
3. Reads Supabase only. Never calls the Meta Marketing API from the browser.
4. Charts: KPIs, daily spend/purchases/ROAS, funnel, campaign / ad set / ad tables, video, action explorer, sync health.
5. Date presets: today, `7d`, `30d`, `90d`, custom. Dates use the Meta ad account timezone.
6. Breakdown panels stay hidden behind “Breakdown sync not enabled” until that flag is validated.
7. Setup and Sheet comparison: [`META_SETUP.md`](./META_SETUP.md), [`META_VALIDATION.md`](./META_VALIDATION.md).

### 9.5 GA4

1. URL: `/dashboard/ga4`
2. Auth: same HTTP Basic as Shopify/Meta.
3. Reads Supabase only. Never calls the Google Analytics Data API from the browser.
4. Charts: KPIs, daily trend, funnel, channel table, UTM table, sync health.
5. Date presets: today, `7d`, `30d`, `90d`, custom. Dates use the GA4 reporting timezone.
6. Setup and Sheet comparison: [`GA4_SETUP.md`](./GA4_SETUP.md), [`GA4_VALIDATION.md`](./GA4_VALIDATION.md).
7. Apps Script + Google Sheets stay production until an explicit human cutover.

---

## 10. Security (must follow)

1. Never commit `.env`, tokens, passwords, or filled cron SQL.
2. Never put project URLs or secrets in `supabase/migrations/*`.
3. Never prefix secrets with `NEXT_PUBLIC_`.
4. `.gitignore` ignores `.env`, `.env.*` (except `.env.example`), `credentials.json`, and service-account JSON.
5. Shopify and Meta tokens, and Google access/OIDC tokens, are not written to PostgreSQL and are not returned by APIs.
6. Internal sync routes require Bearer `<SHOPIFY_INTERNAL_SYNC_SECRET>`, `<META_INTERNAL_SYNC_SECRET>`, or `<GA4_INTERNAL_SYNC_SECRET>`.
7. Shopify/Meta/GA4 dashboards and `/api/shopify/*` `/api/meta/*` `/api/ga4/*` require HTTP Basic.
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

# Meta (replace the Bearer placeholder)
curl -X POST http://localhost:3000/api/internal/meta/sync/test \
  -H "Authorization: Bearer <META_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}'

curl http://localhost:3000/api/internal/meta/sync/status \
  -H "Authorization: Bearer <META_INTERNAL_SYNC_SECRET>"

# GA4 (replace the Bearer placeholder)
curl -X POST http://localhost:3000/api/internal/ga4/connection-test \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>"

curl -X POST http://localhost:3000/api/internal/ga4/sync/test \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dataset":"daily","since":"YYYY-MM-DD","until":"YYYY-MM-DD"}'
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
5. After a public deploy, set `SHOPIFY_SYNC_ENABLED=true` and `CRON_SECRET` (same as `SHOPIFY_INTERNAL_SYNC_SECRET`) on Vercel so `vercel.json` can pull Shopify. On Hobby, use the SQL Editor pg_cron job instead — never commit the filled URL/secret.

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
3. [`META.md`](./META.md) — Meta architecture, plan, terms, strategy, and code map.
4. [`META_SETUP.md`](./META_SETUP.md) — Meta env names, sync modes, cron templates.
5. [`META_VALIDATION.md`](./META_VALIDATION.md) — Meta Report sheet vs `analytics.meta_ads_sheet_parity`.
6. [`METABASE_SETUP.md`](./METABASE_SETUP.md) — Shiprocket Metabase only. Shopify, Meta, and GA4 use Next.js + Recharts dashboards. Metabase can also read `analytics.ga4_*`.
7. [`GA4_SETUP.md`](./GA4_SETUP.md) — WIF, env names, sync modes, cron templates.
8. [`GA4_VALIDATION.md`](./GA4_VALIDATION.md) — Sheets vs `analytics.ga4_*_sheet_parity`.
9. [`.env.example`](./.env.example) — empty placeholders.
