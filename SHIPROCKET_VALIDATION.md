# Shiprocket validation

Use this after applying migrations `022`–`028`.

Do **not** treat this as cutover. Apps Script + Google Sheet + production Pabbly stay live.

## Data sources

| Source | Role |
|---|---|
| Tracking webhook | Current shipment status, scans, attempts, reasons |
| Shiprocket API reconciliation | **Not implemented.** No endpoint URLs were invented. `last_local_api_sync_at` stays unset. |
| Shopify enrichment | Legacy Customer Name / Phone / Coach / 8-digit order id |
| Remittance XLS/XLSX | CRF + AWB settlement. Official remittance API was **not verified**. |

## 1. Apply additive migrations

```sql
-- 022_shiprocket_enrichment.sql
-- 023_shiprocket_indexes_security.sql
-- 024_shiprocket_legacy_analytics.sql
-- 025_shiprocket_remittance.sql
-- 026_shiprocket_remittance_indexes_security.sql
-- 027_shiprocket_order_360.sql
-- 028_shiprocket_explorer_fix.sql   ← run this if billing_name / explorer columns are missing
```

## 2. Shopify enrichment backfill

```bash
curl -X POST http://localhost:3000/api/internal/shiprocket/enrichment/backfill \
  -H "Authorization: Bearer <SHIPROCKET_INTERNAL_SYNC_SECRET or WORKER_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"batchSize":100}'
```

## 3. Remittance report import

Shiprocket Billing → COD remittance report (`.xls` / `.xlsx`) with sheets:

- `AWB level report`
- `CRF level report`

The AWB sheet uses the source spelling **Remmitance Type**. Do not edit the uploaded file.

```bash
curl -X POST http://localhost:3000/api/internal/shiprocket/remittance/import \
  -H "Authorization: Bearer <SHIPROCKET_INTERNAL_SYNC_SECRET or WORKER_SECRET>" \
  -F "file=@/path/to/remittance.xls"
```

Or upload from `/dashboard/shiprocket` (dashboard Basic auth).

Same file can be imported again. CRF/AWB rows upsert. UTR is **not** unique per order: one CRF/UTR can cover many AWBs.

Unmatched settlement rows are kept (`match_status=unmatched`). Ambiguous AWB/order-id matches are not guessed.

Do **not** commit the production remittance workbook.

## 4. Sheet-compatible fields

Compare `analytics.shiprocket_legacy_order_rows` to the live Sheet for existing labels only.

New fields (return AWB, full scans, remittance, CRF, UTR) are dashboard/Supabase-only. Do not add them to the Google Sheet.

## 5. Dashboard

Canonical Shiprocket UI: `/dashboard/shiprocket`

`/dashboard` is the global multi-source hub.

KPIs and the order table use the same filter request. Delivered uses `status_bucket`, which prefers `shipment_status`/`current_status` and treats **RTO Delivered** as RTO, not Delivered.

## 6. Pabbly

Keep `SHIPROCKET_PABBLY_ENABLED=false`. Apps Script remains the production sender.

## 7. Cutover

Not part of this work.
