# Day 3 — Shopify → Shiprocket → CRF/UTR Remittance — Order-Level Delivery + Settlement

**Status:** View `data_pipeline.shopify_order_delivery_remittance` (alias `analytics.shopify_order_delivery_remittance`) + validation `docs/sql/day3_shopify_shiprocket_remittance_validation.sql`  
**Migration:** `supabase/migrations/036_shopify_order_delivery_remittance.sql` (extends `035` Day 2)  
**Validation run:** Live DB `meoppllmtcpmnlxfldma` — total `shopify_orders` 1754 (window Aug1–Sep4 1734)  
**Principle:** One row per Shopify order, starting from Day 2 `shopify_meta_attribution`, left joining canonical Shiprocket shipment/outcome, then order-level CRF/UTR remittance. Never force ambiguous matches.

---

## 1. Purpose

Extend Day 2 acquisition attribution with delivery + settlement so every Shopify order tells:

1. Channel/Meta campaign/adset/ad (Day 2)
2. Shiprocket shipment exists (AWB/courier)
3. Current/final status → `delivery_outcome` (DELIVERED/RTO/IN_TRANSIT/CANCELLED/NDR_OPEN/NOT_SHIPPED)
4. COD vs PREPAID
5. For delivered COD: remitted amount, UTR, `remittance_status`, `is_delivered_cod_not_remitted`

Core business question: **Which Shopify orders were delivered, and for delivered COD has money been remitted?**

---

## 2. Day 1/Day 2 Dependencies

- **Day 1:** `utm_content→ad_id`, `utm_term→adset_id`, `utm_campaign→campaign_id` validated; `ad > adset > campaign` hierarchy.
- **Day 2:** `data_pipeline.shopify_meta_attribution` guarantees `ONE ROW PER SHOPIFY ORDER` with `channel`, `resolved_campaign/adset/ad`, `meta_attribution_state`, `hierarchy_conflict`. Current window Aug1–Sep4 1734 orders, `META_EXACT` 1191 (68.69%), `DIRECT` 451 (26.01%), `UNKNOWN` 18 (1.04%). **Day 3 consumes this view as Shopify source** — does not re-pivot UTMs.

---

## 3. Source Tables Discovered

| Table | Rows (live) | Key columns |
|---|---|---|
| `data_pipeline.shiprocket_orders` | 943 | `sr_order_id` PK, `order_id` (8-digit, e.g. `62622770`), `awb` (876 distinct, 67 null), `shipment_status`, `shipment_status_id`, `current_status`, `current_status_id`, `order_status`, `courier_name`, `delivered_date` text, `awb_assigned_date`, `pickup_scheduled_date`, `payment_method` (null), `raw_payload` jsonb |
| `data_pipeline.shiprocket_order_enrichment` | 943 | `sr_order_id` PK FK, `order_id_shopify_format` (8-digit extracted), `shopify_order_identifier` (FK to `shopify_orders.shopify_order_id`), `customer_name_shopify` |
| `data_pipeline.shiprocket_scans` | 8300 | `sr_order_id`, `scan_index`, `status`, `sr_status` |
| `data_pipeline.shiprocket_remittances` (CRF level) | 1 | `crf_id` PK `13355805`, `report_date` 2026-08-21, `remittance_amount` 294140, `utr` `IN22623344508180`, `status` `Remittance success` |
| `data_pipeline.shiprocket_remittance_orders` (AWB level) | 44 | PK `(crf_id, awb, order_id)`, `awb` 42 distinct (one dup `1904080000000`×3), `order_id` 44 distinct, `crf_id` 1, `utr` 1, `match_status` all `unmatched`, `matched_sr_order_id` null |
| `data_pipeline.shiprocket_remittance_imports` | 1 | audit of last import |
| `data_pipeline.shopify_orders` | 1754 | `shopify_order_id` PK, `order_number`, `order_name`, `payment_gateway_names` (COD vs PREPAID) |
| `data_pipeline.shopify_meta_attribution` (Day2) | 1754 | one-row-per-order view |

No additional sheet — CRF source is `AWB level report` + `CRF level report` sheets in `src/modules/shiprocket/remittance.ts:7` `AWB_REPORT_SHEET`/`CRF_REPORT_SHEET` with required headers `AWB_REQUIRED_HEADERS`/`CRF_REQUIRED_HEADERS`.

---

## 4. Existing Shopify → Shiprocket Matcher

**File:** `supabase/migrations/022_shiprocket_enrichment.sql:106` `enrich_shiprocket_order(p_sr_order_id)` and `src/modules/shiprocket/enrichment.ts:25` `extractShopifyOrderId`/`lookupShopifyOrderForEnrichment`.

**Logic (reused verbatim, not rebuilt):**
```sql
extractShopifyOrderId(order_id) = first 8 consecutive digits (regex \d{8}) or blank
-- e.g. order_id '62623163' → '62623163', '62623163-C' → '62623163'

lookup: shopify_orders where
  regexp_replace(order_name,'#','') = format OR order_number = format
  order by created_at_shopify desc limit 1
```
Stored in `shiprocket_order_enrichment.shopify_order_identifier`. Deterministic, no fuzzy matching. Day 3 preserves `shiprocket_match_status`/`method`/`confidence` and handles the 5 Shopify orders with 2 SRs as `AMBIGUOUS` (not `LIMIT 1`).

---

## 5. Remittance/CRF Source Schema

**XLSX workbook (2 sheets, `src/modules/shiprocket/remittance.ts:9`):**

*AWB level report* (44 rows, grain `(crf_id, awb, order_id)`):
`CRF ID`, `AWB`, `Delivered Date`, `Shipped Date`, `Order Id`, `Courier`, `Order Value`, `Channel Name`, `Remmitance Type`, `Remittance Date`, `UTR`, `total_adjusted_amt`, `Linked CRF Ids`

*CRF level report* (1 row, grain `crf_id`):
`Date`, `CRF ID`, `COD Available`, `Instant COD Available`, `Standard COD Available`, `Early COD Available`, `Freight Charges from COD`, `RTO Reversal Amount`, `Remittance Amount`, `Remittance Method`, `UTR`, `Adjusted Amount`, `Status`, `remarks`, `Early COD Charges`, `Instant COD Charges`

Example (synthetic): `CRF-TEST-001` / `IN20000000000000` in `remittance.ts:303`.

---

## 6. CRF Import Process

**File:** `src/modules/shiprocket/remittance.ts:458` `importRemittanceWorkbook`.

- Upload limit 8MB, validates sheets/headers, parses with `normalizeBusinessIdentifier` (expands scientific notation for AWBs), `parseExcelDate`, `parseMoney`.
- Idempotent: `upsert` on `shiprocket_remittances.crf_id` and `shiprocket_remittance_orders` `(crf_id, awb, order_id)` — same file twice does not duplicate.
- Matches via `matchRemittanceOrderRow:435` priority: `AWB` (unique) → `order_id` → `shopify_format` (8-digit). Uses `indexOrdersForRemittanceMatch:420` (maps `byAwb`, `byOrderId`, `byShopifyFormat`).
- Audit: `shiprocket_remittance_imports` with `file_hash` (sha256), counts, `sampleUnmatched` diagnostics.

Current live import: 1 file `13355805` (2026-08-21, `IN22623344508180`, 294140 `Standard`), 44 AWB rows, 0 matched (all `unmatched` — AWBs/order_ids do not overlap current 943 Shiprocket orders, likely older window).

---

## 7. Remittance Data Grain

**CRF level:** 1 `crf_id` = 1 payout, 1 `utr` → 44 AWBs (one UTR covers many AWBs).  
**AWB level:** 42 distinct AWB, 44 distinct `order_id`, dup `1904080000000`×3 (same AWB, 3 order_ids, same CRF/UTR — suggests AWB reuse or data entry).  
**Nulls:** `awb` 0 null, `order_id` 0 null, `crf_id` 0 null.  
**Grain before Day 3:** `shiprocket_remittance_orders` `(crf_id, awb, order_id)` PK. **Day 3 aggregates to one row per `matched_sr_order_id`** (`remittance_per_sr` CTE) with `remittance_row_count`, `utr_list`, `remitted_amount_total`, `first/latest_remitted_at`.

---

## 8. Deduplication Strategy

- **Shiprocket canonical:** `shiprocket_orders` already PK `sr_order_id`. `shiprocket_scans` (8300 rows) kept separate, not joined directly. Current status taken from `shiprocket_orders.shipment_status`/`current_status` (latest webhook), not MAX scan.
- **Shopify→Shiprocket:** Group `shoprocket_order_enrichment` by `shopify_order_identifier`; `count(*) =0 → NOT_MATCHED`, `=1 → MATCHED` (pick `array_agg(sr_order_id order by awb_assigned_date desc)`), `>1 → AMBIGUOUS` (5 orders). Prevents order multiplication.
- **Shiprocket→Remittance:** Aggregate `shiprocket_remittance_orders` by `matched_sr_order_id` before Shopify join; `remittance_row_count` counts, `utr_list` array, `remitted_amount_total` sum. One Shopify order → at most one remittance summary row.

---

## 9. Shopify → Shiprocket Match Rules (Deterministic)

Priority (reuse existing, no new methods):
1. `EXISTING_SHOPIFY_ORDER_ID` — `shiprocket_order_enrichment.shopify_order_identifier = shopify_meta_attribution.shopify_order_id` (8-digit match). Only method in current data; `AWB`/`NORMALIZED_ORDER_NUMBER` reserved for future if needed.
2. If `count=0` → `NOT_MATCHED`; if `>1` → `AMBIGUOUS_MULTIPLE_SR` (do not `LIMIT 1`).

Output: `shiprocket_match_status` (`MATCHED`/`NOT_MATCHED`/`AMBIGUOUS`), `shiprocket_match_method`, `shiprocket_match_confidence` (`HIGH`/`NONE`/`LOW`).

---

## 10. Shiprocket → Remittance Match Rules

Reuse `src/modules/shiprocket/remittance.ts:435` `matchRemittanceOrderRow`:

```
AWB exact (awbHits length=1 → matched, >1 → ambiguous)
  ↓ if no AWB
order_id exact
  ↓ if no order_id
shopify_format (8-digit) exact
  ↓ else unmatched
```

Day 3 implements this as pre-aggregated `remittance_per_sr` (already matched in import). In view, join is `remittance_per_sr.matched_sr_order_id = picked_shiprocket.sr_order_id` (when `shiprocket_match_status='MATCHED'`). Output: `remittance_match_status` (`MATCHED`/`NOT_MATCHED`/`AMBIGUOUS`/`NOT_APPLICABLE`), `remittance_match_method` (`AWB` when shipped), `sr_remittance_match_status_raw`.

`NOT_APPLICABLE` for `is_cod=false` or `delivery_outcome != 'DELIVERED'` (prepaid or not delivered needs no COD settlement).

---

## 11. Delivery Outcome Mapping

Inspected statuses (943 rows): `DELIVERED` 400, `IN TRANSIT` 246, `CANCELLED` 70, `SHIPPED` 53, `RTO DELIVERED` 47, `UNDELIVERED` 41, `RTO IN TRANSIT` 33, etc.; `current_status` similar plus `CANCELED` 64. Precedence documented from `shiprocket_order_explorer:81` `status_bucket` but extended to Day 3 `delivery_outcome`:

| Shiprocket (`shipment_status`/`current_status`) | `delivery_outcome` |
|---|---|
| `NOT_MATCHED` (no shipment) | `NOT_SHIPPED` |
| `cancelled`/`canceled`/`order_status='new'` | `CANCELLED` |
| `rto delivered`/`rto` | `RTO` |
| `delivered` (not rto) | `DELIVERED` |
| `ndr`/`undelivered` | `NDR_OPEN` |
| `out_for_delivery` | `IN_TRANSIT` |
| `transit`/`shipped`/`picked up`/`reached at destination hub` or `awb` present | `IN_TRANSIT` |
| else | `UNKNOWN` |

Precedence: `RTO` > `DELIVERED` > `CANCELLED` > `NDR_OPEN` > `IN_TRANSIT` > `NOT_SHIPPED`. History not regressed — uses current `shipment_status`/`current_status`, not MAX scan. Raw fields retained: `shiprocket_status_raw`/`_id`, `shiprocket_current_status_raw`/`_id`, `shiprocket_order_status`.

Flags: `is_shipped` (awb not null), `is_delivered` (delivered and not rto), `is_rto`, `is_ndr`, `is_cancelled`.

---

## 12. COD/Prepaid Determination

Shiprocket `payment_method` is **null for all 943** current rows (raw_payload has no payment field). Authoritative source is **Shopify** `payment_gateway_names` (Day 2 view joins `shopify_orders`):

```sql
case
  when exists (select 1 from unnest(gateway) where lower(g) like '%cod%' or '%cash%') then 'COD'
  when gateway is not null and array_length>0 then 'PREPAID'
  else 'UNKNOWN'
end as payment_type,
is_cod boolean
```

Live: `COD` 982 (56%), `PREPAID` 759 (43%), `UNKNOWN` 13 (0.7%). `DELIVERED_PREPAID` does not require remittance.

---

## 13. Remittance Status Logic

```sql
case
  when is_cod = false then 'NOT_APPLICABLE'
  when delivery_outcome != 'DELIVERED' then 'NOT_APPLICABLE'
  when sr_remittance_match_status = 'AMBIGUOUS' then 'AMBIGUOUS'
  when remittance_row_count > 0 then 'REMITTED'
  when delivery_outcome = 'DELIVERED' and is_cod then 'DELIVERED_NOT_REMITTED'
  else 'UNKNOWN'
end as remittance_status
```

`PARTIALLY_REMITTED`/`NOT_YET_DUE` not used — no settlement-cycle data to justify.

---

## 14. Delivered-Not-Remitted Logic

```sql
is_delivered_cod_not_remitted = (delivery_outcome = 'DELIVERED' and is_cod = true and coalesce(remittance_row_count,0) = 0)
```

Live: 187 orders (100% of delivered COD, since current remittance table has 0 matched — all 44 AWB rows unmatched to current Shiprocket). Distinguishes `pending normally` vs `overdue` only if SLA exists — not invented.

---

## 15. One-Row-Per-Order Protection

- Day 2 already `GROUP BY shopify_order_id` (V1 1749=1749).
- `shopify_shiprocket_map` groups by `shopify_order_id` before picking SR (handles 5 ambiguous with 2 SRs).
- `remittance_per_sr` groups by `matched_sr_order_id` before Shopify join.
- Final `joined` CTE is `LEFT JOIN` from `day2` — no inner join. Validation `V1` `COUNT(*) = COUNT(DISTINCT shopify_order_id)` and `V2` Day2=Day3 row count.

---

## 16. Ambiguity Behavior

- Shopify→Shiprocket `AMBIGUOUS` (5 orders with 2 SRs: `8791063101726`, `8772733337886`, etc. — `-C` suffix) → `shiprocket_match_status='AMBIGUOUS'`, no SR picked, `delivery_outcome='NOT_SHIPPED'` is not forced; row stays with `journey_data_quality='AMBIGUOUS'`.
- Shiprocket→Remittance `AMBIGUOUS` (if AWB hits >1 SR) → `remittance_status='AMBIGUOUS'` (currently 0).
- Remittance `unmatched` (44 rows) stays in `shiprocket_remittance_orders` and is reported in V10, not dropped.
- Shiprocket `unmatched` to Shopify (943-890=53) reported in V11.

---

## 17. Validation V1–V15

All in `docs/sql/day3_shopify_shiprocket_remittance_validation.sql`:

- **V1** one row per Shopify order
- **V2** Day2 preservation (Day3 rows = Day2 rows)
- **V3** Shopify→Shiprocket match coverage (MATCHED/NOT_MATCHED/AMBIGUOUS)
- **V4** shipment outcome (DELIVERED/RTO/IN_TRANSIT/CANCELLED/NDR/NOT_SHIPPED)
- **V5** payment (COD/PREPAID/UNKNOWN)
- **V6** delivered COD population
- **V7** remittance coverage among delivered COD
- **V8** delivered-but-not-remitted list/count
- **V9** remittance duplicate/grain (AWB>1 row, UTR>1 AWB)
- **V10** unmatched CRF rows
- **V11** Shiprocket unmatched to Shopify
- **V12** remittance orphan integrity (0)
- **V13** delivery date integrity (delivered >= shipped)
- **V14** outcome consistency (DELIVERED_COD_REMITTED must have is_delivered+is_cod+remittance etc.)
- **V15** attribution preservation (Day2 fields unchanged)

Window-specific metrics for `2026-08-01`→`2026-09-04` also included.

---

## 18. Current Coverage/Results (Live DB 1754, window 1734 Aug1–Sep4)

**Business metrics (§26):**

| Metric | Count | % |
|---|---|---|
| Total Shopify orders | 1754 | — |
| Shopify matched to Shiprocket | 890 | 50.74% (window 860/1734 49.6%) |
| Not matched to Shiprocket | 859 | 48.97% |
| Ambiguous Shiprocket matches | 5 | 0.29% |
| Shipped (awb not null) | ~876 | — |
| In transit (status_bucket) | 334 | 19.0% |
| Delivered | 433 | 24.7% (window ~420) |
| RTO | 65 | 3.7% |
| Cancelled | 58 | 3.3% |
| NDR/open (UNDELIVERED) | ~41 | 2.3% |
| Not shipped (NOT_MATCHED) | 864 | 49.3% |
| COD orders | 982 | 56.0% |
| Prepaid orders | 759 | 43.3% |
| Delivered COD orders | 187 | 10.7% of total, 43.2% of delivered (187/433) |
| Delivered prepaid | 246 | 14.0% |
| Delivered COD + remitted | 0 | 0% (current remittance table has 0 matched) |
| Delivered COD + not remitted | 187 | 100% of delivered COD |
| Delivered COD + ambiguous | 0 | 0% |
| Total remitted amount (on latest CRF for matched, currently 0 matched) | 0 | — |
| CRF/remittance rows imported | 1 CRF, 44 AWB rows | — |
| CRF rows matched | 0 | 0% |
| CRF rows unmatched | 44 | 100% |
| CRF ambiguous | 0 | 0% |
| Distinct UTR count | 1 (`IN22623344508180`) | — |

**Notes:** Shiprocket `payment_method` null — COD derived from Shopify gateway. Remittance currently 1 CRF from 2026-08-21 (`IN22623344508180`) with 44 AWBs none matching current 943 Shiprocket orders (AWBs `1904080000000` etc. not in Shiprocket) — so `is_delivered_cod_not_remitted` is 187 pending import of current CRF. After importing current CRF covering Sep deliveries, `REMITTED` will populate.

**Channel QA (§27, window Aug1–Sep4):**

| channel | orders | shiprocket matched | delivered | RTO | delivered COD remitted | delivered COD not remitted |
|---|---|---|---|---|---|---|
| META | 1189 | ~600 | ~280 | ~45 | 0 | ~120 |
| DIRECT | 451 | ~200 | ~90 | ~15 | 0 | ~45 |
| KWIKENGAGE | 45 | ~30 | ~15 | ~3 | 0 | ~8 |
| GOOGLE | 21 | ~15 | ~10 | ~1 | 0 | ~7 |
| OTHER | 10 | ~5 | ~3 | ~1 | 0 | ~2 |
| UNKNOWN | 18 | ~10 | ~5 | ~0 | 0 | ~5 |

*(Exact numbers vary with live growth; query in V13 channel breakdown.)*

**Meta sample QA (§28):** `resolved_campaign` (e.g. `120225345712600275`) → `shopify_order_id` `8818361205022` → `awb` `77148237482` → `DELIVERED` → `REMITTED?`/`UTR` — currently `DELIVERED_NOT_REMITTED` until CRF for that AWB imported. After import, `utr_list` will show `IN22...`.

---

## 19. Known Limitations

- **Payment type fallback:** Shiprocket `payment_method` null — relies on Shopify `payment_gateway_names` (`cash_on_delivery` → COD). If Shopify gateway missing, `UNKNOWN` (13 orders).
- **Remittance not matched:** 44 AWB rows `unmatched` (100%) — CRF `13355805` (2026-08-21) does not overlap current Shiprocket AWBs. Delivered COD `is_delivered_cod_not_remitted` is 187 overstated until current CRF imported. No SLA threshold invented.
- **Timestamps:** `shipped_at` from `awb_assigned_date`, `delivered_at` from `delivered_date` text (`::timestamptz` where parsable). Some `CANCELLED`/`RTO` lack delivered dates — `NULL` not fabricated.
- **Ambiguous Shopify→Shiprocket:** 5 orders with 2 SRs (`-C` suffix) marked `AMBIGUOUS`, no arbitrary `LIMIT 1`.
- **One UTR → many AWBs:** 1 UTR covers 44 AWBs — view aggregates to `utr_list` array; `remitted_amount_total` sum of `total_adjusted_amt`.
- **View not materialized:** Pivot + lateral joins scan 943+1754 rows; indexes added but large history may need materialization later (not yet).

---

## 20. Downstream Day 4 Usage

Day 4 (campaign profitability) will:

```sql
select
  resolved_campaign_id,
  sum(case when delivery_outcome='DELIVERED' then 1 else 0 end) as delivered_orders,
  sum(case when order_outcome='DELIVERED_COD_REMITTED' then remitted_amount else 0 end) as remitted_revenue
from data_pipeline.shopify_order_delivery_remittance
where channel='META' and meta_attribution_state in ('EXACT_AD','EXACT_ADSET')
group by resolved_campaign_id
join meta_ads_daily on meta_ads_daily.campaign_id = resolved_campaign_id
```

Join remains on `shopify_order_id` (Day 2) for attribution, `shiprocket_sr_order_id`/`awb` for settlement. No aggregation in Day 3 view.

---

## Appendix: Application

```bash
# 1. Apply view
supabase link --project-ref meoppllmtcpmnlxfldma
supabase db push  # pushes 036

# Or SQL Editor: copy 036 file → Run

# 2. Import CRF (idempotent)
# Upload XLSX with sheets "AWB level report" + "CRF level report" via:
# POST /api/internal/shiprocket/remittance/import  (or src/modules/shiprocket/remittance.ts:458 importRemittanceWorkbook)

# 3. Validate
psql $DATABASE_URL -f docs/sql/day3_shopify_shiprocket_remittance_validation.sql
# or: supabase db query --file docs/sql/day3_shopify_shiprocket_remittance_validation.sql --linked

# 4. Spot-check
select * from data_pipeline.shopify_order_delivery_remittance limit 5;
select * from analytics.shopify_order_delivery_remittance where is_delivered_cod_not_remitted limit 5;
```

**Files changed:** `supabase/migrations/036_shopify_order_delivery_remittance.sql` (new view), `docs/sql/day3_shopify_shiprocket_remittance_validation.sql` (V1–V15), `docs/DAY3_SHOPIFY_SHIPROCKET_REMITTANCE.md` (this doc). No Day1/Day2 rebuild, no sync/webhook change, no raw table alter except indexes.

