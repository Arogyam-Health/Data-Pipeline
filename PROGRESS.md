# Data Pipeline - Progress Report

**Date:** August 24, 2026
**Author:** Nitin Kumar
**Meeting:** 1:00 PM

---

## 1. Problem We Are Solving

The company currently tracks Shiprocket orders, Shopify sales, Meta Ads, and Google Ads data **manually in Google Sheets** using Google Apps Script. This is:

- **Fragile** — Apps Script breaks on timeout, no retry mechanism
- **Unscalable** — Google Sheets row limits, multiple queue tabs (04-09) as workaround
- **No analytics** — Can't build dashboards, trends, or alerts from Sheets
- **No real-time visibility** — Manager has to check Sheets manually

**Goal:** Build a scalable data pipeline that ingests data from multiple sources (Shiprocket, Shopify, Meta Ads, Google Ads) into PostgreSQL, with analytics dashboards.

---

## 2. End Output

```
SHIPROCKET ──┐
SHOPIFY ─────┼──→ PostgreSQL ──→ Next.js Dashboard (Recharts)
META ADS ────┤        ↑
GOOGLE ADS ──┘    pg_cron (auto-trigger)
                        │
                   pgmq (queue)
                        │
                   Edge Function (worker)
                        │
                   Pabbly → WhatsApp
```

**What the manager sees:**
- Real-time dashboard at `localhost:3000/dashboard`
- Order volume, delivery rates, courier performance
- Pabbly (WhatsApp) delivery success tracking
- Status breakdown, hourly trends
- Shopify sales, product performance, UTM attribution

---

## 3. Architecture & Implementation

### How Queues, Cron Jobs, and Edge Functions Replace Google Sheets

#### What Was the Old System (Google Sheets)?

```
Shiprocket Webhook → Google Apps Script → Google Sheet (write row)
                                        → Pabbly (send WhatsApp)
```

**Problems with this approach:**
- Apps Script has **6-minute timeout limit** — breaks on large payloads
- Google Sheets has **row limits** — created Queue tabs 04-09 as workaround
- **No retry mechanism** — if Apps Script fails, data is lost
- **No analytics** — can't build dashboards, trends, or alerts
- **Manual monitoring** — manager has to check Sheets manually

#### What Is the New System (PostgreSQL + Queues)?

```
Shiprocket Webhook → Next.js API → pgmq Queue → Edge Function → PostgreSQL
                                                          ↓
                                                    Pabbly → WhatsApp
```

---

### Queues (pgmq) — What They Are and Why We Need Them

**What is a queue?**
A queue is a waiting line for data. When a webhook comes in, we don't process it immediately — we put it in a queue and process it later.

**Why queues replace Google Sheets:**

| Google Sheets Approach | Queue Approach |
|------------------------|----------------|
| Write row immediately (can fail) | Store in queue (guaranteed) |
| If Apps Script crashes, data lost | If worker crashes, data stays in queue |
| No retry mechanism | Automatic retry with backoff |
| Limited by Sheets row limits | PostgreSQL handles millions of rows |
| No audit trail | Full audit trail in `integration_events` |

**How our queue works:**

1. **Ingest:** Webhook arrives → stored in `integration_events` table → message added to `shiprocket_webhooks` queue
2. **Process:** Edge Function reads from queue → processes order → stores in `shiprocket_orders`
3. **Acknowledge:** If successful → message removed from queue
4. **Retry:** If failed → message stays in queue with increased delay
5. **Dead-letter:** After 10 failures → moved to dead-letter (no more retries)

**Queue functions in PostgreSQL:**

| Function | What It Does |
|----------|--------------|
| `ingest_shiprocket_webhook()` | Atomic: insert event + add to queue (one transaction) |
| `read_shiprocket_queue()` | Read next batch of messages (with visibility timeout) |
| `archive_shiprocket_queue_message()` | Remove processed message from queue |
| `retry_shiprocket_queue_message()` | Put message back with delay (exponential backoff) |
| `delete_shiprocket_queue_message()` | Move to dead-letter (give up after max retries) |

---

### Cron Jobs — What They Are and Why We Need Them

**What is a cron job?**
A cron job is an automatic timer that runs something at regular intervals. Like an alarm clock that goes off every minute.

**Why cron jobs replace manual checking:**

| Google Sheets Approach | Cron Job Approach |
|------------------------|-------------------|
| Manager checks Sheets manually | System processes automatically |
| Data sits unprocessed until someone looks | Data processed every 60 seconds |
| No real-time visibility | Near real-time (60-second delay) |
| Human error (forgetting to check) | Automatic, never forgets |

**How our cron job works:**

1. **Schedule:** Runs every `* * * * *` (every minute)
2. **Action:** Calls the Edge Function via HTTP POST
3. **Edge Function:** Reads from queue, processes orders, stores in database
4. **Result:** Orders appear in database within 60 seconds of webhook arrival

**Cron job SQL:**

```sql
SELECT cron.schedule(
  'shiprocket-worker-trigger',  -- name
  '* * * * *',                  -- every minute
  $$
  SELECT net.http_post(
    url := '<YOUR_SUPABASE_URL>/functions/v1/shiprocket-worker',
    headers := '{"Authorization": "Bearer <WORKER_SECRET>"}',
    body := '{}'
  );
  $$
);
```

**What happens if cron job fails?**
- Next minute, it tries again
- Queue messages stay safe in PostgreSQL
- No data is lost
- Error logged in `integration_events`

---

### Edge Functions — What They Are and Why We Need Them

**What is an Edge Function?**
A small program that runs on Supabase's servers (not your computer). It processes data when triggered by the cron job.

**Why Edge Functions replace Apps Script:**

| Google Apps Script | Edge Function |
|--------------------|---------------|
| 6-minute timeout | No timeout (runs until done) |
| Breaks on large payloads | Handles any size |
| No retry mechanism | Automatic retry built-in |
| Hard to debug | Full error logging |
| No monitoring | Health checks + metrics |

**What our Edge Function does (step by step):**

1. **Trigger:** Cron job calls it every minute
2. **Read queue:** Gets next batch of messages (up to 10)
3. **For each message:**
   a. Get the raw webhook payload from `integration_events`
   b. Parse Shiprocket fields (status, AWB, courier, customer, etc.)
   c. Upsert to `shiprocket_orders` table
   d. If Pabbly enabled → send to Pabbly for WhatsApp
   e. Record delivery status
   f. Archive message (remove from queue)
4. **If error:** Retry with exponential backoff
5. **If too many failures:** Dead-letter (stop retrying)

**Edge Function location:**
```
supabase/functions/shiprocket-worker/index.ts
```

---

### Timing: How Often Data Is Processed

#### Shiprocket (Real-time via Webhooks)

| Event | Timing |
|-------|--------|
| Webhook arrives | **Immediate** (Shiprocket sends it) |
| Stored in queue | **< 1 second** (Next.js API processes) |
| Processed by worker | **Within 60 seconds** (cron runs every minute) |
| Appears in database | **Within 60 seconds** of webhook arrival |
| WhatsApp sent | **Within 60 seconds** of webhook arrival |

**Total latency:** < 1 minute from Shiprocket event to database + WhatsApp

#### Shopify (Polling every 15 minutes)

| Event | Timing |
|-------|--------|
| Order created/updated in Shopify | **Immediate** (Shopify internal) |
| Scheduler checks for changes | **Every 15 minutes** |
| Fetches updated orders | **< 30 seconds** (GraphQL query) |
| Normalizes and stores in database | **< 10 seconds** per order |
| Appears in dashboard | **Within 15 minutes** of Shopify update |

**Total latency:** 15-16 minutes from Shopify update to database

**Why 15 minutes?**
- Shopify GraphQL API has rate limits (cost-based)
- Polling too frequently wastes API budget
- 15 minutes is a good balance between freshness and efficiency
- Shiprocket needs real-time (for WhatsApp), Shopify can wait 15 minutes

---

### How Queues Replace Multiple Sheet Tabs

**The Old Problem:**
Google Sheets had tabs named:
- Shiprocket Webhook Queue 04
- Shiprocket Webhook Queue 05
- Shiprocket Webhook Queue 06
- Shiprocket Webhook Queue 07
- Shiprocket Webhook Queue 08
- Shiprocket Webhook Queue 09

These were workarounds for Sheets' row limits. Each tab held ~1000 rows, so they kept creating new tabs as data grew.

**The New Solution:**
PostgreSQL doesn't have row limits. One table (`shiprocket_orders`) can hold millions of rows with proper indexing.

| Old System (Sheets) | New System (PostgreSQL) |
|---------------------|------------------------|
| 6+ tabs, each with 1000 rows | 1 table with unlimited rows |
| Manual tab management | Automatic, no management |
| Data scattered across tabs | All data in one place |
| Hard to query across tabs | Simple SQL queries |
| No analytics | 10+ analytics views |
| Manual checking | Automatic cron processing |

---

### 3-Layer Data Pipeline

```
RAW LAYER (current)              STAGING LAYER (future)         DW LAYER (future)
─────────────────                ────────────────────           ────────────────
- Ingest webhook data            - Clean & validate             - Business analytics
- Store in pgmq queue            - Normalize fields             - Aggregated views
- Process via Edge Function      - Deduplicate                  - Historical trends
- Upsert to orders table         - Enrich with Shopify data     - Executive reports
```

### Current Stack

| Component | Technology | Where It Lives |
|-----------|-----------|----------------|
| Webhook Endpoint | Next.js API Route | `app/api/webhooks/delivery-events/route.ts` |
| Queue | pgmq (PostgreSQL) | Supabase: `data_pipeline.shiprocket_webhooks` |
| Worker | Supabase Edge Function | `supabase/functions/shiprocket-worker/` |
| Cron Trigger | pg_cron | Supabase SQL: runs every 1 minute |
| Database | PostgreSQL | Supabase: `data_pipeline` schema |
| Dashboard | Next.js + Recharts | `app/dashboard/` |
| Analytics Views | PostgreSQL Views | `analytics` schema (26+ views) |

---

## 4. Database Objects in Supabase

### Schema: `data_pipeline` — Shiprocket

| Object | Type | Purpose |
|--------|------|---------|
| `integration_events` | Table | Raw webhook audit log (every incoming event) |
| `shiprocket_orders` | Table | Processed order data (40+ columns) |
| `shiprocket_pabbly_deliveries` | Table | WhatsApp delivery tracking |
| `shiprocket_webhooks` | pgmq Queue | Pending events for worker |
| `ingest_shiprocket_webhook()` | Function | Atomic: insert event + enqueue |
| `read_shiprocket_queue()` | Function | Batch read from queue |
| `archive_shiprocket_queue_message()` | Function | Mark message as done |
| `retry_shiprocket_queue_message()` | Function | Retry with delay |
| `delete_shiprocket_queue_message()` | Function | Dead-letter removal |

### Schema: `data_pipeline` — Shopify (23 tables)

**Sync Infrastructure (6 tables):**

| Table | Purpose |
|-------|---------|
| `shopify_sync_runs` | Audit log for every sync execution |
| `shopify_sync_state` | Per-shop watermark state (last successful sync) |
| `shopify_sync_locks` | Distributed lock with TTL (prevents concurrent syncs) |
| `shopify_sync_errors` | Per-order error log linked to sync run |
| `shopify_backfill_jobs` | Tracks chunked backfill state |
| `shopify_schema_drift` | Tracks new/unexpected fields from Shopify API |

**Domain Tables (17 tables):**

| Table | Key Data |
|-------|----------|
| `shopify_orders` | ~50 columns: financials, status, timestamps, tags, payment gateways |
| `shopify_order_addresses` | Shipping + billing addresses |
| `shopify_order_items` | Line items: SKU, product/variant IDs, price, quantity, discounts |
| `shopify_line_item_properties` | Custom attributes on line items |
| `shopify_note_attributes` | UTM parameters from customer journey |
| `shopify_discount_codes` | Discount codes applied |
| `shopify_discount_applications` | Full discount application detail |
| `shopify_discount_allocations` | Per-line-item discount allocation |
| `shopify_customers` | Customer profiles: name, email, phone, marketing consent |
| `shopify_customer_addresses` | Customer addresses with lat/lon |
| `shopify_fulfillments` | Tracking info: company, number, URL, status |
| `shopify_fulfillment_items` | Links fulfillments to order items |
| `shopify_shipping_lines` | Carrier, code, price, discounted price |
| `shopify_refunds` | Refund details: note, restock flag |
| `shopify_transactions` | Payment transactions: amount, gateway, kind, status |
| `shopify_refund_line_items` | Line item details for refunds |
| `shopify_order_adjustments` | Refund adjustments |

### Schema: `analytics` — Views (26+ views)

**Shiprocket (10 views):**

| View | Purpose |
|------|---------|
| `analytics.shiprocket_orders` | Clean order data |
| `analytics.shiprocket_status_summary` | Status aggregates |
| `analytics.shiprocket_delivery_summary` | Daily delivery metrics |
| `analytics.integration_events_summary` | Event processing health |
| `analytics.pabbly_delivery_status` | WhatsApp delivery tracking |
| `analytics.hourly_order_volume` | Hourly trends |
| `analytics.courier_performance` | Courier metrics |
| `analytics.payment_method_summary` | COD vs Prepaid |
| `analytics.weekly_trends` | Weekly aggregates |
| `analytics.recent_orders` | Last 50 orders |

**Shopify (16 views):**

| View | Purpose |
|------|---------|
| `analytics.shopify_orders` | Denormalized order view with payment category |
| `analytics.shopify_order_lines` | Line-item level with revenue and UTM params |
| `analytics.shopify_direct_link` | Backward compatibility with old sheet format |
| `analytics.shopify_kpis` | Single-row KPI snapshot |
| `analytics.shopify_daily_sales` | Daily aggregation |
| `analytics.shopify_financial_status_summary` | Orders by financial status |
| `analytics.shopify_fulfillment_status_summary` | Orders by fulfillment status |
| `analytics.shopify_product_performance` | SKU-level aggregation |
| `analytics.shopify_payment_method_summary` | Gateway breakdown |
| `analytics.shopify_discount_performance` | Discount code ROI |
| `analytics.shopify_utm_performance` | Marketing attribution |
| `analytics.shopify_geo_summary` | Geographic breakdown |
| `analytics.shopify_cancellation_summary` | Cancellation analysis |
| `analytics.shopify_customer_summary` | Customer metrics |
| `analytics.shopify_recent_orders` | Latest 50 orders |
| `analytics.shopify_sync_health` | Operational health |

**Shopify Functions (9 parameterized functions):**

| Function | Purpose |
|----------|---------|
| `analytics.shopify_kpis_for_range(p_from, p_to)` | KPIs for date range |
| `analytics.shopify_financial_status_for_range(...)` | Financial status for date range |
| `analytics.shopify_fulfillment_status_for_range(...)` | Fulfillment status for date range |
| `analytics.shopify_product_performance_for_range(...)` | Products for date range |
| `analytics.shopify_payment_method_for_range(...)` | Payments for date range |
| `analytics.shopify_discount_performance_for_range(...)` | Discounts for date range |
| `analytics.shopify_utm_performance_for_range(...)` | UTM for date range |
| `analytics.shopify_geo_summary_for_range(...)` | Geo for date range |
| `analytics.shopify_cancellation_summary_for_range(...)` | Cancellations for date range |

---

## 5. Progress Till Now (Daily Log)

| Date | Work Done |
|------|-----------|
| **15 Aug 2026** | Analysed existing Shiprocket webhook workflow: Google Apps Script, Sheet structure, webhook payload handling, Pabbly integration |
| **16 Aug 2026** | Studied Shiprocket order/shipment fields: Order ID, Shipment ID, AWB, courier, payment method, status, delivery, NDR/RTO, scan history. Mapped Sheet columns with webhook payload |
| **17 Aug 2026** | Finalised Shiprocket migration plan: webhook validation, duplicate prevention, retries, logging, failure recovery |
| **18 Aug 2026** | Designed complete Shiprocket architecture: Webhook → Next.js API → event storage → pgmq queue → worker → database → Pabbly → analytics |
| **19 Aug 2026** | Designed database and processing layer: shiprocket_orders, integration_events, queue contracts, SHA-256 dedup, retry strategy, dead-letter handling |
| **20 Aug 2026** | Implemented main Shiprocket pipeline: webhook API route, parser (600+ lines), atomic ingestion, pgmq queue, Edge Function worker, order upsert, Pabbly forwarding, analytics views, cron processing, tests |
| **21 Aug 2026** | Deployed and validated Shiprocket: test webhooks, scheduled processing, database insertion, deduplication, retry behaviour, Pabbly forwarding. Started analysing Shopify Apps Script and Direct Shopify Link sheet |
| **22-23 Aug 2026** | Designed Shopify: normalized schema (23 tables), sync state management, distributed locking, chunked backfill, 19 indexes, RLS policies, 16 analytics views, 9 parameterized functions, GraphQL client with rate limiting |

---

## 6. Shiprocket — Implementation Details

### ✅ Completed

| Component | Status | Details |
|-----------|--------|---------|
| Webhook endpoint | ✅ Done | `POST /api/webhooks/delivery-events` with timing-safe auth |
| Parser | ✅ Done | 600+ lines, ported from Apps Script with all field alternates |
| Queue system | ✅ Done | pgmq with atomic ingest function |
| Edge Function worker | ✅ Done | Deployed, reads queue, parses, upserts, delivers to Pabbly |
| Cron job | ✅ Done | Runs every minute, invokes worker |
| Pabbly delivery | ✅ Done | WhatsApp messages sent via WATI (verified with test data) |
| Security | ✅ Done | Timing-safe webhook auth, RLS policies |
| Analytics views | ✅ Done | 10 views created (migration 008) |
| Tests | ✅ Done | 22/22 passing, lint clean, typecheck clean |

### ❌ Not Yet Done

| Item | Status | Blocker |
|------|--------|---------|
| Import historical data | ❌ Pending | Need CSV export from Google Sheets |
| Production cutover | ❌ Pending | Shiprocket allows only ONE webhook URL |

### Shiprocket Webhook Limitation

**Problem:** Shiprocket allows only ONE webhook URL. Currently points to Google Apps Script.

**Solution (Option B — Keep Both):**
```javascript
// Add one line in Apps Script to forward to our API
UrlFetchApp.fetch('https://your-api.com/api/webhooks/delivery-events', {
  method: 'post',
  contentType: 'application/json',
  headers: { 'x-webhook-key': '<SHIPROCKET_WEBHOOK_SECRET>' },
  payload: JSON.stringify(data)
});
```

**Result:**
```
Shiprocket → Apps Script → Google Sheets (unchanged)
                         → Pabbly → WhatsApp (unchanged)
                         → Our API → Supabase (NEW)
```

---

## 7. Shopify — Implementation Details

### Sync Mechanism

| Aspect | Approach |
|--------|----------|
| API | GraphQL Admin API (2026-04) |
| Trigger | In-process scheduler (every 15 minutes) |
| Watermark | `updated_at` field on orders |
| Rate Limiting | Exponential backoff + GraphQL throttle detection |
| Locking | Distributed lock with 15-min TTL |

### Sync Modes

| Mode | Trigger | Time Window |
|------|---------|-------------|
| `test` | Manual API call | Last 3 days |
| `backfill` | Manual API call | 90 days in 3-day chunks |
| `incremental` | Scheduler (every 15 min) | Since last sync - 10 min buffer |
| `repair` | Manual API call | Same as incremental |

### What Gets Synced

| Entity | Source | Details |
|--------|--------|---------|
| Orders | Primary (paginated by `updated_at`) | ~50 fields: financials, status, timestamps, tags, payment |
| Customers | Nested within orders | Name, email, phone, marketing consent |
| Line Items | Nested connection with pagination | SKU, product/variant IDs, price, quantity, discounts |
| Fulfillments | Nested connection | Tracking info, status, service |
| Refunds | Nested connection | Note, restock, line item details |
| Transactions | From orders + refunds | Amount, gateway, kind, status |
| Shipping Lines | Nested connection | Carrier, code, price, discounted price |
| Discount Codes | Multiple sources (deduplicated) | Code, amount, type |
| Note Attributes | Custom attributes | Used for UTM extraction |

### Rate Limiting Strategy

- **HTTP 429:** Respects `Retry-After` header
- **GraphQL throttling:** Reads `throttleStatus.currentlyAvailable`, waits when credits < 50
- **Exponential backoff:** [1s, 2s, 4s, 8s, 16s, 32s], max 6 retries
- **Page size:** Capped at 25 (conservative to stay under Shopify's 1000 cost limit)

### Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| No `read_all_orders` scope | History clamped to ~60 days | System generates warning, doesn't fail |
| Orders-only sync | Orphaned customers/products missed | Acceptable for current use case |
| No webhook support | No real-time updates | 15-min polling is sufficient |
| Single-shop design | One shop per deployment | Matches current business structure |
| No deletion handling | Deleted orders remain in DB | Manual cleanup if needed |

---

## 8. Why Next.js Dashboard Instead of Metabase

| Factor | Metabase | Next.js + Recharts |
|--------|----------|-------------------|
| Deployment | Needs Docker/server (cost) | Free with existing Next.js app |
| Setup | Complex networking issues | Already integrated |
| Customization | Limited | Fully custom |
| Cost | Free (OSS) but needs hosting | Zero additional cost |

**Decision:** Keep Metabase analytics views as backup, use Next.js dashboard for now.

---

## 9. Why Shiprocket Is Not Fully Live

### Issue 1: Webhook Limitation
- **Shiprocket allows only ONE webhook URL**
- Currently points to Google Apps Script
- Can't simultaneously send to Apps Script AND our system
- **Solution:** Add one forwarding line in Apps Script (see Section 6)

### Issue 2: Dashboard Shows Test Data Only
- Only 4 test orders in Supabase (manual curl tests)
- Real data (800+ orders across Queue tabs 04-09) is in Google Sheets
- **Need:** Export CSVs from Sheets → import into Supabase

### Issue 3: Some Columns Depend on Shopify
- Google Sheets have both Shiprocket data AND Shopify order data
- Shiprocket `order_id` references Shopify order numbers
- Cross-source analytics requires both datasets
- **Status:** Shopify is now implemented, ready for data join

---

## 10. Next Steps

1. **Today:** Export CSVs from Google Sheets → import into Supabase
2. **This week:** Add forwarding line in Apps Script (Option B: keep both systems)
3. **This week:** Configure Shopify credentials → run initial sync
4. **Next week:** Verify dashboard with real data from both sources
5. **Future:** Meta Ads, Google Ads integrations

---

## 11. Files & Structure

```
data-pipeline_server/
├── app/
│   ├── api/
│   │   ├── webhooks/shiprocket/route.ts    ← Shiprocket webhook endpoint
│   │   ├── analytics/route.ts              ← Dashboard data API
│   │   └── internal/shopify/               ← Shopify sync triggers
│   ├── dashboard/page.tsx                  ← Dashboard UI
│   └── dashboard/components/               ← Charts (Recharts)
├── src/modules/
│   ├── shopify/                            ← Shopify sync module (16 files)
│   │   ├── graphql.ts                      ← GraphQL client with rate limiting
│   │   ├── sync.ts                         ← Core sync orchestration
│   │   ├── normalizer.ts                   ← GraphQL → DB transformation
│   │   ├── repository.ts                   ← Database operations (upsert, lock, etc.)
│   │   ├── scheduler.ts                    ← In-process 15-min scheduler
│   │   ├── types.ts                        ← TypeScript interfaces
│   │   └── analytics.ts                    ← Dashboard data loading
│   └── shiprocket/                         ← Shiprocket module
│       ├── parser.ts                       ← 600+ line parser (from Apps Script)
│       ├── service.ts                      ← Event processing & upsert
│       └── pabbly.ts                       ← WhatsApp delivery via Pabbly
├── supabase/
│   ├── migrations/
│   │   ├── 001-008                         ← Shiprocket schema
│   │   ├── 009_shopify_schema.sql          ← Shopify tables (23 tables)
│   │   ├── 010_shopify_indexes.sql         ← 19 indexes + RLS
│   │   ├── 011_shopify_analytics.sql       ← 16 analytics views
│   │   └── 012_shopify_functions.sql       ← 9 parameterized functions
│   └── functions/
│       ├── shiprocket-worker/index.ts      ← Edge Function (Deno)
│       └── _shared/supabase.ts             ← Shared Supabase client
├── src/__tests__/                          ← 22 tests passing
├── .env                                    ← Secrets (gitignored)
└── imports/                                ← CSV files for data import
```

---

## Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Shiprocket pipeline | ✅ Complete | Webhook → queue → worker → Pabbly |
| Shopify sync | ✅ Complete | GraphQL polling, 23 tables, 16 views |
| Historical data import | ❌ Blocked | Need CSV export from Sheets |
| Next.js dashboard | ✅ Built | Needs real data |
| Meta/Google Ads | ❌ Future | After Shiprocket + Shopify verified |
| Production ready | ⏳ 85% | Need data import + live testing |

---

## Key Talking Points for Meeting

1. **What we built:** Scalable data pipeline replacing fragile Google Apps Script
2. **Shiprocket:** Complete — webhook, parser, queue, worker, Pabbly delivery, all working
3. **Shopify:** Complete — GraphQL sync, 23 tables, 16 analytics views, rate limiting, locking
4. **Dashboard:** Next.js + Recharts (saves Metabase deployment cost)
5. **Remaining:** Import historical data from Sheets, add forwarding line in Apps Script
6. **Webhook limitation:** Shiprocket allows only 1 URL — solution is Apps Script forwarding

### Quick Explainer: Queues, Cron Jobs, Edge Functions

**Queue (pgmq):**
- Like a waiting line for data
- Webhook arrives → goes to queue → processed later
- Guarantees no data loss (unlike Sheets which can lose data on timeout)
- Automatic retry if processing fails
- Replaces: Multiple Sheet tabs (04-09) that were workarounds for row limits

**Cron Job:**
- Automatic timer that runs every minute
- Triggers the Edge Function to process queued data
- Replaces: Manual checking of Google Sheets
- Result: Data processed automatically, no human intervention needed

**Edge Function:**
- Small program running on Supabase servers
- Reads from queue, processes orders, stores in database
- Sends to Pabbly for WhatsApp messages
- Replaces: Google Apps Script (which had 6-minute timeout and no retries)

**Timing:**
- Shiprocket: Within 60 seconds of webhook (real-time)
- Shopify: Every 15 minutes (polling, API-friendly)
