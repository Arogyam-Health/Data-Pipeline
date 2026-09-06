-- Day 5 validation. Run after migration 038.

-- V1: Explorer remains one row per Shopify order.
select count(*) as journey_rows, count(distinct shopify_order_id) as distinct_orders
from analytics.order_journey_explorer;

-- V2: All Shopify orders remain present.
select
  (select count(*) from data_pipeline.shopify_orders) as shopify_orders,
  (select count(*) from analytics.order_journey_explorer) as journey_orders;

-- V3: Revenue is not multiplied.
select
  (select sum(total_price) from data_pipeline.shopify_orders) as shopify_revenue,
  (select sum(ordered_revenue) from analytics.order_journey_explorer) as journey_revenue;

-- V4: Mutually exclusive attribution states total to all orders.
select attribution_status, count(*)
from analytics.order_journey_explorer
group by attribution_status
order by attribution_status;

-- V5: Quality and outcome distribution.
select
  count(*) filter (where shiprocket_match_status = 'MATCHED') as shopify_shiprocket_matched,
  count(*) filter (where shiprocket_match_status = 'NOT_MATCHED') as shopify_shiprocket_unmatched,
  count(*) filter (where is_delivered) as delivered,
  count(*) filter (where is_rto) as rto,
  count(*) filter (where is_ndr) as ndr,
  count(*) filter (where is_cod and is_delivered and remittance_status = 'REMITTED') as delivered_cod_remitted,
  count(*) filter (where is_cod and is_delivered and remittance_status = 'DELIVERED_NOT_REMITTED') as delivered_cod_not_remitted
from analytics.order_journey_explorer;

-- V6: Meta spend is unchanged by the commerce mart.
select
  (select sum(spend) from data_pipeline.meta_ads_daily) as base_meta_spend,
  (select sum(meta_spend) from analytics.mart_meta_commerce_daily) as mart_meta_spend;

-- V7: RTO/cancelled revenue never contributes to delivered revenue.
select count(*) as invalid_rows
from analytics.order_journey_explorer
where (is_rto or is_cancelled) and delivered_order_value <> 0;

-- V8: Settlement delay only uses available source dates.
select shopify_order_id, delivered_at, latest_remitted_at, remittance_delay_days
from analytics.order_journey_explorer
where remittance_delay_days is not null
order by latest_remitted_at desc
limit 20;

-- V9: Freshness reports each connector separately.
select * from analytics.journey_data_freshness;
