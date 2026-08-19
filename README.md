# Data Pipeline Server

Scalable data pipeline for Shiprocket (and future integrations) using Next.js, Supabase PostgreSQL, Supabase Queues (`pgmq`), Edge Functions, and Metabase-compatible analytics views.

## Current Status

| Component | Status |
|-----------|--------|
| Shiprocket webhook ingestion | ✅ Working |
| Pabbly delivery (WhatsApp) | ✅ Working |
| Edge Function worker | ✅ Deployed |
| Cron job (auto-processing) | ✅ Running every minute |
| Analytics views (Metabase) | ✅ Created (migration 008) |
| RLS policies | ✅ Tightened |
| Tests (22/22) | ✅ Passing |

## Architecture

```
SHIPROCKET
     │
     │ webhook
     ▼
Next.js webhook endpoint
     │
     ├── authenticate webhook (x-webhook-key header)
     ├── read raw JSON
     ├── create deterministic SHA-256 request hash
     ├── create event record
     ├── enqueue event
     └── return HTTP response quickly
             │
             ▼
     Supabase Queue (pgmq)
             │
             ▼
       Edge Function (shiprocket-worker)
             │
             ├── read queue messages
             ├── fetch stored raw webhook
             ├── parse Shiprocket fields
             ├── upsert Shiprocket order
             ├── send to Pabbly (if configured)
             ├── record result
             ├── retry temporary failures
             └── archive successful message
             │
             ▼
       Supabase PostgreSQL
             │
       ┌─────┴───────┐
       ▼             ▼
    Next.js        Metabase
```

## Local Setup

### 1. Install dependencies

```bash
cd data-pipeline_server
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in the required values in .env
```

### 3. Run database migrations

Via Supabase Dashboard SQL Editor or Supabase CLI:

```bash
# Apply migrations in order (001-008)
supabase db push
# Or manually run each file in supabase/migrations/
```

### 4. Deploy Edge Function

```bash
supabase functions deploy shiprocket-worker
```

### 5. Set Edge Function secrets

```bash
supabase secrets set WORKER_SECRET=<your-secret>
```

### 6. Run tests

```bash
npm test
```

### 7. Start dev server

```bash
npm run dev
```

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase service-role key (secret) |
| `SHIPROCKET_WEBHOOK_SECRET` | Secret for authenticating Shiprocket webhooks |
| `WORKER_SECRET` | Secret for authenticating worker invocations |
| `PABBLY_SHIPROCKET_URL` | Pabbly webhook URL (optional) |
| `SHIPROCKET_PABBLY_ENABLED` | `true`/`false` — enable Pabbly delivery (default: `false`) |

**Never prefix secrets with `NEXT_PUBLIC_`.**

## Database Migration Commands

```bash
# Via Supabase CLI
supabase migration new <name>
supabase db push

# Via Dashboard SQL Editor
# Copy-paste migration files in order (001-008)
```

## Edge Function Deployment

```bash
supabase functions deploy shiprocket-worker
```

## Cron Configuration

The worker runs every minute via pg_cron. Set up via Supabase Dashboard > SQL Editor:

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

**Do NOT hardcode project URLs into SQL migrations.** Configure via Dashboard or secrets.

## Test Webhook

Send a test payload:

```bash
curl -X POST http://localhost:3000/api/webhooks/shiprocket \
  -H "Content-Type: application/json" \
  -H "x-webhook-key: sr_wh_test_abc123" \
  -d '{
    "order_id": 199656,
    "status": "77",
    "current_status": "Delivered",
    "awb": "1234567890",
    "courier_name": "Test Courier",
    "email": "test@example.com",
    "phone": "+911234567890",
    "cod_collected": "0",
    "weight": "1.5",
    "order_date": "2026-08-19"
  }'
```

Expected response:
```json
{
  "received": true,
  "event_id": "<uuid>",
  "duplicate": false
}
```

**Note:** Use order IDs without "TEST" prefix for Pabbly delivery. Test orders (containing "TEST") are filtered out by Pabbly to prevent accidental WhatsApp messages.

## How Retries Work

- Exponential backoff: 15s → 30s → 60s → 120s → ... → 15min cap
- After ~10 failed attempts, the event is dead-lettered
- Dead-lettered events are removed from the active queue but preserved in `integration_events`
- Failed events are retried with increasing visibility timeouts

## How Dead Letters Work

- After `MAX_ATTEMPTS` (default: 10) failures, event status → `dead_letter`
- Queue message is deleted (no more retries)
- The raw payload is preserved in `integration_events` for inspection
- Check via: `SELECT * FROM data_pipeline.integration_events WHERE status = 'dead_letter';`

## How to Inspect Integration Events

```sql
-- All events
SELECT id, provider, status, attempt_count, last_error, received_at
FROM data_pipeline.integration_events
ORDER BY created_at DESC LIMIT 100;

-- Failed events
SELECT * FROM data_pipeline.integration_events WHERE status = 'failed';

-- Dead-lettered events
SELECT * FROM data_pipeline.integration_events WHERE status = 'dead_letter';

-- Duplicate detection
SELECT request_hash, count(*) FROM data_pipeline.integration_events
GROUP BY request_hash HAVING count(*) > 1;
```

## Pabbly Integration

Pabbly delivery is enabled. The workflow sends WhatsApp messages via WATI when orders are delivered.

### Pabbly Workflow Structure

```
1. Webhook (trigger)
2. Filter (Pabbly) — skips if order_id contains "TEST"
3. WATI → Send Template Message (WhatsApp message 1)
4. WATI → Send Template Message (WhatsApp message 2)
5. Delay (Pabbly)
6. WATI → Send Template Message (WhatsApp message 3)
```

### Monitoring Pabbly Deliveries

```sql
-- Check delivery status
SELECT * FROM data_pipeline.shiprocket_pabbly_deliveries
ORDER BY created_at DESC LIMIT 20;

-- Successful deliveries
SELECT * FROM data_pipeline.shiprocket_pabbly_deliveries WHERE status = 'success';

-- Failed deliveries
SELECT * FROM data_pipeline.shiprocket_pabbly_deliveries WHERE status = 'error';
```

## Analytics Views (Metabase)

Migration 008 creates 10 analytics views under the `analytics` schema:

- `analytics.shiprocket_orders` — clean order data
- `analytics.shiprocket_status_summary` — status aggregates
- `analytics.shiprocket_delivery_summary` — daily delivery metrics
- `analytics.integration_events_summary` — event processing health
- `analytics.pabbly_delivery_status` — Pabbly delivery tracking
- `analytics.hourly_order_volume` — hourly order trends
- `analytics.courier_performance` — courier delivery metrics
- `analytics.payment_method_summary` — COD vs prepaid breakdown
- `analytics.weekly_trends` — weekly order trends
- `analytics.recent_orders` — last 50 orders with all fields

### Deploy Analytics Views

```bash
# Run in Supabase SQL Editor:
# 1. First drop existing views (if re-deploying)
# 2. Then run migration 008
```

See `METABASE_SETUP.md` for complete Metabase connection guide.

## Production Cutover

1. Compare Supabase output against existing Google Sheets output for same webhooks
2. Run both systems in parallel for at least 1 week
3. Verify data consistency
4. Update Shiprocket webhook URL to point to new endpoint
5. Keep Google Apps Script running as backup
6. Monitor `integration_events` and `shiprocket_orders` for issues
7. Gradually enable Pabbly delivery from new system

**Do NOT switch production traffic until explicitly approved.**

## How to Add a New Integration

1. **Create module**: `src/modules/<provider>/` with types, parser, service
2. **Create queue**: SQL migration with `pgmq.create('<provider>_webhooks')`
3. **Create provider-specific tables**: SQL migration for `<provider>_orders` etc.
4. **Create worker**: `supabase/functions/<provider>-worker/`
5. **Create webhook/API route**: `app/api/webhooks/<provider>/route.ts`
6. **Add Cron**: Configure periodic worker invocation
7. **Add analytics views**: Under `analytics` schema

Each integration is isolated. A failure in one must not affect others.

## Database Objects

### Schemas
- `data_pipeline` — operational pipeline tables and functions
- `analytics` — Metabase-friendly views

### Tables
- `data_pipeline.integration_events` — generic event/audit log
- `data_pipeline.shiprocket_orders` — processed Shiprocket orders
- `data_pipeline.shiprocket_pabbly_deliveries` — Pabbly delivery tracking

### Queue
- `shiprocket_webhooks` — pgmq queue for Shiprocket webhook processing

### Functions
- `data_pipeline.ingest_shiprocket_webhook()` — atomic event + queue insertion
- `data_pipeline.read_shiprocket_queue()` — batch queue read
- `data_pipeline.archive_shiprocket_queue_message()` — ack processed message
- `data_pipeline.retry_shiprocket_queue_message()` — retry with delay
- `data_pipeline.delete_shiprocket_queue_message()` — remove dead-letter message

### Views (Analytics)
- `analytics.shiprocket_orders` — clean order data
- `analytics.shiprocket_status_summary` — status aggregates
- `analytics.shiprocket_delivery_summary` — daily delivery metrics
- `analytics.integration_events_summary` — event processing health
- `analytics.pabbly_delivery_status` — Pabbly delivery tracking
- `analytics.hourly_order_volume` — hourly order trends
- `analytics.courier_performance` — courier delivery metrics
- `analytics.payment_method_summary` — COD vs prepaid breakdown
- `analytics.weekly_trends` — weekly order trends
- `analytics.recent_orders` — last 50 orders with all fields
