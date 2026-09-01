-- 018_meta_attribution_and_expose.sql
-- Expose metadata fields that were fetched but never surfaced in analytics views.
-- Adds attribution_spec to campaigns/adsets and exposes status/effective_status/budget/ends.

-- Attribution spec (e.g. [{"event_type":"CLICK","window_days":7},{"event_type":"VIEW","window_days":1}])
alter table data_pipeline.meta_campaigns add column if not exists attribution_spec jsonb;
alter table data_pipeline.meta_campaigns add column if not exists attribution_setting text;

alter table data_pipeline.meta_adsets add column if not exists attribution_spec jsonb;
alter table data_pipeline.meta_adsets add column if not exists attribution_setting text;

-- Ensure budget columns exist (they do via 013, but add index if missing)
create index if not exists idx_meta_campaigns_effective_status on data_pipeline.meta_campaigns(effective_status);
create index if not exists idx_meta_adsets_effective_status on data_pipeline.meta_adsets(effective_status);

-- Update analytics views to left join dimensions so dashboard can show Delivery/Budget/Ends/Bid
-- Must DROP first because we insert new columns before spend (42P16 if using CREATE OR REPLACE)
drop view if exists analytics.meta_campaign_performance cascade;

create view analytics.meta_campaign_performance as
select
  d.ad_account_id,
  d.campaign_id,
  d.campaign_name,
  coalesce(c.effective_status, c.status) as delivery,
  c.status as status,
  c.effective_status,
  c.daily_budget,
  c.lifetime_budget,
  coalesce(c.daily_budget, c.lifetime_budget) as budget,
  c.stop_time as ends,
  c.attribution_setting,
  coalesce(sum(d.spend), 0) as spend,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.reach), 0) as reach,
  case when coalesce(sum(d.impressions),0)>0 then sum(d.clicks)::numeric / sum(d.impressions) else null end as ctr,
  case when coalesce(sum(d.impressions),0)>0 then sum(d.spend)/sum(d.impressions)*1000 else null end as cpm,
  case when coalesce(sum(d.impressions),0)>0 then sum(coalesce(d.frequency,0)*coalesce(d.impressions,0))/sum(d.impressions) else null end as frequency,
  coalesce(sum(d.inline_link_clicks),0) as link_clicks,
  coalesce(sum(d.landing_page_views),0) as landing_page_views,
  coalesce(sum(d.adds_to_cart),0) as adds_to_cart,
  coalesce(sum(d.checkouts_initiated),0) as checkouts,
  coalesce(sum(d.purchases),0) as purchases,
  coalesce(sum(d.purchase_value),0) as purchase_value,
  case when coalesce(sum(d.purchases),0)>0 then sum(d.spend)/sum(d.purchases) else null end as cost_per_purchase,
  case when coalesce(sum(d.spend),0)>0 then sum(d.purchase_value)/sum(d.spend) else null end as roas
from data_pipeline.meta_ads_daily d
left join data_pipeline.meta_campaigns c on c.campaign_id = d.campaign_id
group by d.ad_account_id, d.campaign_id, d.campaign_name, c.effective_status, c.status, c.daily_budget, c.lifetime_budget, c.stop_time, c.attribution_setting;

drop view if exists analytics.meta_adset_performance cascade;

create view analytics.meta_adset_performance as
select
  d.ad_account_id,
  d.campaign_id,
  d.campaign_name,
  d.adset_id,
  d.adset_name,
  coalesce(a.effective_status, a.status) as delivery,
  a.status, a.effective_status,
  a.daily_budget, a.lifetime_budget, coalesce(a.daily_budget, a.lifetime_budget) as budget,
  a.end_time as ends,
  a.bid_strategy,
  a.attribution_setting,
  coalesce(sum(d.spend),0) as spend,
  coalesce(sum(d.impressions),0) as impressions,
  coalesce(sum(d.reach),0) as reach,
  case when coalesce(sum(d.impressions),0)>0 then sum(d.clicks)::numeric / sum(d.impressions) else null end as ctr,
  case when coalesce(sum(d.impressions),0)>0 then sum(d.spend)/sum(d.impressions)*1000 else null end as cpm,
  case when coalesce(sum(d.impressions),0)>0 then sum(coalesce(d.frequency,0)*coalesce(d.impressions,0))/sum(d.impressions) else null end as frequency,
  coalesce(sum(d.inline_link_clicks),0) as link_clicks,
  coalesce(sum(d.landing_page_views),0) as landing_page_views,
  coalesce(sum(d.adds_to_cart),0) as adds_to_cart,
  coalesce(sum(d.checkouts_initiated),0) as checkouts,
  coalesce(sum(d.purchases),0) as purchases,
  coalesce(sum(d.purchase_value),0) as purchase_value,
  case when coalesce(sum(d.purchases),0)>0 then sum(d.spend)/sum(d.purchases) else null end as cost_per_purchase,
  case when coalesce(sum(d.spend),0)>0 then sum(d.purchase_value)/sum(d.spend) else null end as roas
from data_pipeline.meta_ads_daily d
left join data_pipeline.meta_adsets a on a.adset_id = d.adset_id
left join data_pipeline.meta_campaigns c on c.campaign_id = d.campaign_id
group by d.ad_account_id, d.campaign_id, d.campaign_name, d.adset_id, d.adset_name, a.effective_status, a.status, a.daily_budget, a.lifetime_budget, a.end_time, a.bid_strategy, a.attribution_setting;

-- Grant remains
grant select on analytics.meta_campaign_performance to service_role, authenticated;
grant select on analytics.meta_adset_performance to service_role, authenticated;
