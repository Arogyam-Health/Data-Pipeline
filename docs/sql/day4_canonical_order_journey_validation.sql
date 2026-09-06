-- docs/sql/day4_canonical_order_journey_validation.sql
-- Day 4 — Canonical Order Journey Mart — Validation V1-V18
-- Target: data_pipeline.mart_order_journey (alias analytics.mart_order_journey)
-- Source: supabase/migrations/037_canonical_order_journey.sql
-- Validates: grain, Day3 preservation, revenue, channel, delivery, remittance, time, funnel

-- ============================================================
-- V1 — One row per Shopify order
-- ============================================================
select count(*) as rows, count(distinct shopify_order_id) as distinct_orders,
       (count(*) = count(distinct shopify_order_id)) as is_one_row_per_order
from data_pipeline.mart_order_journey;
-- select shopify_order_id, count(*) from data_pipeline.mart_order_journey group by shopify_order_id having count(*) > 1;

-- ============================================================
-- V2 — Day3 preservation (Day4 count = Day3 count)
-- ============================================================
select
  (select count(*) from data_pipeline.shopify_order_delivery_remittance) as day3_rows,
  (select count(*) from data_pipeline.mart_order_journey) as day4_rows,
  ((select count(*) from data_pipeline.shopify_order_delivery_remittance) = (select count(*) from data_pipeline.mart_order_journey)) as equal;
-- select shopify_order_id from data_pipeline.shopify_order_delivery_remittance except select shopify_order_id from data_pipeline.mart_order_journey;
-- select shopify_order_id from data_pipeline.mart_order_journey except select shopify_order_id from data_pipeline.shopify_order_delivery_remittance;

-- ============================================================
-- V3 — No revenue duplication (Shopify total)
-- ============================================================
select
  (select coalesce(sum(shopify_order_total::numeric),0) from data_pipeline.shopify_order_delivery_remittance) as day3_sum,
  (select coalesce(sum(ordered_revenue),0) from data_pipeline.mart_order_journey) as day4_sum,
  (select coalesce(sum(shopify_order_total::numeric),0) from data_pipeline.shopify_order_delivery_remittance)
    - (select coalesce(sum(ordered_revenue),0) from data_pipeline.mart_order_journey) as diff;

-- ============================================================
-- V4 — Channel preservation (META/DIRECT/GOOGLE/KWIKENGAGE/OTHER/UNKNOWN)
-- ============================================================
select channel, count(*) as day3_cnt from data_pipeline.shopify_order_delivery_remittance group by channel order by channel;
select channel, count(*) as day4_cnt from data_pipeline.mart_order_journey group by channel order by channel;
-- Diff per channel should be 0
-- select d3.channel, d3.cnt as day3, d4.cnt as day4, d3.cnt - d4.cnt as diff from
--   (select channel, count(*) as cnt from data_pipeline.shopify_order_delivery_remittance group by channel) d3
--   full join (select channel, count(*) as cnt from data_pipeline.mart_order_journey group by channel) d4 using (channel);

-- ============================================================
-- V5 — Meta attribution preservation
-- ============================================================
select meta_attribution_state, count(*) from data_pipeline.shopify_order_delivery_remittance group by meta_attribution_state order by meta_attribution_state;
select meta_attribution_state, count(*) from data_pipeline.mart_order_journey group by meta_attribution_state order by meta_attribution_state;

-- ============================================================
-- V6 — Shiprocket match preservation
-- ============================================================
select shiprocket_match_status, count(*) from data_pipeline.shopify_order_delivery_remittance group by shiprocket_match_status order by shiprocket_match_status;
select shiprocket_match_status, count(*) from data_pipeline.mart_order_journey group by shiprocket_match_status order by shiprocket_match_status;

-- ============================================================
-- V7 — Delivery status distribution
-- ============================================================
select delivery_outcome, count(*) as orders, round(100.0*count(*)/sum(count(*)) over (),2) as pct
from data_pipeline.mart_order_journey group by delivery_outcome order by orders desc;
select canonical_order_outcome, count(*) as orders from data_pipeline.mart_order_journey group by canonical_order_outcome order by orders desc;

-- ============================================================
-- V8 — Current-status contradiction audit (is_delivered but UNDELIVERED/NDR/RTO/CANCELLED)
-- ============================================================
select count(*) as contradictions
from data_pipeline.mart_order_journey
where is_delivered = true
  and (lower(coalesce(shiprocket_current_status_raw,'')) in ('undelivered')
       or lower(coalesce(shiprocket_current_status_raw,'')) like '%ndr%'
       or lower(coalesce(shiprocket_current_status_raw,'')) like '%rto%'
       or lower(coalesce(shiprocket_current_status_raw,'')) like '%cancelled%'
       or lower(coalesce(shiprocket_status_raw,'')) = 'undelivered');
-- Expected 0 after Day3 fix (status_id='7' exact). List if any:
-- select shopify_order_id, shiprocket_status_raw, shiprocket_current_status_raw, delivery_outcome, is_delivered from data_pipeline.mart_order_journey where is_delivered and lower(coalesce(shiprocket_current_status_raw,''))='undelivered' limit 10;

-- ============================================================
-- V9 — Delivered timestamp audit
-- ============================================================
select
  count(*) filter (where delivery_outcome='DELIVERED') as delivered_orders,
  count(*) filter (where delivery_outcome='DELIVERED' and delivered_at is not null) as with_delivered_at,
  count(*) filter (where delivery_outcome='DELIVERED' and delivered_at is null) as missing_delivered_at
from data_pipeline.mart_order_journey;

-- ============================================================
-- V10 — Payment distribution
-- ============================================================
select payment_type, count(*) as orders, round(100.0*count(*)/sum(count(*)) over (),2) as pct
from data_pipeline.mart_order_journey group by payment_type order by orders desc;
select is_cod, count(*) from data_pipeline.mart_order_journey group by is_cod;

-- ============================================================
-- V11 — Outcome exclusivity (exactly one canonical_order_outcome)
-- ============================================================
select canonical_order_outcome, count(*) as orders from data_pipeline.mart_order_journey group by canonical_order_outcome order by orders desc;
select count(*) as null_outcome from data_pipeline.mart_order_journey where canonical_order_outcome is null;

-- ============================================================
-- V12 — Revenue measure integrity (only delivered has delivered_value etc.)
-- ============================================================
select count(*) as violations from data_pipeline.mart_order_journey where delivered_order_value > 0 and not is_delivered;
select count(*) as violations from data_pipeline.mart_order_journey where rto_order_value > 0 and not is_rto;
select count(*) as violations from data_pipeline.mart_order_journey where cancelled_order_value > 0 and not is_cancelled;

-- ============================================================
-- V13 — COD settlement integrity (deliveredCOD+remittance)
-- ============================================================
select count(*) as violations from data_pipeline.mart_order_journey
where delivered_cod_with_remittance_count = 1
  and not (is_delivered and is_cod and has_remittance_evidence);

-- ============================================================
-- V14 — Prepaid settlement isolation (no COD remittance for prepaid)
-- ============================================================
select count(*) as violations from data_pipeline.mart_order_journey
where is_prepaid and delivered_cod_without_remittance_evidence_count = 1;

-- ============================================================
-- V15 — Time metric integrity (no negative durations)
-- ============================================================
select count(*) as negative_order_to_ship from data_pipeline.mart_order_journey where days_order_to_ship is not null and days_order_to_ship < 0;
select count(*) as negative_ship_to_delivery from data_pipeline.mart_order_journey where days_ship_to_delivery is not null and days_ship_to_delivery < 0;
select count(*) as negative_order_to_delivery from data_pipeline.mart_order_journey where days_order_to_delivery is not null and days_order_to_delivery < 0;
-- select shopify_order_id, shipped_at, delivered_at, days_ship_to_delivery from data_pipeline.mart_order_journey where days_ship_to_delivery < 0 limit 5;

-- ============================================================
-- V16 — Ambiguous preservation
-- ============================================================
select shiprocket_match_status, count(*) from data_pipeline.mart_order_journey where shiprocket_match_status='AMBIGUOUS' group by shiprocket_match_status;
select remittance_match_status, count(*) from data_pipeline.mart_order_journey where remittance_match_status='AMBIGUOUS' group by remittance_match_status;
select order_outcome, count(*) from data_pipeline.mart_order_journey where order_outcome='AMBIGUOUS' group by order_outcome;
select canonical_order_outcome, count(*) from data_pipeline.mart_order_journey where canonical_order_outcome='AMBIGUOUS' group by canonical_order_outcome;

-- ============================================================
-- V17 — Customer duplication analysis (if customer_key exists)
-- ============================================================
select count(*) as distinct_orders, count(distinct customer_key) as distinct_customers,
       round(count(*)::numeric / nullif(count(distinct customer_key),0),2) as avg_orders_per_customer
from data_pipeline.mart_order_journey where customer_key is not null;
select customer_key, count(*) as orders from data_pipeline.mart_order_journey where customer_key is not null group by customer_key order by orders desc limit 10;

-- ============================================================
-- V18 — Full journey coverage
-- ============================================================
select
  count(*) as total_orders,
  count(*) filter (where channel_attributed) as known_channel,
  count(*) filter (where has_exact_meta_attribution) as exact_meta,
  count(*) filter (where has_shiprocket_match) as shiprocket_matched,
  count(*) filter (where is_delivered) as delivered,
  count(*) filter (where is_rto) as rto,
  count(*) filter (where is_delivered and is_cod) as cod_delivered,
  count(*) filter (where has_remittance_evidence) as cod_with_remittance_evidence,
  count(*) filter (where is_delivered and is_cod and not has_remittance_evidence) as cod_without_remittance_evidence,
  count(*) filter (where has_complete_delivery_journey) as complete_delivery_journey,
  count(*) filter (where has_complete_financial_journey) as complete_financial_journey
from data_pipeline.mart_order_journey;

-- ============================================================
-- Window-specific (2026-08-01 to 2026-09-04) for Day 3/4 comparison
-- ============================================================
select
  count(*) as window_total,
  count(*) filter (where has_exact_meta_attribution) as window_exact_meta,
  count(*) filter (where has_shiprocket_match) as window_shiprocket_matched,
  count(*) filter (where is_delivered) as window_delivered
from data_pipeline.mart_order_journey
where order_date between '2026-08-01' and '2026-09-04';

-- Channel QA (window)
select
  channel,
  count(*) as orders,
  count(*) filter (where has_shiprocket_match) as sr_matched,
  count(*) filter (where is_delivered) as delivered,
  count(*) filter (where is_rto) as rto,
  coalesce(sum(delivered_order_value),0) as delivered_value,
  count(*) filter (where is_delivered and is_cod) as cod_delivered,
  count(*) filter (where has_remittance_evidence) as cod_remittance_evidence
from data_pipeline.mart_order_journey
where order_date between '2026-08-01' and '2026-09-04'
group by channel order by orders desc;

-- Meta QA (window, exact Meta only, no spend yet)
select
  resolved_campaign_id,
  resolved_campaign_name,
  count(*) as orders,
  count(*) filter (where has_shiprocket_match) as sr_matched,
  count(*) filter (where is_delivered) as delivered,
  count(*) filter (where is_rto) as rto
from data_pipeline.mart_order_journey
where order_date between '2026-08-01' and '2026-09-04'
  and has_exact_meta_attribution
group by resolved_campaign_id, resolved_campaign_name
order by orders desc limit 20;
