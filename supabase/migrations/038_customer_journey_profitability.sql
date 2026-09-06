-- 038_customer_journey_profitability.sql
-- Day 5 business-facing customer journey and Meta profitability layer.
-- Additive only: applied Day 1-4 migrations are not changed.

create schema if not exists data_pipeline;
create schema if not exists analytics;

-- One row per Shopify order. This view adds display/quality fields that are
-- intentionally absent from the compact Day 4 mart. No child-grain table is
-- joined without first reducing it to one row per order.
create or replace view data_pipeline.order_journey_explorer with (security_invoker = true) as
with refunds as (
  select
    shopify_order_id,
    coalesce(sum(abs(amount)) filter (where lower(coalesce(kind, '')) = 'refund' and lower(coalesce(status, '')) = 'success'), 0) as refund_amount
  from data_pipeline.shopify_transactions
  group by shopify_order_id
), base as (
  select
    j.*,
    a.utm_source_raw as utm_source,
    a.utm_medium_raw as utm_medium,
    a.utm_campaign_raw as utm_campaign,
    a.utm_term_raw as utm_term,
    a.utm_content_raw as utm_content,
    o.current_total_price as net_revenue,
    o.total_discounts as discount_amount,
    coalesce(r.refund_amount, 0) as refund_amount,
    o.cancelled_at,
    o.cancel_reason,
    ma.creative_id,
    mc.name as creative_name
  from data_pipeline.mart_order_journey j
  join data_pipeline.shopify_meta_attribution a using (shopify_order_id)
  join data_pipeline.shopify_orders o using (shopify_order_id)
  left join refunds r using (shopify_order_id)
  left join data_pipeline.meta_ads ma on ma.ad_id = j.resolved_ad_id
  left join data_pipeline.meta_creatives mc on mc.creative_id = ma.creative_id
)
select
  b.*,
  case
    when b.meta_attribution_state in ('EXACT_AD', 'EXACT_ADSET', 'EXACT_CAMPAIGN') then b.meta_attribution_state
    when b.meta_attribution_state = 'META_SOURCE_ONLY' then 'META_SOURCE_ONLY'
    else 'UNATTRIBUTED'
  end as attribution_status,
  case
    when b.meta_attribution_state = 'EXACT_AD' then 'HIGH'
    when b.meta_attribution_state in ('EXACT_ADSET', 'EXACT_CAMPAIGN') then 'MEDIUM'
    when b.meta_attribution_state = 'META_SOURCE_ONLY' then 'LOW'
    else 'NONE'
  end as attribution_confidence,
  nullif(concat_ws('; ',
    case when b.adset_consistency_status = 'CONFLICT' then 'utm_term contradicts the Meta ad hierarchy' end,
    case when b.campaign_consistency_status = 'CONFLICT' then 'utm_campaign contradicts the resolved Meta hierarchy' end
  ), '') as conflict_reason,
  case
    when b.channel = 'DIRECT' then 'Direct'
    when b.channel = 'UNKNOWN' then 'Direct / Unknown'
    else coalesce(nullif(b.utm_source, ''), b.channel, 'Direct / Unknown')
  end as source_display,
  case
    when b.shiprocket_match_status = 'MATCHED' then 'MATCHED'
    when b.shiprocket_match_status = 'AMBIGUOUS' then 'AMBIGUOUS'
    else 'NOT MATCHED'
  end as shopify_shiprocket_quality,
  case
    when b.remittance_status = 'REMITTED' then 'MATCHED'
    when b.remittance_status = 'DELIVERED_NOT_REMITTED' then 'NOT YET REMITTED'
    when b.remittance_status = 'AMBIGUOUS' then 'AMBIGUOUS'
    else 'NOT APPLICABLE'
  end as shiprocket_remittance_quality,
  case
    when b.shiprocket_match_status <> 'MATCHED' then 'COMMERCE_ONLY'
    when b.is_cod and b.is_delivered and b.remittance_status <> 'REMITTED' then 'DELIVERY_COMPLETE_SETTLEMENT_MISSING'
    when b.is_cod and b.is_delivered and b.remittance_status = 'REMITTED' then 'COMPLETE'
    when b.is_delivered then 'DELIVERY_COMPLETE'
    when b.delivery_outcome in ('RTO', 'CANCELLED') then 'FINAL_OUTCOME_AVAILABLE'
    else 'IN_PROGRESS'
  end as journey_completeness,
  case
    when b.delivered_at is not null and b.latest_remitted_at is not null
      then b.latest_remitted_at::date - b.delivered_at::date
    else null
  end as remittance_delay_days
from base b;

grant select on data_pipeline.order_journey_explorer to service_role, authenticated;

create or replace view analytics.order_journey_explorer with (security_invoker = true) as
select * from data_pipeline.order_journey_explorer;

grant select on analytics.order_journey_explorer to service_role, authenticated;

-- Meta is first aggregated at date+campaign+adset+ad. Orders are separately
-- aggregated to that same reporting grain. Joining occurs only after both
-- sides are safe, so spend cannot multiply by order count.
create or replace view data_pipeline.mart_meta_commerce_daily with (security_invoker = true) as
with meta_daily as (
  select
    date as report_date,
    campaign_id,
    max(campaign_name) as campaign_name,
    adset_id,
    max(adset_name) as adset_name,
    ad_id,
    max(ad_name) as ad_name,
    sum(coalesce(spend, 0)) as meta_spend,
    sum(coalesce(impressions, 0)) as meta_impressions,
    sum(coalesce(reach, 0)) as meta_reach,
    sum(coalesce(clicks, 0)) as meta_clicks,
    sum(coalesce(landing_page_views, 0)) as meta_landing_page_views,
    sum(coalesce(purchases, 0)) as meta_reported_purchases,
    sum(coalesce(purchase_value, 0)) as meta_reported_purchase_value,
    max(last_synced_at) as meta_last_synced_at
  from data_pipeline.meta_ads_daily
  group by date, campaign_id, adset_id, ad_id
), order_daily as (
  select
    order_date as report_date,
    resolved_campaign_id as campaign_id,
    max(resolved_campaign_name) as campaign_name,
    resolved_adset_id as adset_id,
    max(resolved_adset_name) as adset_name,
    resolved_ad_id as ad_id,
    max(resolved_ad_name) as ad_name,
    count(*) as attributed_orders,
    count(*) filter (where lower(coalesce(financial_status, '')) in ('paid', 'partially_paid')) as paid_orders,
    sum(coalesce(net_revenue, ordered_revenue, 0)) as attributed_shopify_revenue,
    count(*) filter (where is_shipped) as shipped_orders,
    count(*) filter (where is_delivered) as delivered_orders,
    count(*) filter (where is_rto) as rto_orders,
    count(*) filter (where is_ndr) as ndr_orders,
    sum(case when is_delivered then coalesce(net_revenue, ordered_revenue, 0) else 0 end) as delivered_revenue,
    count(*) filter (where is_cod and is_delivered) as delivered_cod_orders,
    count(*) filter (where is_cod and is_delivered and remittance_status = 'REMITTED') as remitted_cod_orders,
    count(*) filter (where is_cod and is_delivered and remittance_status = 'DELIVERED_NOT_REMITTED') as delivered_not_remitted_orders,
    count(*) filter (where hierarchy_conflict) as conflict_orders
  from data_pipeline.order_journey_explorer
  where attribution_status in ('EXACT_AD', 'EXACT_ADSET', 'EXACT_CAMPAIGN')
    and resolved_campaign_id is not null
  group by order_date, resolved_campaign_id, resolved_adset_id, resolved_ad_id
)
select
  coalesce(m.report_date, o.report_date) as report_date,
  coalesce(m.campaign_id, o.campaign_id) as campaign_id,
  coalesce(m.campaign_name, o.campaign_name) as campaign_name,
  coalesce(m.adset_id, o.adset_id) as adset_id,
  coalesce(m.adset_name, o.adset_name) as adset_name,
  coalesce(m.ad_id, o.ad_id) as ad_id,
  coalesce(m.ad_name, o.ad_name) as ad_name,
  coalesce(m.meta_spend, 0) as meta_spend,
  coalesce(m.meta_impressions, 0) as meta_impressions,
  coalesce(m.meta_reach, 0) as meta_reach,
  coalesce(m.meta_clicks, 0) as meta_clicks,
  coalesce(m.meta_landing_page_views, 0) as meta_landing_page_views,
  coalesce(m.meta_reported_purchases, 0) as meta_reported_purchases,
  coalesce(m.meta_reported_purchase_value, 0) as meta_reported_purchase_value,
  coalesce(o.attributed_orders, 0) as attributed_orders,
  coalesce(o.paid_orders, 0) as paid_orders,
  coalesce(o.attributed_shopify_revenue, 0) as attributed_shopify_revenue,
  coalesce(o.shipped_orders, 0) as shipped_orders,
  coalesce(o.delivered_orders, 0) as delivered_orders,
  coalesce(o.rto_orders, 0) as rto_orders,
  coalesce(o.ndr_orders, 0) as ndr_orders,
  coalesce(o.delivered_revenue, 0) as delivered_revenue,
  coalesce(o.delivered_cod_orders, 0) as delivered_cod_orders,
  coalesce(o.remitted_cod_orders, 0) as remitted_cod_orders,
  coalesce(o.delivered_not_remitted_orders, 0) as delivered_not_remitted_orders,
  coalesce(o.conflict_orders, 0) as conflict_orders,
  case when coalesce(m.meta_spend, 0) > 0 then m.meta_reported_purchase_value / m.meta_spend end as meta_reported_roas,
  case when coalesce(m.meta_spend, 0) > 0 then o.attributed_shopify_revenue / m.meta_spend end as shopify_attributed_roas,
  case when coalesce(m.meta_spend, 0) > 0 then o.delivered_revenue / m.meta_spend end as delivered_roas,
  m.meta_last_synced_at
from meta_daily m
full outer join order_daily o
  on o.report_date = m.report_date
 and o.campaign_id = m.campaign_id
 and o.adset_id is not distinct from m.adset_id
 and o.ad_id is not distinct from m.ad_id;

grant select on data_pipeline.mart_meta_commerce_daily to service_role, authenticated;

create or replace view analytics.mart_meta_commerce_daily with (security_invoker = true) as
select * from data_pipeline.mart_meta_commerce_daily;

grant select on analytics.mart_meta_commerce_daily to service_role, authenticated;

create or replace view data_pipeline.journey_data_freshness with (security_invoker = true) as
select
  (select max(coalesce(last_successful_today_sync_at, last_successful_recent_repair_at, last_backfill_completed_at)) from data_pipeline.meta_sync_state) as meta_last_successful_sync_at,
  (select max(last_successful_sync_at) from data_pipeline.shopify_sync_state) as shopify_last_successful_sync_at,
  (select max(last_webhook_sync_at) from data_pipeline.shiprocket_orders) as shiprocket_last_sync_at,
  (select max(completed_at) from data_pipeline.shiprocket_remittance_imports where status = 'completed') as remittance_last_import_at;

grant select on data_pipeline.journey_data_freshness to service_role, authenticated;

create or replace view analytics.journey_data_freshness with (security_invoker = true) as
select * from data_pipeline.journey_data_freshness;

grant select on analytics.journey_data_freshness to service_role, authenticated;

comment on view data_pipeline.order_journey_explorer is
'Business-facing one-row-per-Shopify-order explorer. Includes explicit attribution evidence/quality, commerce truth, shipment outcome, remittance, and completeness.';
comment on view data_pipeline.mart_meta_commerce_daily is
'Day 5 daily Meta commerce mart. Meta and Shopify journey metrics are independently aggregated before joining; spend is never joined to raw orders.';
