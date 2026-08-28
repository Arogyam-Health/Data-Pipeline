# Meta Ads pipeline

This is the complete reference for the Meta Ads work in this repo: why it exists, the plan that was implemented, architecture, strategy, key terms, data model, sync modes, APIs, dashboard, and file map.

Operational setup (env names, cron templates): [`META_SETUP.md`](./META_SETUP.md).  
Sheet vs Supabase checks: [`META_VALIDATION.md`](./META_VALIDATION.md).

**Secrets:** this file uses placeholders only. Never put tokens, project URLs, webhook keys, or filled cron SQL here or in migrations.

---

## 1. Problem and goal

The live Meta flow today is:

```
Meta Marketing API
  → Google Apps Script (existing token + ad account)
  → Google Sheet tab "Meta Report"
```

That Sheet is production. This repo does **not** replace it.

The pipeline is a **second read-only consumer** of the **same existing** Meta access token and ad account. It pulls Insights into PostgreSQL so the team can filter, chart, and keep history without depending on Sheets row limits or Apps Script timeouts.

What this repo does:

1. Pull ad-level daily Insights from the Meta Marketing / Graph API.
2. Normalize and upsert into `data_pipeline.meta_*`.
3. Expose analytics as SQL views/functions in `analytics.meta_*`.
4. Serve `/dashboard/meta` (Next.js + Recharts).
5. Leave Apps Script, Script Properties, triggers, and the Sheet untouched.

What this repo does **not** do:

1. Read or write the Google Sheet.
2. Create a second Meta app or regenerate/revoke the token.
3. Store the access token in PostgreSQL.
4. Store complete raw Insights JSON.
5. Delete existing facts when Meta returns zero rows (upsert only).
6. Cut over production off Apps Script. That needs explicit human approval later.

---

## 2. Implementation plan (what was built)

Work was sequenced so Shiprocket and Shopify stay isolated. Meta is its own module, own tables, own cron, own dashboard.

| Phase | What | Status |
|---|---|---|
| **0. Isolation** | New `src/modules/meta/`. Migrations `013`–`017` do not alter Shiprocket or Shopify tables/views. Missing Meta env does not crash those pipelines. | Done |
| **1. Token reuse** | Copy the existing Apps Script token/account into private server env as `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID`. No OAuth flow in this app. | Done |
| **2. Canonical schema** | Sync state, runs, locks, errors, backfill jobs, account/campaign/ad set/ad/creative dimensions, daily facts, action rows, optional breakdown tables. | Done (`013`, `014`) |
| **3. Graph client** | Bearer header (token never in the URL), paging, retry/backoff, sanitized errors, invalid-field handling. | Done |
| **4. Core Insights sync** | Ad-level, `time_increment=1`, Apps Script field list + `use_unified_attribution_setting=true`. Modes: test / today / recent repair / repair / backfill. | Done |
| **5. Normalize + upsert** | One fact per ad per date. Flatten `actions[]` / `action_values[]`. Stub campaign/ad set/ad rows from Insights IDs. | Done |
| **6. Optional extras** | Extended Insights (video/quality/clicks/engagement), metadata sync, placement/device/demo/geo breakdowns. Failures do not fail core parity. | Done, flags default off |
| **7. Analytics SQL** | Views for sheet parity, KPIs, funnel, video, actions, breakdowns, sync health. Date-range functions for the dashboard. | Done (`015`, `016`) |
| **8. Dashboard** | `/dashboard/meta` with HTTP Basic. Browser never calls Meta. Charts read `/api/meta/analytics/*`. | Done |
| **9. Query filters** | SQL-side filters (campaign / ad set / ad / objective / search / purchase / video / funnel / messaging / spend / ROAS / frequency). | Done (`017`) |
| **10. Parallel validation** | Compare Sheet **Meta Report** to `analytics.meta_ads_sheet_parity` before enabling scheduled sync. | Process in `META_VALIDATION.md` |
| **11. Cutover** | Turn off Apps Script / retire the Sheet. | **Out of scope** |

Recommended enable order (do not skip):

1. Apply migrations `013` → `017`. Expose schema `analytics` in the Supabase Data API.
2. Fill Meta placeholders in private `.env` only. Keep `META_SYNC_ENABLED=false`.
3. One-day `test` sync.
4. Compare that date to the Sheet.
5. `recent` repair (three calendar dates). Compare again.
6. 90-day backfill **only if** Apps Script is not also backfilling.
7. Set `META_SYNC_ENABLED=true` and run in parallel.
8. Sheet retirement only after explicit approval.

---

## 3. Architecture

There is **no Meta PGMQ queue**. Shiprocket is webhook-push (queue + Edge worker). Meta is API-pull, like Shopify.

```
META AD ACCOUNT
        │
 Marketing / Graph API   (same existing token + act_ id)
       / \
      /   \
 Apps Script          This repo
      │                 META_ACCESS_TOKEN in private .env
      │                 │
 Google Sheet           MetaGraphClient
 "Meta Report"            → Insights / metadata / breakdowns
      │                   → normalize
      │                   → upsert data_pipeline.meta_*
      │                   → analytics.meta_*
      │                   → /dashboard/meta
      │
   UNCHANGED
```

### 3.1 Runtime paths

**Manual / cron pull**

```
POST /api/internal/meta/sync/<mode>
  → Bearer META_INTERNAL_SYNC_SECRET
  → acquire DB lock
  → Graph API
  → normalize
  → upsert
  → write sync_run + watermarks
  → release lock
```

**Local scheduler** (`npm run dev` and `META_SYNC_ENABLED=true`)

```
instrumentation.ts
  → startMetaScheduler()
  → after 20s: today sync
  → every 15 minutes: today sync
  → every 12 hours: recent repair
```

Shopify’s scheduler is unchanged.

**Cloud scheduler** (after the app has a public URL)

```
Supabase pg_cron (offset minutes, not :00/:15/:30/:45)
  → POST <DATA_PIPELINE_APP_URL>/api/internal/meta/sync/today
  → POST <DATA_PIPELINE_APP_URL>/api/internal/meta/sync/recent
```

Cron SQL is a **template only**. Fill the URL and Bearer secret in the Supabase SQL Editor, never in a migration or git file. See `META_SETUP.md`.

**Dashboard read path**

```
Browser /dashboard/meta
  → HTTP Basic (DASHBOARD_USERNAME / DASHBOARD_PASSWORD)
  → GET /api/meta/analytics/*
  → service-role RPC on analytics.meta_*_for_range / *_filtered
  → JSON → Recharts
```

The browser never talks to `graph.facebook.com`.

### 3.2 Why no queue

Meta is a scheduled pull. There is no inbound webhook burst to acknowledge. A queue would add a worker without changing the API-rate or upsert problem. Locking + chunked backfill is enough.

---

## 4. Strategy

| Decision | Why |
|---|---|
| **Parallel, not replace** | Production Sheet stays live. This is a second reader. |
| **Reuse existing token/account** | Avoids a second Meta app, new OAuth, and risk of revoking the live Apps Script token. |
| **Token only in server env** | Never `NEXT_PUBLIC_*`, never SQL, never API responses, never logs. |
| **Bearer header, not query string** | Graph paging URLs can contain `access_token`; the client strips it before follow and before logs. |
| **Ad × date grain** | Matches the Sheet unique key (Campaign ID + Ad set ID + Ad ID + Date), plus `ad_account_id`. |
| **IDs authoritative, names attributes** | Campaign/ad set/ad names can change; IDs do not. |
| **Upsert only** | Zero-row responses do not delete history. Repair overwrites the same key. |
| **Store every action type** | Sheet keeps a subset of columns. This pipeline stores the full `actions[]` / `action_values[]` so new pixels do not require a schema change. |
| **No raw JSON blob** | Normalized columns only. Smaller, queryable, no token-bearing payloads on disk. |
| **Core first, extras optional** | Sheet parity uses the core field list. Extended Insights, metadata, and breakdowns can fail without failing core sync. |
| **Chunked resumable backfill** | 90 days in 3-day chunks. Survives rate limits and process restarts via `meta_backfill_jobs.next_chunk_start`. |
| **One lock per ad account** | Prevents overlapping today/repair/backfill on the same account. TTL 15 minutes. |
| **Do not overlap Apps Script 90-day clear** | Apps Script backfill clears the Sheet tab. This pipeline upserts. Running both 90-day jobs at once makes validation meaningless. |
| **Account timezone, not server TZ** | “Today” and recent-repair dates use `meta_ad_accounts.timezone_name` (fallback UTC). |
| **Account currency, not hardcoded INR** | KPI money uses stored account currency. The UI falls back to `INR` only if currency is missing. |
| **Campaign Type = Unclassified** | No current business rule. Month/week are derived from `date`. |
| **Offset cron** | Apps Script uses `:00/:15/:30/:45`. This app prefers `:07/:22/:37/:52` so both can hit Meta without colliding. |
| **Lazy Meta env** | Meta Zod validation runs when a Meta route/module runs. Empty Meta env does not break Shiprocket or Shopify startup. |

---

## 5. Key terms

| Term | Meaning in this codebase |
|---|---|
| **Ad account** | Meta Ads account. Env value looks like `act_123` (digits-only is normalized to `act_…`). |
| **Campaign / Ad set / Ad** | Meta hierarchy. Insights are requested at **ad** level so all three IDs are present. |
| **Creative** | Ad creative metadata (title, body, CTA, thumbnail). Filled only by optional metadata sync. |
| **Insights** | Marketing API performance rows (spend, impressions, actions, …) for a date range. |
| **Core Insights** | Field list aligned with Apps Script / Sheet columns, plus unified attribution. Always fetched. |
| **Extended Insights** | Extra field groups: video quartiles, quality rankings, unique/outbound clicks, page/post engagement. Off by default. |
| **Breakdowns** | Same facts split by placement, device, age/gender, or country. Separate tables. Off by default. |
| **Actions / action values** | Meta arrays on each Insights row. Count vs conversion value for each `action_type` (purchase, add_to_cart, …). |
| **Parity actions** | Mapped subsets used as Sheet columns: purchases, ATC, checkout, LPV, messaging, registrations, instant experience, ROAS. |
| **Grain / unique key** | One row per `(ad_account_id, date, campaign_id, adset_id, ad_id)`. |
| **Watermark** | Timestamps on `meta_sync_state` for last successful today / recent repair / backfill. |
| **Sync run** | One execution audit row in `meta_sync_runs` (`running` / `success` / `partial` / `failed`). |
| **Partial** | Core (or requested) work finished, but a warning was recorded (optional extra skipped). |
| **Lock** | Row in `meta_sync_locks`. Only one sync per ad account until TTL expiry or release. |
| **Backfill job** | Multi-chunk historical pull. Status: pending / running / paused / completed / failed / cancelled. |
| **Resume** | Continue from `next_chunk_start` instead of starting a new 90-day window. |
| **Test sync** | Manual, max 3 days, allowed while `META_SYNC_ENABLED=false`. |
| **Today sync** | Current calendar date in the **ad account timezone**. Requires `META_SYNC_ENABLED=true` when scheduled. |
| **Recent repair** | `META_RECENT_REPAIR_DAYS=2` → three dates: day-before-yesterday + yesterday + today. Re-upserts because Meta attribution can still change. |
| **Repair** | Manual `since`/`until` upsert. Capped at `META_BACKFILL_DAYS`. |
| **Metadata sync** | Campaigns, ad sets, ads, creatives from Graph (not Insights). |
| **Unified attribution** | Request flag `use_unified_attribution_setting=true` so numbers match the current Ads Manager / Sheet setting. |
| **Sheet parity view** | `analytics.meta_ads_sheet_parity` — column names aligned with the **Meta Report** tab for side-by-side checks. |
| **Internal secret** | Bearer token for `/api/internal/meta/*`. Different from the Meta access token. |
| **Dashboard Basic auth** | HTTP Basic for `/dashboard/meta` and `/api/meta/*`. Same pair as Shopify dashboard. |
| **Service role** | Supabase role used by the Next.js server to write canonical tables and call analytics RPCs. Anon cannot write Meta tables. |
| **Sanitization** | Strip tokens, `access_token=`, `Bearer …`, and token-bearing URLs from errors/logs. |

---

## 6. Environment (names and meaning only)

Copy `.env.example`. Leave values empty in git. Fill only in private `.env`.

| Variable | Role |
|---|---|
| `META_ACCESS_TOKEN` | Existing Apps Script Marketing API token. Server-side only. |
| `META_AD_ACCOUNT_ID` | Existing ad account (`act_…` or digits). |
| `META_API_VERSION` | Default `v23.0` (Sheet parity). Changing version is an explicit decision. |
| `META_SYNC_ENABLED` | Default `false`. Must be `true` for scheduled today/recent sync. |
| `META_INTERNAL_SYNC_SECRET` | Bearer for `/api/internal/meta/*`. |
| `META_BACKFILL_DAYS` | Default `90`. |
| `META_BACKFILL_CHUNK_DAYS` | Default `3`. |
| `META_PAGE_LIMIT` | Insights page size, default `500`, max `1000`. |
| `META_MAX_RETRIES` | Default `5`. Backoff 3s, 6s, 12s, 24s, 48s + jitter (Apps Script style). |
| `META_RECENT_REPAIR_DAYS` | Default `2` (three calendar dates). |
| `META_EXTENDED_INSIGHTS_ENABLED` | Default `false`. |
| `META_METADATA_SYNC_ENABLED` | Default `false`. |
| `META_BREAKDOWN_SYNC_ENABLED` | Default `false`. |

Dashboard auth (shared with Shopify): `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`.

Writes also need `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (already used by Shiprocket/Shopify).

---

## 7. Sync modes

All internal routes require:

```
Authorization: Bearer <META_INTERNAL_SYNC_SECRET>
```

| Mode | Route | Enabled flag | Window | Notes |
|---|---|---|---|---|
| Test | `POST /api/internal/meta/sync/test` | Not required | Max 3 days; body `{ "since", "until" }` optional (defaults to today) | First validation run |
| Today | `POST /api/internal/meta/sync/today` | Required | Account-timezone today | Local + cloud scheduler |
| Recent | `POST /api/internal/meta/sync/recent` | Required | 3 calendar dates | Attribution can still move |
| Repair | `POST /api/internal/meta/sync/repair` | Required | Body `{ "since", "until" }` | Upsert only; max `META_BACKFILL_DAYS` |
| Backfill | `POST /api/internal/meta/sync/backfill` | Not required | 90 days, 3-day chunks | Creates a job; one chunk per call |
| Resume | `POST /api/internal/meta/sync/backfill/resume` | Not required | Next remaining chunk | Uses `next_chunk_start` |
| Metadata | `POST /api/internal/meta/sync/metadata` | Not required | n/a | Campaigns / ad sets / ads / creatives |
| Breakdowns | `POST /api/internal/meta/sync/breakdowns` | Breakdown flag | Body dates or today | Placement / device / demo / geo |
| Status | `GET /api/internal/meta/sync/status` | — | — | Watermarks + latest run + backfill + account |

Today / recent / repair refuse to start if a backfill job is still active.

### 7.1 One core sync (what happens)

1. Validate env. Optionally require `META_SYNC_ENABLED`.
2. Acquire `try_acquire_meta_sync_lock`.
3. Refresh account metadata (timezone, currency). On non-auth failure, use stored timezone and warn.
4. Resolve date range in that timezone.
5. Insert `meta_sync_runs` as `running`.
6. `GET /{ad-account}/insights` — level `ad`, `time_increment=1`, core fields, unified attribution.
7. If extended flag on: extra field-group calls; merge onto core rows. Invalid-field groups are skipped.
8. Normalize each row → daily fact + action rows + action-value rows. Drop rows missing date or IDs.
9. Dedupe daily key. Upsert campaign/ad set/ad stubs from Insights names.
10. Upsert facts and actions.
11. If breakdown flag on (and not test): four breakdown pulls; failures become warnings.
12. Finish run `success` or `partial`. Update watermarks. Release lock.

Auth 401/403: fail the run, store a sanitized error, **do not** refresh or rotate the token.

---

## 8. Data model

Migrations: `013` schema, `014` indexes + RLS, `015` views, `016` date-range functions, `017` filtered functions.

Portable SQL: no project IDs, URLs, or secrets.

### 8.1 Sync / ops (`data_pipeline`)

| Table | Purpose |
|---|---|
| `meta_sync_state` | Per-account watermarks, timezone, currency, last warning |
| `meta_sync_runs` | Per-execution audit and counts |
| `meta_sync_locks` | One lock per ad account + TTL |
| `meta_sync_errors` | Per-run error rows |
| `meta_backfill_jobs` | Chunk cursor and job status |

### 8.2 Dimensions

| Table | Purpose |
|---|---|
| `meta_ad_accounts` | Name, currency, timezone |
| `meta_campaigns` | Campaign attributes |
| `meta_adsets` | Ad set attributes |
| `meta_ads` | Ad attributes + optional creative id |
| `meta_creatives` | Creative copy / media fields |

Insights sync writes **stubs** (id + name + objective) so facts have parents before a full metadata sync.

### 8.3 Facts

| Table | Grain |
|---|---|
| `meta_ads_daily` | Ad × date (canonical) |
| `meta_ads_actions_daily` | Ad × date × `action_type` (counts) |
| `meta_ads_action_values_daily` | Ad × date × `action_type` (conversion value) |
| `meta_ads_placement_daily` | Ad × date × publisher_platform × platform_position |
| `meta_ads_device_daily` | Ad × date × impression_device |
| `meta_ads_demographic_daily` | Ad × date × age × gender |
| `meta_ads_geo_daily` | Ad × date × country × region |

Canonical unique key:

```
(ad_account_id, date, campaign_id, adset_id, ad_id)
```

`meta_ads_daily` stores both Meta-provided metrics (spend, impressions, reach, frequency, CTR, CPC, CPM, …) and **mapped parity columns** (purchases, ATC, checkout, LPV, messaging, registrations, ROAS, video quartiles).

### 8.4 Security

- RLS on canonical tables: `service_role` only.
- Analytics views: `SELECT` for `service_role` and `authenticated`.
- Filtered/range functions: `EXECUTE` for `service_role`.
- No anon writes.

---

## 9. Analytics layer

Definitions live in PostgreSQL so the dashboard and any later BI tool share the same math. Division is null when the denominator is 0 (never Infinity).

### 9.1 Views (`015`)

| View | Use |
|---|---|
| `analytics.meta_ads_daily` | Denormalized daily facts + derived month/week + `campaign_type = 'Unclassified'` |
| `analytics.meta_ads_sheet_parity` | Sheet-column names for validation |
| `analytics.meta_ads_kpis` | Single-row all-time snapshot |
| `analytics.meta_ads_daily_summary` | Spend / purchases / ROAS by date |
| `analytics.meta_campaign_performance` | Campaign rollup |
| `analytics.meta_adset_performance` | Ad set rollup |
| `analytics.meta_ad_performance` | Ad rollup |
| `analytics.meta_ads_funnel` | Impressions → clicks → LPV → ATC → checkout → purchase |
| `analytics.meta_ads_video_performance` | Plays, quartiles, ThruPlay, retention |
| `analytics.meta_ads_objective_performance` | By campaign objective |
| `analytics.meta_ads_action_performance` | All stored action types |
| `analytics.meta_ads_placement_performance` | Optional breakdown |
| `analytics.meta_ads_device_performance` | Optional breakdown |
| `analytics.meta_ads_demographic_performance` | Optional breakdown |
| `analytics.meta_ads_geo_performance` | Optional breakdown |
| `analytics.meta_ads_recent` | Latest fact rows |
| `analytics.meta_ads_sync_health` | Watermarks + last run |
| `analytics.meta_ads_creative_performance` | Joins creatives when metadata exists |

### 9.2 Date-range functions (`016`)

`analytics.meta_ads_kpis_for_range`, `meta_ads_daily_for_range`, campaign / ad set / ad / funnel / video / action / placement / device / demographic / geo `*_for_range(p_from, p_to)`.

### 9.3 Filtered functions (`017`)

Same metrics with optional identity + metric filters. Identity filters apply to facts in range. Purchase / spend / ROAS / frequency / video / funnel / messaging apply at **ad-in-range** grain (an ad is included if its totals in the range match).

Filter options for dropdowns: `analytics.meta_ads_filter_options(p_from, p_to)`.

---

## 10. Dashboard

- URL: `/dashboard/meta`
- Auth: HTTP Basic (same as Shopify)
- Default range: last 30 account-timezone days (`today` / `7d` / `30d` / `90d` / custom)
- Filters run in SQL and apply to KPIs, charts, and tables together

**Filters**

- Campaign, ad set, ad, objective (cascading dropdowns)
- Name search
- Purchase: all / with / without
- Video: all / has video
- Funnel: all / has LPV / has ATC / has checkout
- Messaging: all / with / without
- Min/max spend, ROAS, frequency; min purchases
- Sort: spend, purchases, ROAS, CTR, frequency, name

**Panels**

- KPI cards: spend, impressions, reach, frequency, clicks, LPV, CTR, CPC, CPM, ATC, checkouts, purchases, CPA, purchase value, ROAS
- Daily spend / purchases / ROAS chart
- Funnel
- Campaign, ad set, and ad tables (click a row to filter)
- Video retention table
- Action-type explorer (every stored `action_type`, not only Sheet columns)
- Placement / device / demographic / geo (or “Breakdown sync not enabled”)
- Sync health (watermarks, last error, currency, timezone)

Empty state explains how to run a test sync. It shows the Bearer **placeholder**, not a real secret.

If `017` is not applied, the page can still load unfiltered data and shows that SQL filters are not ready.

---

## 11. HTTP API

### 11.1 Internal (Bearer `<META_INTERNAL_SYNC_SECRET>`)

| Method | Path |
|---|---|
| POST | `/api/internal/meta/sync/test` |
| POST | `/api/internal/meta/sync/today` |
| POST | `/api/internal/meta/sync/recent` |
| POST | `/api/internal/meta/sync/repair` |
| POST | `/api/internal/meta/sync/backfill` |
| POST | `/api/internal/meta/sync/backfill/resume` |
| POST | `/api/internal/meta/sync/metadata` |
| POST | `/api/internal/meta/sync/breakdowns` |
| GET | `/api/internal/meta/sync/status` |

Responses return counts (`rowsFetched`, `pagesFetched`, `apiRequests`, `retryCount`, `warning`). They never return the access token.

### 11.2 Dashboard (HTTP Basic)

| Method | Path |
|---|---|
| GET | `/api/meta/analytics/overview` |
| GET | `/api/meta/analytics/daily` |
| GET | `/api/meta/analytics/campaigns` |
| GET | `/api/meta/analytics/adsets` |
| GET | `/api/meta/analytics/ads` |
| GET | `/api/meta/analytics/funnel` |
| GET | `/api/meta/analytics/video` |
| GET | `/api/meta/analytics/actions` |
| GET | `/api/meta/analytics/placements` |
| GET | `/api/meta/analytics/devices` |
| GET | `/api/meta/analytics/demographics` |
| GET | `/api/meta/analytics/geo` |
| GET | `/api/meta/sync/status` |

Query: `from`, `to`, `range`, plus the filter fields in §10.

---

## 12. Code map

```
src/modules/meta/
  env.ts             Zod env, act_ normalization, lazy cache
  constants.ts       Fields, action-type groups, backoff, limits
  types.ts           Sync modes, Insight/normalized row types
  errors.ts          Typed errors + secret sanitization
  retry.ts           Retry-After + Apps Script-style backoff
  pagination.ts      Next URL, loop detection, page cap (500)
  client.ts          Graph GET, Bearer header, paging, retries
  fields.ts          Core / extended / breakdown field lists
  actions.ts         Sum/map action types for Sheet parity
  dates.ts           Account-timezone today, repair, backfill chunks
  insights.ts        Core / extended / breakdown fetches + merge
  normalizer.ts      Insight row → daily + actions + values
  metadata.ts        Account + campaigns / ad sets / ads / creatives
  repository.ts      Supabase upserts, sync runs, watermarks
  locking.ts         Acquire/release lock, backfill conflict rules
  sync.ts            Orchestrates every mode except chunk planning
  backfill.ts        Job create / resume / one chunk
  scheduler.ts       Local 15-min today + 12-hour recent repair
  internal-auth.ts   Timing-safe Bearer + Basic helpers
  http.ts            Error JSON, dashboard query schema, public result
  dashboard-route.ts Shared auth + range + filter wrapper
  analytics.ts       RPC loaders for dashboard routes
  filters.ts         Filter object → RPC args
  index.ts           Public exports

app/api/internal/meta/sync/…   Trigger routes
app/api/meta/analytics/…       Dashboard JSON
app/dashboard/meta/page.tsx    Recharts UI
instrumentation.ts             Starts Meta scheduler next to Shopify
proxy.ts                       HTTP Basic for /dashboard/meta and /api/meta

supabase/migrations/
  013_meta_ads_schema.sql
  014_meta_ads_indexes_security.sql
  015_meta_ads_analytics.sql
  016_meta_ads_dashboard_functions.sql
  017_meta_ads_filters.sql

src/__tests__/meta.test.ts     Client, normalize, dates, auth, sanitization
```

---

## 13. Graph API behavior

- Base: `https://graph.facebook.com/{META_API_VERSION}/`
- Auth: `Authorization: Bearer <token>` (never `access_token` query)
- Insights path: `{ad_account_id}/insights`
- Always: `level=ad`, `time_increment=1`, `use_unified_attribution_setting=true`
- Paging: follow `paging.next` after stripping tokens; stop on repeat URL or 500 pages
- Sleep ~300ms between pages
- Retry: 429 / 5xx / network / classified retryable Graph codes; honor `Retry-After`
- Invalid field (code 100 / subcode 33-style): skip that optional group; do not fail core
- Auth/permission: fail closed, sanitized message, no token refresh

Core fields (Sheet-aligned): date, campaign/ad set/ad ids and names, objective, spend, impressions, reach, frequency, clicks, inline link clicks/CTR, CTR, CPC, CPM, cost per link click, actions, action_values, purchase ROAS, website purchase ROAS, video avg play, video 25% / 95%.

---

## 14. Action-type mapping (parity)

Stored **all** action types. These groups populate Sheet-like columns:

| Column idea | Action types (any match is summed) |
|---|---|
| Purchases | `purchase`, `omni_purchase`, `offsite_conversion.fb_pixel_purchase` |
| Website purchases | `offsite_conversion.fb_pixel_purchase` |
| Adds to cart | `add_to_cart`, `omni_add_to_cart`, `offsite_conversion.fb_pixel_add_to_cart` |
| Checkouts | `initiate_checkout`, `omni_initiated_checkout`, `offsite_conversion.fb_pixel_initiate_checkout` |
| Landing page views | `landing_page_view` |
| Messaging conversations | messaging conversation / first-reply action types |
| Registrations | `complete_registration` and omni / pixel variants |
| Instant experience % | `instant_experience_view_percentage` |

ROAS uses Meta’s `purchase_roas` / `website_purchase_roas` arrays (first value).

---

## 15. Security rules

1. Never commit `.env`. Never force-add it.
2. Never put project URLs or secrets in `supabase/migrations/*`.
3. Never prefix secrets with `NEXT_PUBLIC_`.
4. Token is not written to PostgreSQL and is not returned by APIs.
5. Internal sync: timing-safe Bearer compare.
6. Dashboard / `/api/meta/*`: HTTP Basic.
7. Logs may include `run_id`, mode, date range, page count, retries. Never token, Authorization header, or raw Graph bodies.
8. On 401/403: do not rotate the shared Apps Script token from this app.

---

## 16. What is intentionally not in this code

- Google Ads
- Meta webhooks / Conversions API write-back
- Creating, pausing, or editing ads
- Token refresh / long-lived token exchange
- PGMQ / Edge Function worker for Meta
- Automatic Sheet cutover
- A Campaign Type classifier
- Storing full raw Insights JSON
- A second Meta app

---

## 17. Related docs

1. [`META_SETUP.md`](./META_SETUP.md) — env checklist, cron templates, short security list.
2. [`META_VALIDATION.md`](./META_VALIDATION.md) — Meta Report vs `analytics.meta_ads_sheet_parity`.
3. [`README.md`](./README.md) — all three pipelines (Shiprocket, Shopify, Meta).
4. [`.env.example`](./.env.example) — empty Meta placeholders.
