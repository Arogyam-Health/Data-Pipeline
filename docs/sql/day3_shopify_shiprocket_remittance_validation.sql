-- docs/sql/day3_shopify_shiprocket_remittance_validation.sql
-- Day 3 — Shopify → Shiprocket → CRF/UTR Remittance — Validation V1-V15
-- Target: data_pipeline.shopify_order_delivery_remittance (alias analytics.shopify_order_delivery_remittance)
-- View defined in supabase/migrations/036_shopify_order_delivery_remittance.sql
-- Validates: one-row-per-order, Day2 preservation, Shiprocket match, delivery outcome, COD, remittance, grain, orphans, integrity
-- Run after applying migration 036. All queries dynamic — do not hardcode counts.

-- ============================================================
-- V1 — one row per Shopify order
-- ============================================================
select
  count(*) as rows,
  count(distinct shopify_order_id) as distinct_orders,
  (count(*) = count(distinct shopify_order_id)) as is_one_row_per_order
from data_pipeline.shopify_order_delivery_remittance;

-- List duplicates if any
-- select shopify_order_id, count(*) from data_pipeline.shopify_order_delivery_remittance group by shopify_order_id having count(*) > 1;

-- ============================================================
-- V2 — Day 2 preservation (no order disappears)
-- ============================================================
select
  (select count(*) from data_pipeline.shopify_meta_attribution) as day2_orders,
  (select count(*) from data_pipeline.shopify_order_delivery_remittance) as day3_orders,
  ((select count(*) from data_pipeline.shopify_meta_attribution) = (select count(*) from data_pipeline.shopify_order_delivery_remittance)) as equal;

-- Also check distinct shopify_order_id sets are identical
-- select shopify_order_id from data_pipeline.shopify_meta_attribution except select shopify_order_id from data_pipeline.shopify_order_delivery_remittance;
-- select shopify_order_id from data_pipeline.shopify_order_delivery_remittance except select shopify_order_id from data_pipeline.shopify_meta_attribution;

-- ============================================================
-- V3 — Shopify → Shiprocket match coverage
-- ============================================================
select
  shiprocket_match_status,
  count(*) as orders,
  round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from data_pipeline.shopify_order_delivery_remittance
group by shiprocket_match_status
order by case shiprocket_match_status when 'MATCHED' then 1 when 'NOT_MATCHED' then 2 when 'AMBIGUOUS' then 3 else 4 end;

select
  count(*) as total_shopify_orders,
  count(*) filter (where shiprocket_match_status = 'MATCHED') as matched,
  round(100.0 * count(*) filter (where shiprocket_match_status = 'MATCHED') / nullif(count(*),0),2) as matched_pct,
  count(*) filter (where shiprocket_match_status = 'NOT_MATCHED') as not_matched,
  count(*) filter (where shiprocket_match_status = 'AMBIGUOUS') as ambiguous
from data_pipeline.shopify_order_delivery_remittance;

-- ============================================================
-- V4 — shipment outcome distribution
-- ============================================================
select
  delivery_outcome,
  count(*) as orders,
  round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from data_pipeline.shopify_order_delivery_remittance
group by delivery_outcome
order by orders desc;

-- Also raw status_bucket for audit
-- select status_bucket, count(*) from data_pipeline.shopify_order_delivery_remittance group by status_bucket;

-- ============================================================
-- V5 — payment distribution
-- ============================================================
select
  payment_type,
  count(*) as orders,
  round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from data_pipeline.shopify_order_delivery_remittance
group by payment_type
order by orders desc;

select
  is_cod,
  count(*) as orders
from data_pipeline.shopify_order_delivery_remittance
group by is_cod;

-- ============================================================
-- V6 — delivered COD population
-- ============================================================
select
  count(*) as delivered_cod_orders,
  round(100.0 * count(*) / nullif((select count(*) from data_pipeline.shopify_order_delivery_remittance),0),2) as pct_of_all
from data_pipeline.shopify_order_delivery_remittance
where delivery_outcome = 'DELIVERED' and is_cod = true;

-- Breakdown delivered COD vs delivered PREPAID
select
  case when is_cod then 'COD' else 'PREPAID' end as cod_prepaid,
  count(*) as delivered_orders
from data_pipeline.shopify_order_delivery_remittance
where delivery_outcome = 'DELIVERED'
group by case when is_cod then 'COD' else 'PREPAID' end;

-- ============================================================
-- V7 — remittance coverage among delivered COD
-- ============================================================
select
  remittance_status,
  count(*) as orders,
  round(100.0 * count(*) / nullif(sum(count(*)) over (),0),2) as pct
from data_pipeline.shopify_order_delivery_remittance
where delivery_outcome = 'DELIVERED' and is_cod = true
group by remittance_status
order by orders desc;

select
  remittance_match_status,
  count(*) as orders
from data_pipeline.shopify_order_delivery_remittance
where delivery_outcome = 'DELIVERED' and is_cod = true
group by remittance_match_status;

-- ============================================================
-- V8 — delivered-but-not-remitted (sanitized, no PII)
-- ============================================================
select
  count(*) as delivered_cod_not_remitted_orders,
  round(100.0 * count(*) / nullif((select count(*) from data_pipeline.shopify_order_delivery_remittance where delivery_outcome='DELIVERED' and is_cod),0),2) as pct_of_delivered_cod
from data_pipeline.shopify_order_delivery_remittance
where is_delivered_cod_not_remitted = true;

-- Sample (sanitized: no customer name/phone)
-- select shopify_order_id, order_name, awb, delivered_at, shopify_order_total, remittance_status, remittance_row_count
-- from data_pipeline.shopify_order_delivery_remittance
-- where is_delivered_cod_not_remitted = true
-- order by delivered_at desc nulls last limit 10;

-- ============================================================
-- V9 — remittance duplicate/grain analysis
-- ============================================================
-- Raw remittance grain (before order-level aggregation)
select
  count(*) as raw_remittance_rows,
  count(distinct awb) as distinct_awb,
  count(distinct order_id) as distinct_order_id,
  count(distinct crf_id) as distinct_crf,
  count(distinct utr) filter (where utr is not null and btrim(utr) <> '') as distinct_utr
from data_pipeline.shiprocket_remittance_orders;

-- AWBs with >1 remittance row
select awb, count(*) as rows
from data_pipeline.shiprocket_remittance_orders
group by awb having count(*) > 1
order by rows desc limit 10;

-- UTRs covering >1 AWB
select utr, count(distinct awb) as awb_count, count(*) as rows
from data_pipeline.shiprocket_remittance_orders
where utr is not null and btrim(utr) <> ''
group by utr having count(distinct awb) > 1
order by awb_count desc limit 10;

-- Orders (Shopify) with >1 remittance row (via SR)
select shopify_order_id, remittance_row_count
from data_pipeline.shopify_order_delivery_remittance
where remittance_row_count > 1
order by remittance_row_count desc limit 10;

-- Duplicate raw rows (crf_id, awb, order_id) — should be 0 due to unique constraint
select crf_id, awb, order_id, count(*)
from data_pipeline.shiprocket_remittance_orders
group by crf_id, awb, order_id having count(*) > 1;

-- Null key rates
select
  count(*) filter (where awb is null or btrim(awb)='') as null_awb,
  count(*) filter (where order_id is null or btrim(order_id)='') as null_order_id,
  count(*) filter (where crf_id is null or btrim(crf_id)='') as null_crf
from data_pipeline.shiprocket_remittance_orders;

-- ============================================================
-- V10 — unmatched CRF/remittance rows
-- ============================================================
select
  count(*) as unmatched_remittance_rows,
  count(distinct awb) as distinct_awb_unmatched
from data_pipeline.shiprocket_remittance_orders
where match_status = 'unmatched';

-- Sample unmatched (sanitized)
-- select crf_id, awb, order_id, courier, order_value, utr, remittance_date
-- from data_pipeline.shiprocket_remittance_orders where match_status='unmatched' limit 10;

-- ============================================================
-- V11 — Shiprocket orders unmatched to Shopify
-- ============================================================
select
  count(*) as shiprocket_total,
  count(*) filter (where shopify_order_identifier is null) as unmatched_to_shopify,
  round(100.0 * count(*) filter (where shopify_order_identifier is null) / nullif(count(*),0),2) as unmatched_pct,
  count(*) filter (where shopify_order_identifier is not null) as matched_to_shopify
from data_pipeline.shiprocket_order_enrichment;

-- List unmatched shiprocket orders (sanitized)
-- select sr_order_id, order_id, awb, shipment_status, current_status
-- from data_pipeline.shiprocket_orders o
-- left join data_pipeline.shiprocket_order_enrichment e on e.sr_order_id = o.sr_order_id
-- where e.shopify_order_identifier is null limit 10;

-- ============================================================
-- V12 — remittance orphan integrity (0 orphan matches)
-- ============================================================
select
  count(*) as matched_remittance_rows,
  count(*) filter (where not exists (
    select 1 from data_pipeline.shopify_order_delivery_remittance d
    where d.shiprocket_sr_order_id = shiprocket_remittance_orders.matched_sr_order_id
  )) as orphan_matched
from data_pipeline.shiprocket_remittance_orders
where match_status = 'matched';

-- ============================================================
-- V13 — delivery date integrity
-- ============================================================
select
  count(*) filter (where delivered_at is not null and shipped_at is not null and delivered_at < shipped_at) as delivered_before_shipped_violations,
  count(*) filter (where delivered_at is not null) as delivered_with_date,
  count(*) filter (where shipped_at is not null) as shipped_with_date
from data_pipeline.shopify_order_delivery_remittance
where delivery_outcome = 'DELIVERED';

-- List violations if any
-- select shopify_order_id, shipped_at, delivered_at, awb
-- from data_pipeline.shopify_order_delivery_remittance
-- where delivered_at < shipped_at;

-- ============================================================
-- V14 — outcome consistency
-- ============================================================
-- DELIVERED_COD_REMITTED → is_delivered=true, is_cod=true, has remittance
select count(*) as violations
from data_pipeline.shopify_order_delivery_remittance
where order_outcome = 'DELIVERED_COD_REMITTED'
  and not (is_delivered = true and is_cod = true and remittance_row_count > 0);

-- DELIVERED_PREPAID → is_delivered=true, is_cod=false
select count(*) as violations
from data_pipeline.shopify_order_delivery_remittance
where order_outcome = 'DELIVERED_PREPAID'
  and not (is_delivered = true and is_cod = false);

-- DELIVERED_COD_NOT_REMITTED → is_delivered=true, is_cod=true, no remittance
select count(*) as violations
from data_pipeline.shopify_order_delivery_remittance
where order_outcome = 'DELIVERED_COD_NOT_REMITTED'
  and not (is_delivered = true and is_cod = true and remittance_row_count = 0);

-- ============================================================
-- V15 — attribution preservation (Day2 fields survive unchanged)
-- ============================================================
-- Compare Day2 vs Day3 for channel, meta_attribution_state, resolved ids
select
  'channel' as field,
  count(*) as mismatched
from data_pipeline.shopify_meta_attribution d2
join data_pipeline.shopify_order_delivery_remittance d3 on d3.shopify_order_id = d2.shopify_order_id
where d2.channel is distinct from d3.channel
union all
select 'meta_attribution_state',
  count(*) from data_pipeline.shopify_meta_attribution d2
  join data_pipeline.shopify_order_delivery_remittance d3 on d3.shopify_order_id = d2.shopify_order_id
  where d2.meta_attribution_state is distinct from d3.meta_attribution_state
union all
select 'resolved_campaign_id',
  count(*) from data_pipeline.shopify_meta_attribution d2
  join data_pipeline.shopify_order_delivery_remittance d3 on d3.shopify_order_id = d2.shopify_order_id
  where d2.resolved_campaign_id is distinct from d3.resolved_campaign_id
union all
select 'resolved_adset_id',
  count(*) from data_pipeline.shopify_meta_attribution d2
  join data_pipeline.shopify_order_delivery_remittance d3 on d3.shopify_order_id = d2.shopify_order_id
  where d2.resolved_adset_id is distinct from d3.resolved_adset_id
union all
select 'resolved_ad_id',
  count(*) from data_pipeline.shopify_meta_attribution d2
  join data_pipeline.shopify_order_delivery_remittance d3 on d3.shopify_order_id = d2.shopify_order_id
  where d2.resolved_ad_id is distinct from d3.resolved_ad_id;

-- Should be 0 mismatched for all

-- ============================================================
-- Window-specific Day3 metrics (current date 2026-09-04)
-- ============================================================
select
  count(*) as window_total,
  count(*) filter (where shiprocket_match_status = 'MATCHED') as window_matched_to_shiprocket,
  count(*) filter (where delivery_outcome = 'DELIVERED') as window_delivered,
  count(*) filter (where delivery_outcome = 'RTO') as window_rto,
  count(*) filter (where is_delivered_cod_not_remitted) as window_delivered_cod_not_remitted
from data_pipeline.shopify_order_delivery_remittance
where created_at_shopify >= '2026-08-01'::timestamptz
  and created_at_shopify <= '2026-09-04 23:59:59+00'::timestamptz;

-- Channel breakdown for Day3 QA
select
  channel,
  count(*) as orders,
  count(*) filter (where shiprocket_match_status = 'MATCHED') as shiprocket_matched,
  count(*) filter (where delivery_outcome = 'DELIVERED') as delivered,
  count(*) filter (where delivery_outcome = 'RTO') as rto,
  count(*) filter (where order_outcome = 'DELIVERED_COD_REMITTED') as delivered_cod_remitted,
  count(*) filter (where is_delivered_cod_not_remitted) as delivered_cod_not_remitted
from data_pipeline.shopify_order_delivery_remittance
where created_at_shopify >= '2026-08-01'::timestamptz
  and created_at_shopify <= '2026-09-04 23:59:59+00'::timestamptz
group by channel
order by orders desc;

-- Meta sample QA (exact Meta → delivery → remittance)
-- select shopify_order_id, resolved_campaign_name, resolved_adset_name, resolved_ad_name, awb, delivery_outcome, remittance_status, utr
-- from data_pipeline.shopify_order_delivery_remittance
-- where meta_attribution_state in ('EXACT_AD','EXACT_ADSET')
-- order by created_at_shopify desc limit 10;
