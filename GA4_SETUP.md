# GA4 setup

Parallel migration from Google Apps Script / Google Sheets to Next.js + Supabase.

**The existing Apps Script pipelines and Google Sheets stay live.** This app does not write to Sheets, does not change Script Properties, and does not cut over automatically.

Authentication is **Vercel OIDC → Google Workload Identity Federation → service-account impersonation**. There is no Google private key and no service-account JSON.

---

## 1. Datasets

| Dataset | Legacy sheet | Grain | Dimensions |
| --- | --- | --- | --- |
| Daily | Direct GA4 Link | property + date | `date` |
| Channel | Direct GA4 Channel Link | property + date + channel | `date`, `sessionDefaultChannelGroup` |
| UTM | Direct GA4 UTM Link | property + date + source + campaign + medium + content | `date`, `sessionManualSource`, `sessionManualCampaignName`, `sessionManualMedium`, `sessionManualAdContent` |

Blank dimensions normalize to `(not set)`. UTM rows where all four UTM dimensions are `(not set)` are dropped. `utm_key` is `source||campaign||medium||content` and is **not** the unique constraint.

---

## 2. Metrics (two-request merge)

Base request:

`sessions`, `engagedSessions`, `engagementRate`, `bounceRate`, `totalUsers`, `newUsers`, `screenPageViews`, `ecommercePurchases`, `totalRevenue`

Ecommerce request:

`addToCarts`, `itemsAddedToCart`, `checkouts`

Mapped columns: `sessions`, `engaged_sessions`, `engagement_rate`, `bounce_rate`, `users`, `new_users`, `views`, `purchases`, `revenue`, `add_to_carts`, `items_added_to_cart`, `begin_checkout`.

Merge keys: daily=`date`; channel=`date+channel`; UTM=full UTM grain. A base-only row stores ecommerce = 0. An ecommerce-only row stores base = 0.

Rates are stored as decimals (`0.993`, not `99.3`). Revenue is numeric (`5800.0000`), never `₹5,800.00`.

---

## 3. WIF architecture

```
Vercel (OIDC token at request time)
  → Google STS (external account)
  → impersonate GCP_SERVICE_ACCOUNT_EMAIL
  → Google Analytics Data API
  → normalize / merge
  → data_pipeline.ga4_*
  → analytics.ga4_*
  → /dashboard/ga4 and Metabase
```

Required Google APIs on the GCP project: IAM Credentials, Security Token Service, Analytics Data API.

The GA4 service account must be added as **Viewer** (read-only) on `GA4_PROPERTY_ID`. This repo does not change GA4 permissions.

---

## 4. Environment variable names only

See `.env.example`. Never commit real values. Never use `NEXT_PUBLIC_*`.

Do **not** add:

- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

---

## 5. Local development

The app is not required to have a live Vercel token for compile/tests.

For a live local sync after the Vercel project exists:

```bash
vercel link
vercel env pull
npm run dev
```

If a live sync is attempted without an OIDC token, the API returns a safe authentication-configuration error. There is no private-key fallback.

---

## 6. Vercel deployment (manual)

1. Link/deploy this repo to Vercel.
2. Project Settings → Security → **Secure Backend Access with OIDC Federation** → **Team issuer mode**.
3. Configure the Google WIF provider against the Vercel Team issuer.
4. Production subject is conceptually:

   `owner:<TEAM_SLUG>:project:<PROJECT_NAME>:environment:production`

5. Grant `roles/iam.workloadIdentityUser` on the GA4 service account **only** to that project/environment identity. Do not grant the entire pool unrestricted impersonation.

Recommended recent-sync cron after deploy (offset from Apps Script `:00/:15/:30/:45`):

```
7,22,37,52 * * * *
```

Call `POST /api/internal/ga4/sync/recent` with `Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>`.

Automatic sync does nothing until `GA4_SYNC_ENABLED=true`.

---

## 7. Internal APIs

All require `Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>`.

| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/api/internal/ga4/connection-test` | Smallest Data API call + WIF |
| POST | `/api/internal/ga4/sync/test` | Max 3 days; `{dataset,since,until}` |
| POST | `/api/internal/ga4/sync/recent` | Last 3 inclusive dates; all datasets |
| POST | `/api/internal/ga4/sync/repair` | UPSERT only; max 31 days |
| POST | `/api/internal/ga4/compatibility` | Safe metric/dimension compatibility |
| POST | `/api/internal/ga4/backfill/start` | Rejects a second active job |
| POST | `/api/internal/ga4/backfill/resume` | Continues from `next_chunk_start` |
| POST | `/api/internal/ga4/backfill/cancel` | Marks job cancelled |
| GET | `/api/internal/ga4/backfill/status?dataset=` | Active job |

Recent scheduled calls return a safe disabled payload when `GA4_SYNC_ENABLED` is not `true`. Manual test/repair/backfill/connection remain usable. Pass `{"force":true}` on recent to run it before enabling the schedule.

---

## 8. Backfill defaults

- Daily: 90 days back, 3-day chunks
- Channel: 90 days back, 3-day chunks
- UTM: from `GA4_UTM_BACKFILL_START_DATE` (default `2025-10-14`), 30-day chunks

UPSERT only. Never truncate. State lives in PostgreSQL so a restart can resume.

Recent refresh uses `GA4_RECENT_DAYS_BACK=2` → today + yesterday + day-before (3 inclusive dates).

---

## 9. Database / analytics / Metabase

Canonical writes: `data_pipeline.ga4_*` (service_role only, RLS enabled).

Reporting: `analytics.ga4_daily`, `analytics.ga4_channel_daily`, `analytics.ga4_utm_daily`, `analytics.ga4_overview`, `analytics.ga4_channel_performance`, `analytics.ga4_utm_performance`, `analytics.ga4_funnel`, `analytics.ga4_sync_health`, plus `*_sheet_parity` views.

Date-range RPCs: `analytics.ga4_overview_range`, `ga4_daily_range`, `ga4_channel_performance_range`, `ga4_utm_performance_range`, `ga4_funnel_range`.

Aggregate engagement rate is `SUM(engaged_sessions)/SUM(sessions)`. Never `AVG(engagement_rate)`.

Metabase should read `analytics.ga4_*` only. Do not give Metabase Google credentials.

---

## 10. Dashboard

`/dashboard/ga4` — HTTP Basic. Browser → Next.js → `analytics.ga4_*` → Supabase. The browser never talks to Google.

---

## 11. Security

- No Google credentials in PostgreSQL
- No OIDC / access tokens in logs or API responses
- Internal secret is compared with `timingSafeEqual`
- Locks are `data_pipeline.ga4_sync_locks` by property + dataset and do not touch Shopify/Meta locks

---

## 12. Parallel migration

See [`GA4_VALIDATION.md`](./GA4_VALIDATION.md). Cutover is **not** automatic and is **not** part of this implementation.
