-- 040 — Canonical Meta purchases and explicit Shopify revenue semantics.
-- Additive/idempotent: raw Meta action rows and original Shopify totals remain intact.

create schema if not exists data_pipeline;
create schema if not exists analytics;

-- Repair historical derived Meta daily facts from the raw action tables.
-- The action tables retain every provider alias; only the derived daily fields
-- use one canonical alias by priority.
update data_pipeline.meta_ads_daily d
set purchases = case
  when exists (
    select 1 from data_pipeline.meta_ads_actions_daily a
    where a.ad_account_id = d.ad_account_id and a.date = d.date
      and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id
      and a.action_type = 'offsite_conversion.fb_pixel_purchase'
  ) then (select coalesce(a.value, 0) from data_pipeline.meta_ads_actions_daily a where a.ad_account_id = d.ad_account_id and a.date = d.date and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id and a.action_type = 'offsite_conversion.fb_pixel_purchase')
  when exists (
    select 1 from data_pipeline.meta_ads_actions_daily a
    where a.ad_account_id = d.ad_account_id and a.date = d.date
      and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id
      and a.action_type = 'omni_purchase'
  ) then (select coalesce(a.value, 0) from data_pipeline.meta_ads_actions_daily a where a.ad_account_id = d.ad_account_id and a.date = d.date and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id and a.action_type = 'omni_purchase')
  when exists (
    select 1 from data_pipeline.meta_ads_actions_daily a
    where a.ad_account_id = d.ad_account_id and a.date = d.date
      and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id
      and a.action_type = 'purchase'
  ) then (select coalesce(a.value, 0) from data_pipeline.meta_ads_actions_daily a where a.ad_account_id = d.ad_account_id and a.date = d.date and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id and a.action_type = 'purchase')
  else null
end,
purchase_value = case
  when exists (
    select 1 from data_pipeline.meta_ads_action_values_daily a
    where a.ad_account_id = d.ad_account_id and a.date = d.date
      and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id
      and a.action_type = 'offsite_conversion.fb_pixel_purchase'
  ) then (select coalesce(a.conversion_value, 0) from data_pipeline.meta_ads_action_values_daily a where a.ad_account_id = d.ad_account_id and a.date = d.date and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id and a.action_type = 'offsite_conversion.fb_pixel_purchase')
  when exists (
    select 1 from data_pipeline.meta_ads_action_values_daily a
    where a.ad_account_id = d.ad_account_id and a.date = d.date
      and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id
      and a.action_type = 'omni_purchase'
  ) then (select coalesce(a.conversion_value, 0) from data_pipeline.meta_ads_action_values_daily a where a.ad_account_id = d.ad_account_id and a.date = d.date and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id and a.action_type = 'omni_purchase')
  when exists (
    select 1 from data_pipeline.meta_ads_action_values_daily a
    where a.ad_account_id = d.ad_account_id and a.date = d.date
      and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id
      and a.action_type = 'purchase'
  ) then (select coalesce(a.conversion_value, 0) from data_pipeline.meta_ads_action_values_daily a where a.ad_account_id = d.ad_account_id and a.date = d.date and a.campaign_id = d.campaign_id and a.adset_id = d.adset_id and a.ad_id = d.ad_id and a.action_type = 'purchase')
  else null
end;

-- Add explicit current-value measures without changing the existing canonical
-- mart or its one-row-per-Shopify-order grain.
create or replace view data_pipeline.mart_order_journey_profitability with (security_invoker = true) as
select
  j.*,
  o.current_total_price as current_revenue,
  case when j.is_delivered then o.current_total_price else 0 end as delivered_current_revenue
from data_pipeline.mart_order_journey j
join data_pipeline.shopify_orders o using (shopify_order_id);

grant select on data_pipeline.mart_order_journey_profitability to service_role, authenticated;

create or replace view analytics.mart_order_journey_profitability with (security_invoker = true) as
select * from data_pipeline.mart_order_journey_profitability;

grant select on analytics.mart_order_journey_profitability to service_role, authenticated;

comment on view data_pipeline.mart_order_journey_profitability is
'Additive profitability contract: ordered_revenue is original Shopify total_price; current_revenue is current_total_price; delivered_current_revenue is current_revenue only when delivered. One row per Shopify order.';

-- Explicit daily profitability measures for downstream audit/reporting.
create or replace view data_pipeline.mart_meta_commerce_daily_profitability with (security_invoker = true) as
with meta_daily as (
  select date as report_date, campaign_id, max(campaign_name) as campaign_name,
    adset_id, max(adset_name) as adset_name, ad_id, max(ad_name) as ad_name,
    sum(coalesce(spend, 0)) as meta_spend,
    sum(coalesce(impressions, 0)) as meta_impressions,
    sum(coalesce(clicks, 0)) as meta_clicks,
    sum(coalesce(landing_page_views, 0)) as meta_landing_page_views,
    sum(coalesce(purchases, 0)) as meta_purchases,
    sum(coalesce(purchase_value, 0)) as meta_purchase_value
  from data_pipeline.meta_ads_daily
  group by date, campaign_id, adset_id, ad_id
), orders as (
  select order_date as report_date, resolved_campaign_id as campaign_id,
    max(resolved_campaign_name) as campaign_name, resolved_adset_id as adset_id,
    max(resolved_adset_name) as adset_name, resolved_ad_id as ad_id,
    max(resolved_ad_name) as ad_name, count(*) as orders,
    sum(ordered_revenue) as ordered_revenue,
    sum(current_revenue) as current_revenue,
    sum(case when is_delivered then ordered_revenue else 0 end) as delivered_ordered_revenue,
    sum(delivered_current_revenue) as delivered_current_revenue,
    count(*) filter (where is_delivered) as delivered
  from data_pipeline.mart_order_journey_profitability
  where has_exact_meta_attribution and resolved_campaign_id is not null
  group by order_date, resolved_campaign_id, resolved_adset_id, resolved_ad_id
)
select coalesce(m.report_date, o.report_date) as report_date,
  coalesce(m.campaign_id, o.campaign_id) as campaign_id,
  coalesce(m.campaign_name, o.campaign_name) as campaign_name,
  coalesce(m.adset_id, o.adset_id) as adset_id,
  coalesce(m.adset_name, o.adset_name) as adset_name,
  coalesce(m.ad_id, o.ad_id) as ad_id,
  coalesce(m.ad_name, o.ad_name) as ad_name,
  coalesce(m.meta_spend, 0) as meta_spend,
  coalesce(m.meta_impressions, 0) as meta_impressions,
  coalesce(m.meta_clicks, 0) as meta_clicks,
  coalesce(m.meta_landing_page_views, 0) as meta_landing_page_views,
  coalesce(m.meta_purchases, 0) as meta_purchases,
  coalesce(m.meta_purchase_value, 0) as meta_purchase_value,
  coalesce(o.orders, 0) as orders,
  coalesce(o.ordered_revenue, 0) as ordered_revenue,
  o.current_revenue,
  coalesce(o.delivered_ordered_revenue, 0) as delivered_ordered_revenue,
  coalesce(o.delivered_current_revenue, 0) as delivered_current_revenue,
  coalesce(o.delivered, 0) as delivered,
  case when coalesce(m.meta_spend, 0) > 0 then m.meta_purchase_value / m.meta_spend end as meta_roas,
  case when coalesce(m.meta_spend, 0) > 0 then o.ordered_revenue / m.meta_spend end as ordered_roas,
  case when coalesce(m.meta_spend, 0) > 0 then o.current_revenue / m.meta_spend end as current_shopify_roas,
  case when coalesce(m.meta_spend, 0) > 0 then o.delivered_current_revenue / m.meta_spend end as delivered_roas
from meta_daily m full outer join orders o
  on o.report_date = m.report_date and o.campaign_id = m.campaign_id
 and o.adset_id is not distinct from m.adset_id and o.ad_id is not distinct from m.ad_id;

grant select on data_pipeline.mart_meta_commerce_daily_profitability to service_role, authenticated;

create or replace view analytics.mart_meta_commerce_daily_profitability with (security_invoker = true) as
select * from data_pipeline.mart_meta_commerce_daily_profitability;

grant select on analytics.mart_meta_commerce_daily_profitability to service_role, authenticated;
