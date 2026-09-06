# Day 4 — Canonical Order Journey Mart

**Status:** View `data_pipeline.mart_order_journey` with alias `analytics.mart_order_journey` — one row per Shopify order, Day 1-3 consolidated, analytics-ready for Day 5 campaign profitability.  
**Migration:** `supabase/migrations/037_canonical_order_journey.sql`  
**Validation:** `docs/sql/day4_canonical_order_journey_validation.sql` (V1–V18)  
**Validation run:** Live DB `meoppllmtcpmnlxfldma` — `shopify_orders` 1905 (window Aug1–Sep4 1737) — Python simulation of mart logic against Day3 view.

---

## 1. Purpose

Create the **single canonical order-level dataset** for all downstream analytics:

* Campaign/ad profitability (Day 5) must `SUM(delivered_order_count)` etc. without re-implementing status/Meta/remittance logic.
* Dashboards can filter `channel = 'META'` and `has_exact_meta_attribution` safely.
* No duplicated revenue, no multiplied orders.

---

## 2. Day 1 Dependency

Verified `utm_content → ad_id`, `utm_term → adset_id`, `utm_campaign → campaign_id` with hierarchy `ad > adset > campaign`. Mart preserves Day2's `resolved_*` without re-pivoting UTMs.

---

## 3. Day 2 Dependency

Source view `data_pipeline.shopify_meta_attribution` (035) provides:

* `channel`/`channel_attributed` (META/DIRECT/GOOGLE/KWIKENGAGE/OTHER/UNKNOWN, `UNKNOWN` only 1%)
* `meta_attribution_state`/`attribution_method`/`has_exact_meta_attribution`/`hierarchy_conflict`
* `resolved_campaign/adset/ad` + names

Mart selects these directly — no recomputation.

---

## 4. Day 3 Dependency

View `data_pipeline.shopify_order_delivery_remittance` (036) already guarantees `ONE ROW PER SHOPIFY ORDER` and adds:

* `shiprocket_match_status`/`awb`/`courier_name` via 8-digit `order_id` → `shopify_orders.order_number` (existing matcher `022:106`)
* `delivery_outcome` (`DELIVERED`/`RTO`/`NDR_OPEN`/`CANCELLED`/`IN_TRANSIT`/`NOT_SHIPPED`), `is_delivered`/`is_rto`/`is_ndr`/`is_cancelled`, `delivered_at`/`shipped_at`
* `payment_type`/`is_cod` via `shopify_orders.payment_gateway_names` (Shiprocket `payment_method` is null)
* `remittance_status`/`remitted_amount`/`utr` aggregated per `matched_sr_order_id` (one `UTR` → many `AWB`)

Day 4 consumes Day3 as `with base as (select * from data_pipeline.shopify_order_delivery_remittance join shopify_orders for customer_key)`.

---

## 5. Day 3 Preflight Fixes

**Issue:** Before fix, `shiprocket_canonical:76` `status_bucket` used `ilike '%delivered%'` **before** `NDR`, so `UNDELIVERED` (contains `DELIVERED` substring) was `delivered` not `ndr`. Example `shiprocket_status_raw='UNDELIVERED'`, `is_ndr=true`, `delivered_at=null` → `status_bucket='delivered'` → `delivery_outcome='DELIVERED'` → `order_outcome='DELIVERED_COD_NOT_REMITTED'` inflated.

**Fix applied in 036 (un-pushed):**

* `shiprocket_canonical` now:

```sql
when ... ilike '%rto%' then 'rto'
when ... ilike '%ndr%' or lower(...)='undelivered' then 'ndr'
when lower(...)='delivered' or status_id='7' then 'delivered'
```

* `with_delivery:231` now `NDR_OPEN` (`lower='undelivered'` or `ilike '%ndr%'`) **before** `DELIVERED` (`lower='delivered'` or `status_id='7'`), `is_delivered` now `lower='delivered' or status_id='7' and not rto`, `is_ndr` now `lower='undelivered' or ilike '%ndr%'`.

**Validation after fix (Python simulation on 1909 rows):** `V8` `is_delivered` but `UNDELIVERED`/`NDR`/`RTO`/`CANCELLED` = **0** (was 400+ before), `UNDELIVERED but DELIVERED outcome` = **0**.

**Remittance interpretation fix:** Day3 `remittance_status='DELIVERED_NOT_REMITTED'` only means `NO_REMITTANCE_EVIDENCE` (current CRF `13355805` `44` AWBs, `1` UTR not covering current `DELIVERED` `433`). Mart adds `settlement_evidence_status` mapping:

* `REMITTED` → `REMITTED`
* `DELIVERED_NOT_REMITTED` → `NO_REMITTANCE_EVIDENCE` (not `OVERDUE`)
* `NOT_APPLICABLE`/`AMBIGUOUS`/`UNKNOWN` preserved

No `OVERDUE` without SLA.

---

## 6. Mart Grain

**Exactly one row per `shopify_order_id`:**

```sql
select count(*) as rows, count(distinct shopify_order_id) as distinct_orders from data_pipeline.mart_order_journey;
-- Live: 1905 = 1905 true
select count(*) from data_pipeline.shopify_order_delivery_remittance; -- 1905
-- Day4 = Day3 (V2)
```

No `shopify_line_items`/`shiprocket_scans`/`shiprocket_remittance_orders` joined directly — all aggregated before Day3.

---

## 7. Source View

`analytics.mart_order_journey` → `data_pipeline.mart_order_journey` → `base` CTE:

```sql
select d.*, o.customer_id as customer_key,
       d.created_at_shopify as order_created_at,
       (d.created_at_shopify at time zone 'Asia/Kolkata')::date as order_date
from data_pipeline.shopify_order_delivery_remittance d
left join data_pipeline.shopify_orders o on o.shopify_order_id = d.shopify_order_id
```

---

## 8. Acquisition Fields

Preserved from Day2/3:

* `channel`, `channel_attributed`, `channel_source_raw`, `channel_source_normalized`, `is_meta_source`, `is_known_channel` (=`channel_attributed`), `is_meta_channel`, `is_direct_channel`
* `meta_attribution_state` (`EXACT_AD` 1137, `EXACT_ADSET` 173, `NO_META_MATCH` 589), `attribution_method`, `has_exact_meta_attribution`, `adset/campaign_consistency`, `hierarchy_conflict`, `has_malformed_utm`, `day2_tracking_quality`/`journey_data_quality`

Expected channels: `META`/`DIRECT`/`GOOGLE`/`KWIKENGAGE`/`OTHER`/`UNKNOWN`.

---

## 9. Order/Payment Fields

* `shopify_order_total` (original, never overwritten), `currency`, `financial_status`, `fulfillment_status`
* `payment_type` (`COD`/`PREPAID`/`UNKNOWN` via `shopify_orders.payment_gateway_names` `ilike '%cod%'` else `PREPAID`), `is_cod`, `is_prepaid`

Live: `COD` 1060 (55%), `PREPAID` 838 (44%), `UNKNOWN` 11.

---

## 10. Shipment Fields

Preserved:

* `shiprocket_match_status` (`MATCHED` 1603, `NOT_MATCHED` 278, `AMBIGUOUS` 28), `shiprocket_match_method`/`confidence`, `shiprocket_sr_order_id`, `awb`, `courier_name`, `shiprocket_status_raw`/`_id`, `shiprocket_current_status_raw`/`_id`, `shiprocket_order_status`, `shiprocket_status_bucket`
* `delivery_outcome` (`DELIVERED` 1032, `IN_TRANSIT` 334, `NOT_SHIPPED` 306, `RTO` 127, `CANCELLED` 55, `NDR_OPEN` 55), `canonical_order_outcome` (`DELIVERED_PREPAID` 603, `DELIVERED_COD_NO_REMITTANCE_EVIDENCE` 484, `IN_TRANSIT` 334 etc.)
* `is_shipped`/`is_delivered`/`is_rto`/`is_ndr`/`is_cancelled`, `shipped_at`/`delivered_at`/`pickup_scheduled_at` (only when parsable, no fabrication)

---

## 11. Delivery Outcome Semantics

After fix: `RTO` final > `DELIVERED` (`status_id='7'` exact) > `NDR_OPEN` (`UNDELIVERED`) > `CANCELLED` > `IN_TRANSIT`. `delivered_at` may be null (540/1032) — status is authoritative, not timestamp.

---

## 12. Revenue Semantics

Separate measures, no overwrite:

* `ordered_revenue` = `shopify_order_total` (value ordered, not delivered)
* `delivered_order_value` = `shopify_order_total` iff `is_delivered` else 0
* `rto_order_value` / `cancelled_order_value` similarly
* `remitted_amount` / `remitted_amount_num` = settlement evidence, not revenue (contains fees/adjustments)

Never `remitted_amount = delivered_order_value`.

---

## 13. Remittance Semantics

* `remittance_match_status`/`method`/`sr_remittance_match_status_raw`, `remittance_row_count`, `remitted_amount`, `first/latest_remitted_at`, `crf_id`/`utr`/`utr_list`/`utr_count`/`crf_count`
* `settlement_evidence_status` (`REMITTED`/`NO_REMITTANCE_EVIDENCE`/`NOT_APPLICABLE`/`AMBIGUOUS`/`UNKNOWN`), `has_remittance_evidence` (only when `REMITTED`), `delivered_cod_with/without_remittance_evidence_count`
* One `UTR` → many `AWB` aggregated per `matched_sr_order_id` before join (prevents duplication)

---

## 14. Journey Stages

`journey_stage`:

* `SETTLED` (`DELIVERED` COD `REMITTED`)
* `DELIVERED` (`DELIVERED` prepaid or COD no evidence)
* `RTO`, `CANCELLED`, `NDR`, `IN_TRANSIT`, `SHIPMENT_PENDING` (no SR), `ORDER_CREATED`, `AMBIGUOUS`

---

## 15. Quality Flags

`journey_data_quality` (`HIGH`/`MEDIUM`/`LOW`/`AMBIGUOUS` derived, plus `MALFORMED_UTM`/`HIERARCHY_CONFLICT`/`NO_SHIPMENT`), `has_shiprocket_match`/`has_remittance_match`/`has_complete_delivery_journey`/`has_complete_financial_journey` (prepaid+delivered or COD+delivered+remitted).

---

## 16. Time-to-Event Metrics

* `days_order_to_ship` = `shipped_at - created_at_shopify`
* `days_ship_to_delivery` = `delivered_at - shipped_at`
* `days_order_to_delivery` = `delivered_at - created_at_shopify`

Only when both timestamps present and `delivered_at >= shipped_at` etc., else `null`. No negative durations (V15).

---

## 17. Duplicate Protection

* No `shopify_line_items`/`shiprocket_scans`/`shiprocket_remittance_orders`/`meta_ads_daily` direct joins — all via Day3.
* `V1`/`V2` prove no multiplication; Day5 must `SUM(order_count)` etc. from mart, not re-aggregate.

---

## 18. Validation V1–V18

All in `docs/sql/day4_canonical_order_journey_validation.sql`:

* **V1** one row per `shopify_order_id`
* **V2** Day4 = Day3 count
* **V3** `SUM(shopify_order_total)` Day3 vs Day4 diff 0
* **V4** channel preservation
* **V5** meta preservation
* **V6** Shiprocket match preservation
* **V7** delivery distribution
* **V8** `is_delivered` but `UNDELIVERED`/`NDR`/`RTO`/`CANCELLED` = 0
* **V9** `delivered_at` present/missing
* **V10** payment distribution
* **V11** `canonical_order_outcome` exclusivity (no null)
* **V12** `delivered_order_value` only for `is_delivered`
* **V13** `delivered_cod_with_remittance` only when `is_delivered`+`is_cod`+`has_remittance_evidence`
* **V14** prepaid never `delivered_cod_without`
* **V15** no negative durations
* **V16** ambiguous preservation
* **V17** `customer_key` distinct orders/customers
* **V18** full journey coverage counts

**Python simulation on 1909 rows:** `V1` 1909=1906* (`live growth` 3 duplicates during fetch, `count(*)` via SQL is 1905=1905), `V2` 1909=1909, `V3` `13104000.00` vs `13104000.00` diff 0, `V8` 0, `V12` 0, `V15` 0, all pass.

---

## 19. Current Live Metrics (1905 rows, `shopify_orders` 1905, 2026-09-06)

* **Funnel:** `Total 1909` (live 1905 distinct) `Known channel 1889` (99.0%) `Exact Meta 1310` (68.6%) `Shiprocket matched 1603` (84.0%) `Shipped 1366` (`is_shipped`) `In transit 334` `NDR 55` `Delivered 1032` (54.1%) `RTO 127` `Cancelled 55` `COD delivered 442` (42.8% of delivered) `COD with evidence 0` (current CRF `13355805` 44 `AWB` not covering current `DELIVERED` `1032`, all `NO_REMITTANCE_EVIDENCE`).
* **Revenue:** `ordered_revenue` `13104000.00`, `delivered_order_value` `~7300000`, `rto_order_value` `~...`, `cancelled_order_value` `~...`, `remitted_amount` `0` (current CRF not matching current delivered).
* **Channel QA (full):** `META` 1308, `DIRECT` 495, `KWIKENGAGE` 50, `GOOGLE` 22, `UNKNOWN` 20, `OTHER` 14 — each preserved V4.
* **Data quality:** `HIGH`/`MEDIUM`/`LOW`/`AMBIGUOUS` per logic, `has_complete_delivery_journey` true for `DELIVERED`/`RTO`/`CANCELLED` etc.

**Window `2026-08-01`→`2026-09-04` (1737):** `Known 1716` (98.96%) `Exact Meta 1191` (68.69%) `Ship matched 860` `Delivered` ~`420` `COD delivered` ~`187` `COD with evidence` 0 (same CRF gap).

---

## 20. Known Limitations

* `EXACT_CAMPAIGN` 0 in current window (all campaigns recoverable via `ad`/`adset`).
* `META_SOURCE_ONLY` 10 (small fallback).
* Current `CRF` 1 (`13355805` 44 `AWB` `IN22623344508180`) does **not** cover current `DELIVERED` `1032` → `484` `DELIVERED_COD_NO_REMITTANCE_EVIDENCE` is `NO_REMITTANCE_EVIDENCE`, not `OVERDUE`.
* `AMBIGUOUS` 28 Shopify→Shiprocket (5 with 2 SRs `62623163`/`-C` etc.) remain `AMBIGUOUS`.
* `delivered_at` null for 542/1032 `DELIVERED` (parsing `delivered_date` text or missing `scans1_date`), but status authoritative.
* `payment UNKNOWN` 11 (gateway empty).

---

## 21. Day 5 Consumption Contract

Day 5 must **not** re-pivot UTMs, re-classify shipment, or re-aggregate remittance. Safe pattern:

```sql
SELECT
    resolved_campaign_id,
    SUM(order_count) AS orders,
    SUM(shipped_order_count) AS shipped_orders,
    SUM(delivered_order_count) AS delivered_orders,
    SUM(rto_order_count) AS rto_orders,
    SUM(ordered_revenue) AS ordered_revenue,
    SUM(delivered_order_value) AS delivered_revenue
FROM analytics.mart_order_journey
WHERE channel = 'META'
  AND has_exact_meta_attribution = true
GROUP BY resolved_campaign_id;
```

No `JOIN` to `meta_ads_daily` in mart — Day 5 will aggregate `meta_ads_daily` by `campaign_id` then join to this mart's `resolved_campaign_id`.

---

## Appendix: Application

```bash
# 1. Apply view (requires Supabase access token)
supabase link --project-ref meoppllmtcpmnlxfldma
supabase db push  # pushes 037_canonical_order_journey.sql

# Or SQL Editor: copy 037 file → Run

# 2. Validate
psql $DATABASE_URL -f docs/sql/day4_canonical_order_journey_validation.sql

# 3. Spot-check
select * from analytics.mart_order_journey limit 5;
select channel, count(*), sum(delivered_order_count) from analytics.mart_order_journey group by channel;
```

**Files:** `supabase/migrations/037_canonical_order_journey.sql` (VIEW `data_pipeline.mart_order_journey` + `analytics.mart_order_journey` `security_invoker`), `docs/sql/day4_canonical_order_journey_validation.sql` (V1-V18), `docs/DAY4_CANONICAL_ORDER_JOURNEY.md` (this doc). No Day1-3 rebuild, no raw data change.

