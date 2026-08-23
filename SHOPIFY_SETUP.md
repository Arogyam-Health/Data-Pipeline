# Shopify Data Pipeline Setup

Isolated Shopify integration that runs **in parallel** with the existing Google Apps Script → Google Sheet flow. It does **not** replace that production workflow.

## 1. Architecture

```
EXISTING SHOPIFY APP
"Orders to Google Sheet"
        |
existing authorization
        |
   +----+----+
   |         |
   v         v
Apps Script   Data Pipeline
   |         SHOPIFY_ACCESS_TOKEN (private server env)
   |         |
   +----+----+
        v
Shopify GraphQL Admin API
        v
Normalized data_pipeline.shopify_*
        v
analytics.shopify_*
        v
Next.js /dashboard/shopify
(Recharts)
```

Scheduler (while Apps Script remains live, use the offset cron):

```
Supabase Cron  7,22,37,52 * * * *
      │
      ▼
POST /api/internal/shopify/sync
```

Legacy system remains untouched:

```
Existing Shopify app "Orders to Google Sheet"
      → Google Apps Script
      → Growth MIS Google Sheet
```

## 2. Why Shopify does not use the Shiprocket queue

Shiprocket is webhook-push: requests must return quickly, bursts happen, and retries must not block the sender.

This Shopify phase is **API-pull**:

1. 3-day test fetch
2. chunked historical backfill
3. 15-minute incremental polling
4. upsert
5. analytics

No PGMQ queue is created for Shopify. A webhook queue can be added later if Shopify webhooks are introduced.

The existing Shiprocket queue, worker, and `* * * * *` cron are unchanged.

## 3. Existing Shopify App Reuse

The existing Shopify app **Orders to Google Sheet** remains installed and unchanged.

The existing Google Apps Script continues using the same app.

For the Data Pipeline, the already-authorized Shopify access token is copied **manually** into the Data Pipeline server's private environment as:

```
SHOPIFY_ACCESS_TOKEN
```

The token is never committed.

This pipeline does **not** modify:

- OAuth
- scopes
- redirect URLs
- app installation
- Client ID / Client Secret
- Apps Script Properties
- the Apps Script access token

Do **not** create a second Shopify app.

If authorization fails, the pipeline **stops** and reports:

> Shopify authorization failed. Verify SHOPIFY_ACCESS_TOKEN and currently granted app scopes. Existing Google Apps Script configuration was not modified.

It does not regenerate credentials, reinstall the app, run OAuth, or change Apps Script.

## 4. Required scopes

The existing app already requests approximately:

- `read_orders`
- `read_customers`
- `read_fulfillments`
- `read_assigned_fulfillment_orders`
- `read_merchant_managed_fulfillment_orders`
- `read_third_party_fulfillment_orders`

Optional, only if Shopify has already granted it (do **not** add automatically):

- `read_all_orders`

Do **not** add `read_products` or `read_locations` to this shared app. Product/variant IDs, grams, and fulfillment/refund location IDs stay null unless those scopes are already granted.

Without `read_all_orders`, Shopify order access is typically the most recent **~60 days**. A requested 90-day backfill is clamped and a `history_warning` is stored/returned. The pipeline will not pretend 90 days were fetched.

## 5. Authentication

GraphQL requests use the existing token from private server env:

```
POST https://{SHOPIFY_SHOP_DOMAIN}/admin/api/{SHOPIFY_API_VERSION}/graphql.json
Content-Type: application/json
X-Shopify-Access-Token: <SHOPIFY_ACCESS_TOKEN>
```

The token is read at request time. It is never written to PostgreSQL, never returned from an API, never sent to the browser, and never logged.

There is no client_credentials grant, no Client ID/Secret requirement, and no token cache/refresh.

HTTP 401/403 stops the sync as a non-retryable auth error and leaves `last_successful_sync_at` unchanged.

## 6. Environment variables

Copy `.env.example` and fill placeholders. Never commit real values. Never prefix secrets with `NEXT_PUBLIC_`.

| Variable | Purpose |
|----------|---------|
| `SHOPIFY_SHOP_DOMAIN` | `your-shop.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | existing authorized token (private server env only) |
| `SHOPIFY_API_VERSION` | default `2026-04` |
| `SHOPIFY_SYNC_ENABLED` | `true` only when incremental cron should run |
| `SHOPIFY_INTERNAL_SYNC_SECRET` | Bearer secret for `/api/internal/shopify/*` |
| `SHOPIFY_BACKFILL_DAYS` | default `90` |
| `SHOPIFY_TEST_FETCH_DAYS` | default `3` |
| `SHOPIFY_INCREMENTAL_BUFFER_MINUTES` | default `10` |
| `SHOPIFY_PAGE_SIZE` | default `100` |
| `SHOPIFY_MAX_FETCH_RETRIES` | default `6` |
| `SHOPIFY_BACKFILL_CHUNK_DAYS` | default `3` |
| `DASHBOARD_USERNAME` | HTTP Basic user for `/dashboard/shopify` |
| `DASHBOARD_PASSWORD` | HTTP Basic password |

Shiprocket variables are unchanged.

## 7. Token handling

There is no generated 24-hour token and no refresh loop.

If Shopify rejects the existing token, fix `SHOPIFY_ACCESS_TOKEN` / granted scopes manually. Do not change the Shopify app or Apps Script as part of this pipeline.

## 8. Test fetch (3 days)

Does not clear tables. Upserts. Creates `shopify_sync_runs.mode = 'test'`.

```bash
curl -X POST http://localhost:3000/api/internal/shopify/sync/test \
  -H "Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>"
```

Returns counts only. Never returns raw orders.

## 9. Historical backfill

Requested target: 90 days, upsert-based, 3-day chunks, resumable.

Do **not** run this at the same time as an Apps Script backfill.

```bash
curl -X POST http://localhost:3000/api/internal/shopify/sync/backfill \
  -H "Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>"

curl -X POST http://localhost:3000/api/internal/shopify/sync/backfill/resume \
  -H "Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>"
```

If the runtime is close to timeout, progress is saved and `resumable: true` is returned.

Backfill updates `last_backfill_*` and job progress. It does **not** move the incremental watermark after every historical chunk. When the full job succeeds, `last_successful_sync_at` is set to the job `end_at` only if that timestamp is newer than the current watermark.

## 10. Incremental sync

Refuses unless `SHOPIFY_SYNC_ENABLED=true`.

On `next dev` / `next start`, the Node process also starts an in-app incremental poller (`SHOPIFY_SYNC_INTERVAL_MINUTES`, default 15) so localhost does not depend on Supabase cron reaching the machine.

Requires a watermark (`last_successful_sync_at`) from a prior test or completed backfill.

```bash
curl -X POST http://localhost:3000/api/internal/shopify/sync \
  -H "Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>"
```

Repair (never advances the incremental watermark):

```bash
curl -X POST http://localhost:3000/api/internal/shopify/sync/repair \
  -H "Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-08-01T00:00:00.000Z","to":"2026-08-02T00:00:00.000Z"}'
```

## 11. 10-minute overlap buffer

```
incrementalFrom = last_successful_sync_at - 10 minutes
incrementalTo   = sync start timestamp
```

The watermark advances to `incrementalTo` **only after** every page and every required write succeeds. Failures leave the previous watermark unchanged so the next run re-fetches the failed window.

## 12. Supabase migrations

Apply **after** 001–008, in order. Do not edit 001–008.

```
009_shopify_schema.sql
010_shopify_indexes_and_security.sql
011_shopify_analytics_views.sql
012_shopify_dashboard_functions.sql
```

Via Dashboard SQL Editor or:

```bash
supabase db push
```

SQL contains no project IDs, URLs, or secrets.

The dashboard reads `analytics.shopify_*` through the Supabase Data API. After 011–012, expose that schema:

1. Supabase Dashboard → **Project Settings** → **Data API** (or **API**)
2. Under **Exposed schemas**, add `analytics` next to `public` and `data_pipeline`
3. Save. Wait a few seconds for PostgREST to reload
4. Refresh `http://localhost:3000/dashboard/shopify`

If `analytics` is not exposed, overview/orders APIs return 500 (`Invalid schema: analytics`). Do not move Shopify views into `public`.

## 13. Cron setup

Do **not** put the app URL or sync secret in a migration.

Shiprocket cron (`shiprocket-worker-trigger`, every minute) must remain unchanged.

Because Apps Script typically runs on `:00 / :15 / :30 / :45`, prefer an **offset** schedule while both readers share the same Shopify app:

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

`*/15 * * * *` is acceptable after Apps Script cutover. Offset timing is preferred while Apps Script remains live.

Replace the two placeholders only. Do not commit the filled-in statement.

## 14. Dashboard

URL: `/dashboard/shopify`

Protected with HTTP Basic (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`).

The dashboard is **Next.js + Recharts**. It reads **only** from `analytics.shopify_*` views and date-range SQL functions via Next.js APIs. It never calls the Shopify GraphQL API.

This Shopify pipeline does **not** use Metabase. Do not set up a Shopify Metabase dashboard.

The Shopify dashboard is HTTP Basic–protected and shows full customer name, email, and phone for operations. Raw Shopify JSON is not stored.

Shiprocket `/dashboard` is unchanged and is not newly locked by this auth.

## 15. Analytics views (Next.js dashboard)

These SQL views and `analytics.shopify_*_for_range(...)` functions are the metric source for `/dashboard/shopify`. Do not reimplement the formulas in the browser.

- `analytics.shopify_orders`
- `analytics.shopify_order_lines`
- `analytics.shopify_direct_link`
- `analytics.shopify_kpis`
- `analytics.shopify_daily_sales`
- `analytics.shopify_financial_status_summary`
- `analytics.shopify_fulfillment_status_summary`
- `analytics.shopify_product_performance`
- `analytics.shopify_payment_method_summary`
- `analytics.shopify_discount_performance`
- `analytics.shopify_utm_performance`
- `analytics.shopify_geo_summary`
- `analytics.shopify_cancellation_summary`
- `analytics.shopify_customer_summary`
- `analytics.shopify_recent_orders`
- `analytics.shopify_sync_health`

Product revenue uses `item price * quantity - line discount`. Never `SUM(order.total_price)` on a line-level view.

### Payment category mapping

- **COD**: gateway matches `cash_on_delivery`, `cash on delivery`, `cod`, or `cash`
- **PREPAID**: `shopify_payments`, `razorpay`, `payu`, `phonepe`, `stripe`, `paypal`, `gokwik`, `simpl`, `lazypay`, `upi`, `card`, `wallet`
- **OTHER / UNKNOWN**: everything else / empty

This mapping is conservative. Do not treat it as a complete COD/prepaid classifier.

## 16. Failure recovery

- Incremental failure → watermark unchanged → next run retries the overlap window
- Backfill chunk failure → job status `paused` → `POST .../backfill/resume`
- Concurrent sync for the same shop → `409`
- Active backfill blocks incremental/repair
- Auth / scope / malformed GraphQL errors are not retried

## 17. Rate limits

Both Apps Script and this pipeline share the same Shopify app during migration.

Up to 6 retries with 1s, 2s, 4s, 8s, 16s, 32s backoff. `Retry-After` and GraphQL `throttleStatus` are respected.

Avoid launching both backfills at once.

## 18. Granted scope limitation

If `read_all_orders` is missing, accessible history is recorded as 60 days and a warning is stored on `shopify_sync_state` / the sync run.

Do not change app permissions automatically.

## 19. Security

- No Shopify token in PostgreSQL
- No `NEXT_PUBLIC_` secrets
- Canonical tables: service_role only, RLS enabled
- Internal sync routes require `Authorization: Bearer <SHOPIFY_INTERNAL_SYNC_SECRET>`
- Dashboard / Shopify read APIs require HTTP Basic
- Logs never include tokens, client secrets, emails, phones, addresses, or GraphQL bodies

## 20. Raw JSON is intentionally not stored

There is no `raw_payload`, `payload jsonb`, or raw-order table. The Google Sheet may still have Raw Shopify JSON. This pipeline does not copy it.

## 21. Schema drift monitoring

Unknown GraphQL fields are recorded in `data_pipeline.shopify_schema_drift` as:

- `entity_type` (`orders`, `line_items`, `customer`, `fulfillments`, `refunds`, `transactions`, `shipping_lines`, `discounts`)
- `field_path`
- `observed_type`
- `api_version`

The unknown **value is never stored**.

## 22. Legacy Google Sheets remains untouched

Do not modify the Apps Script, its Shopify app, its token, or the Growth MIS sheet.

## GraphQL vs sheet field differences

| Sheet / REST-style field | GraphQL mapping | Notes |
|--------------------------|-----------------|-------|
| Order Number | `name` | Stored as `order_name` / `order_number` |
| Id | `legacyResourceId` | Text, not JS Number |
| Financial / fulfillment status | `displayFinancialStatus` / `displayFulfillmentStatus` | Canonical GraphQL enums (`PAID`, …) |
| Note attributes / UTMs | `customAttributes` + `customerJourneySummary` | Normalized rows |
| Staff Note | `cancellation.staffNote` | Null if absent |
| Landing / referring site | `landingPageUrl` / `referrerUrl` / journey | Null if Shopify omits them |
| Customer last-order discount code | — | Not available; stored/shown as NULL |
| Raw Shopify JSON | — | Intentionally omitted |
| `source_url` | — | Not stored; GraphQL has no reliable equivalent we persist |

Statuses are stored as Shopify returned them (not title-cased).
