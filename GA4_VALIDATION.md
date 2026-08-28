# GA4 validation (Sheets vs Supabase)

This is a **parallel** check. Do not stop Apps Script, do not edit Sheets, and do not cut over reporting.

```
OLD: Google Apps Script → Google Sheets
NEW: Vercel OIDC + WIF → Analytics Data API → Supabase
```

Compare **completed historical dates** only. Ignore in-progress “today” while data is still settling.

---

## 1. What to compare

Use `analytics.ga4_daily_sheet_parity`, `analytics.ga4_channel_sheet_parity`, and `analytics.ga4_utm_sheet_parity`.

### Daily

Date, Sessions, Engaged Sessions, Engagement Rate, Bounce Rate, Users, New Users, Views, Add To Cart, Items Added To Cart, Begin Checkout, Purchases, Revenue

### Channel

Date + Channel + the same metrics

### UTM

Date, UTM Source, UTM Campaign, UTM Medium, UTM Content + the same metrics

Do **not** compare Sheet-formatted currency strings (`₹5,800.00`). Compare numeric revenue.

Engagement / bounce: allow a small decimal tolerance if the Sheet shows percentages (`99.30%` vs `0.993`).

---

## 2. Legacy UTM duplicates

The Sheet can contain duplicate-looking Date + UTM Key rows. PostgreSQL enforces

`(property_id, date, utm_source, utm_campaign, utm_medium, utm_content)`.

If the Sheet has duplicates:

1. Do not delete Sheet rows.
2. Record the duplicate keys as a validation diagnostic.
3. Compare the canonical GA4 API + Supabase row, not a weakened unique constraint.

---

## 3. Sequence (no cutover)

1. Apply migrations `018`–`021`. Keep `GA4_SYNC_ENABLED=false`.
2. Finish Google WIF + service-account impersonation.
3. Add the service account as GA4 **Viewer**.
4. Link/deploy the Vercel project and enable Team-issuer OIDC.
5. Connection test (below).
6. One completed historical day for daily, channel, and UTM.
7. Compare Supabase vs Sheets for that day.
8. Three-day recent test (`force: true` is OK while the schedule is disabled).
9. Compare again.
10. Daily 90-day backfill (resume until completed).
11. Channel 90-day backfill.
12. UTM backfill from `GA4_UTM_BACKFILL_START_DATE`.
13. Run Apps Script + Supabase in parallel.
14. Monitor multiple days.
15. **Only after explicit human approval** consider switching reporting consumers.

This document does not implement Sheet shutdown.

---

## 4. Commands

Replace dates and the Bearer secret. Never put real secrets in git.

### Connection test

```bash
curl -X POST http://localhost:3000/api/internal/ga4/connection-test \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>"
```

Expect `ok: true`, `authMode: "vercel-oidc-wif"`, timezone/currency metadata. No tokens.

### One completed day

```bash
curl -X POST http://localhost:3000/api/internal/ga4/sync/test \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dataset":"daily","since":"YYYY-MM-DD","until":"YYYY-MM-DD"}'

curl -X POST http://localhost:3000/api/internal/ga4/sync/test \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dataset":"channel","since":"YYYY-MM-DD","until":"YYYY-MM-DD"}'

curl -X POST http://localhost:3000/api/internal/ga4/sync/test \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dataset":"utm","since":"YYYY-MM-DD","until":"YYYY-MM-DD"}'
```

### Recent 3-day refresh

```bash
curl -X POST http://localhost:3000/api/internal/ga4/sync/recent \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"force":true}'
```

### Backfill

```bash
curl -X POST http://localhost:3000/api/internal/ga4/backfill/start \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dataset":"daily"}'

curl -X POST http://localhost:3000/api/internal/ga4/backfill/resume \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dataset":"daily"}'

# Repeat start/resume for "channel" and "utm"
```

### Repair

```bash
curl -X POST http://localhost:3000/api/internal/ga4/sync/repair \
  -H "Authorization: Bearer <GA4_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dataset":"daily","since":"YYYY-MM-DD","until":"YYYY-MM-DD"}'
```

---

## 5. Dashboard ready for cutover discussion only when

- Daily, channel, and UTM data exist
- Recurring 3-day refresh is stable
- No duplicate canonical rows
- Backfills completed
- Sheet parity checked
- Reporting timezone confirmed
- Revenue is numeric in the DB and formatted only in UI
- Channel and UTM values match
- Sync failures are visible on `/dashboard/ga4`
- WIF is stable on Vercel production

Until then the Sheets pipeline remains the production reference.
