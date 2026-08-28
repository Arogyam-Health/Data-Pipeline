# Meta Ads setup

Full architecture, plan, terms, and code map: [`META.md`](./META.md).

Isolated Meta Marketing API pull into Supabase. The live Google Apps Script → **Meta Report** Google Sheet stays untouched. This app is a second read-only consumer of the **same existing** Meta access token and ad account.

Dashboards are Next.js + Recharts. Analytics SQL lives in `analytics.meta_*` so definitions stay in the database.

---

## 1. Architecture

```
META ADS ACCOUNT
        |
 Marketing API  (same current token + act_ id)
       / \
      /   \
 Apps Script     This repo (META_ACCESS_TOKEN in private .env)
      |                 |
 Google Sheet           Graph API client
 "Meta Report"          → data_pipeline.meta_*
                        → analytics.meta_*
                        → /dashboard/meta
```

There is no Meta PGMQ queue. Sync is cron → internal HTTP → Marketing API → upsert.

Cutover (turning off Apps Script / the Sheet) is **out of scope**. Do not do it automatically.

---

## 2. Same token / same account

1. Copy the existing Apps Script `META_V2_ACCESS_TOKEN` into private `.env` as `META_ACCESS_TOKEN`.
2. Copy the existing `META_V2_AD_ACCOUNT_ID` into `META_AD_ACCOUNT_ID`.
3. Leave Script Properties, triggers, and the Sheet exactly as they are.
4. Do not create a second Meta app. Do not regenerate or revoke the token.
5. If Meta returns 401/403: mark the run failed, store a sanitized error, do not refresh the token.

Store the token only in:

- local `.env` / `.env.local`
- production server environment

Never in GitHub, `.env.example` values, SQL, views, `NEXT_PUBLIC_*`, API responses, logs, tests, or README.

---

## 3. Environment (names only)

```
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
META_API_VERSION=v23.0
META_SYNC_ENABLED=false
META_INTERNAL_SYNC_SECRET=
META_BACKFILL_DAYS=90
META_BACKFILL_CHUNK_DAYS=3
META_PAGE_LIMIT=500
META_MAX_RETRIES=5
META_RECENT_REPAIR_DAYS=2
META_EXTENDED_INSIGHTS_ENABLED=false
META_METADATA_SYNC_ENABLED=false
META_BREAKDOWN_SYNC_ENABLED=false
```

`META_API_VERSION` defaults to `v23.0` for Sheet parity. Changing version is an explicit decision.

`META_RECENT_REPAIR_DAYS=2` means three calendar dates: day before yesterday + yesterday + today.

Meta env is validated lazily when a Meta route/module runs. Missing Meta credentials do not break Shiprocket or Shopify startup.

---

## 4. Manual environment setup

1. `cp .env.example .env`
2. Paste the existing Meta token and ad account id into `.env` only.
3. Set `META_INTERNAL_SYNC_SECRET` to a long random string.
4. Keep `META_SYNC_ENABLED=false` until a one-day test succeeds.
5. Apply SQL migrations `013` → `017` after `001` → `012`.
6. Confirm the Supabase Data API exposes schema `analytics`.

---

## 5. Grain and storage

Canonical fact: **one ad on one date** for one ad account.

Unique key:

```
(ad_account_id, date, campaign_id, adset_id, ad_id)
```

IDs are authoritative. Names are attributes.

All returned `actions[]` / `action_values[]` are stored as rows in:

- `data_pipeline.meta_ads_actions_daily`
- `data_pipeline.meta_ads_action_values_daily`

No complete raw Insights JSON is stored. No access token is stored in PostgreSQL.

Zero-row API responses do **not** delete existing facts. Upsert only.

---

## 6. Sync modes

All internal routes require:

```
Authorization: Bearer <META_INTERNAL_SYNC_SECRET>
```

| Mode | Route | Notes |
|---|---|---|
| Test | `POST /api/internal/meta/sync/test` | Max 3 days. Body `{ "since", "until" }` optional |
| Today | `POST /api/internal/meta/sync/today` | Requires `META_SYNC_ENABLED=true` |
| Recent | `POST /api/internal/meta/sync/recent` | 3 calendar dates |
| Repair | `POST /api/internal/meta/sync/repair` | Body `{ "since", "until" }`. Upsert only |
| Backfill | `POST /api/internal/meta/sync/backfill` | 90 days, 3-day chunks, upsert, resumable |
| Resume | `POST /api/internal/meta/sync/backfill/resume` | Continues `next_chunk_start` |
| Metadata | `POST /api/internal/meta/sync/metadata` | Campaigns / ad sets / ads / creatives |
| Breakdowns | `POST /api/internal/meta/sync/breakdowns` | Placement / device / demo / geo |
| Status | `GET /api/internal/meta/sync/status` | Watermarks + latest run |

Do **not** run the Apps Script 90-day backfill and this backfill at the same time.

Core Insights stay on the Apps Script field list plus `use_unified_attribution_setting=true`.

Extended Insights, metadata, and breakdowns are optional. Their failure does not fail core `meta_ads_daily` sync.

---

## 7. Cron templates (placeholders only)

Prefer an offset from Apps Script (`:00/:15/:30/:45`):

```sql
SELECT cron.schedule(
  'meta-today-sync',
  '7,22,37,52 * * * *',
  $$
  SELECT net.http_post(
    url := '<DATA_PIPELINE_APP_URL>/api/internal/meta/sync/today',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <META_INTERNAL_SYNC_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'meta-recent-repair',
  '12 0,12 * * *',
  $$
  SELECT net.http_post(
    url := '<DATA_PIPELINE_APP_URL>/api/internal/meta/sync/recent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <META_INTERNAL_SYNC_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Do not assume the cron runner is IST. Align twice-daily repair to the **Meta ad account reporting timezone**.

Locally, `npm run dev` with `META_SYNC_ENABLED=true` starts an in-process 15-minute today sync (Shopify scheduler is unchanged).

Backfill is not a recurring cron. Metadata and breakdowns can stay manual at first.

---

## 8. Dashboard

1. URL: `/dashboard/meta`
2. Auth: HTTP Basic (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`)
3. Browser never calls the Meta API.
4. Charts: KPIs, daily trend, funnel, campaign / ad set / ad tables, video, action explorer, sync health.
5. Breakdown panels show “Breakdown sync not enabled” until that flag is on and data exists.
6. Currency/timezone come from `data_pipeline.meta_ad_accounts`, not a hardcoded INR or server TZ.

---

## 9. Security

1. Canonical tables: service-role writes only. RLS enabled. No anon writes.
2. Analytics views: select for `service_role` / `authenticated`.
3. Internal sync uses timing-safe Bearer compare.
4. Logs may include `run_id`, mode, date range, page count, retries. Never token, Authorization, or raw bodies.

---

## 10. Campaign Type

There is no current business rule. Analytics expose `campaign_type = 'Unclassified'`. Month and week are derived from `date`.
