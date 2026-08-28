-- 015_meta_ads_analytics.sql
-- Meta Ads analytics views for the Next.js + Recharts dashboard.
-- Does NOT alter existing analytics.shiprocket_* or analytics.shopify_* views.
-- Portable: no project IDs, no URLs, no credentials, no access tokens.

create schema if not exists analytics;

-- Safe ratio: null when the denominator is 0 (never Infinity/NaN).
-- Campaign Type has no current business rule → 'Unclassified'.

create or replace view analytics.meta_ads_daily as
select
  d.ad_account_id,
  d.date,
  extract(month from d.date)::int as month,
  extract(week from d.date)::int as week,
  d.campaign_id,
  d.campaign_name,
  d.adset_id,
  d.adset_name,
  d.ad_id,
  d.ad_name,
  d.objective,
  'Unclassified'::text as campaign_type,
  d.spend,
  d.impressions,
  d.reach,
  d.frequency,
  d.clicks,
  d.inline_link_clicks as link_clicks,
  d.landing_page_views,
  d.inline_link_click_ctr,
  d.ctr,
  d.cpc,
  d.cpm,
  d.cost_per_inline_link_click,
  d.adds_to_cart,
  d.checkouts_initiated,
  d.checkouts_initiated_value,
  d.purchases,
  d.purchase_value,
  d.website_purchases,
  d.messaging_conversations_started,
  d.registrations_completed,
  d.purchase_roas,
  d.website_purchase_roas,
  d.instant_experience_view_percentage,
  d.video_avg_play_time,
  d.video_plays,
  d.video_plays_25,
  d.video_plays_50,
  d.video_plays_75,
  d.video_plays_95,
  d.video_plays_100,
  d.thruplays,
  case
    when coalesce(d.inline_link_clicks, 0) > 0
    then d.landing_page_views / d.inline_link_clicks
    else null
  end as lpv_rate,
  case
    when coalesce(d.purchases, 0) > 0
    then d.spend / d.purchases
    else null
  end as cost_per_purchase,
  case
    when coalesce(d.adds_to_cart, 0) > 0
    then d.spend / d.adds_to_cart
    else null
  end as cost_per_add_to_cart,
  case
    when coalesce(d.checkouts_initiated, 0) > 0
    then d.spend / d.checkouts_initiated
    else null
  end as cost_per_checkout,
  a.currency,
  a.timezone_name
from data_pipeline.meta_ads_daily d
left join data_pipeline.meta_ad_accounts a
  on a.ad_account_id = d.ad_account_id;

-- Legacy Google Sheet column parity (validation / comparison only).
create or replace view analytics.meta_ads_sheet_parity as
select
  d.campaign_name,
  d.adset_name as ad_set_name,
  d.ad_name,
  d.campaign_id,
  d.adset_id as ad_set_id,
  d.ad_id,
  d.date,
  d.objective,
  d.instant_experience_view_percentage,
  case
    when coalesce(d.inline_link_clicks, 0) > 0
    then d.landing_page_views / d.inline_link_clicks
    else null
  end as lpv_rate,
  d.cpm,
  d.ctr as ctr_all,
  d.frequency,
  d.impressions,
  d.reach,
  d.spend as amount_spent,
  d.adds_to_cart,
  coalesce(d.cost_per_inline_link_click, d.cpc) as cpc_link_click,
  d.inline_link_click_ctr as ctr_link_click,
  d.checkouts_initiated,
  d.checkouts_initiated_value,
  case
    when coalesce(d.purchases, 0) > 0
    then d.spend / d.purchases
    else null
  end as cost_per_purchase,
  d.landing_page_views,
  coalesce(d.inline_link_clicks, d.clicks) as link_clicks,
  d.messaging_conversations_started,
  d.purchase_roas,
  d.purchases,
  d.purchase_value as purchases_conversion_value,
  d.registrations_completed,
  d.video_avg_play_time,
  d.video_plays_25,
  d.video_plays_95,
  d.website_purchase_roas,
  d.website_purchases,
  extract(month from d.date)::int as month,
  extract(week from d.date)::int as week,
  d.impressions as impressions_int,
  'Unclassified'::text as campaign_type
from data_pipeline.meta_ads_daily d;

create or replace view analytics.meta_ads_kpis as
select
  d.ad_account_id,
  coalesce(sum(d.spend), 0) as spend,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.reach), 0) as reach,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(coalesce(d.frequency, 0) * coalesce(d.impressions, 0)) / sum(d.impressions)
    else null
  end as frequency,
  coalesce(sum(d.clicks), 0) as clicks,
  coalesce(sum(d.inline_link_clicks), 0) as link_clicks,
  coalesce(sum(d.landing_page_views), 0) as landing_page_views,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(d.clicks)::numeric / sum(d.impressions)
    else null
  end as ctr,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(d.inline_link_clicks)::numeric / sum(d.impressions)
    else null
  end as link_ctr,
  case
    when coalesce(sum(d.inline_link_clicks), 0) > 0
    then sum(d.spend) / sum(d.inline_link_clicks)
    else null
  end as cpc,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(d.spend) / sum(d.impressions) * 1000
    else null
  end as cpm,
  coalesce(sum(d.adds_to_cart), 0) as adds_to_cart,
  coalesce(sum(d.checkouts_initiated), 0) as checkouts,
  coalesce(sum(d.purchases), 0) as purchases,
  case
    when coalesce(sum(d.adds_to_cart), 0) > 0
    then sum(d.spend) / sum(d.adds_to_cart)
    else null
  end as cost_per_add_to_cart,
  case
    when coalesce(sum(d.checkouts_initiated), 0) > 0
    then sum(d.spend) / sum(d.checkouts_initiated)
    else null
  end as cost_per_checkout,
  case
    when coalesce(sum(d.purchases), 0) > 0
    then sum(d.spend) / sum(d.purchases)
    else null
  end as cost_per_purchase,
  coalesce(sum(d.purchase_value), 0) as purchase_value,
  case
    when coalesce(sum(d.spend), 0) > 0
    then sum(d.purchase_value) / sum(d.spend)
    else null
  end as roas,
  coalesce(sum(d.website_purchases), 0) as website_purchases,
  coalesce(sum(d.messaging_conversations_started), 0) as messaging_conversations,
  coalesce(sum(d.registrations_completed), 0) as registrations
from data_pipeline.meta_ads_daily d
group by d.ad_account_id;

create or replace view analytics.meta_ads_daily_summary as
select
  d.ad_account_id,
  d.date,
  coalesce(sum(d.spend), 0) as spend,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.reach), 0) as reach,
  coalesce(sum(d.inline_link_clicks), 0) as link_clicks,
  coalesce(sum(d.landing_page_views), 0) as landing_page_views,
  coalesce(sum(d.adds_to_cart), 0) as adds_to_cart,
  coalesce(sum(d.checkouts_initiated), 0) as checkouts,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.purchase_value), 0) as purchase_value,
  case
    when coalesce(sum(d.spend), 0) > 0
    then sum(d.purchase_value) / sum(d.spend)
    else null
  end as roas
from data_pipeline.meta_ads_daily d
group by d.ad_account_id, d.date;

create or replace view analytics.meta_campaign_performance as
select
  d.ad_account_id,
  d.campaign_id,
  d.campaign_name,
  coalesce(sum(d.spend), 0) as spend,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.reach), 0) as reach,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(d.clicks)::numeric / sum(d.impressions)
    else null
  end as ctr,
  coalesce(sum(d.inline_link_clicks), 0) as link_clicks,
  coalesce(sum(d.landing_page_views), 0) as landing_page_views,
  coalesce(sum(d.adds_to_cart), 0) as adds_to_cart,
  coalesce(sum(d.checkouts_initiated), 0) as checkouts,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.purchase_value), 0) as purchase_value,
  case
    when coalesce(sum(d.purchases), 0) > 0
    then sum(d.spend) / sum(d.purchases)
    else null
  end as cost_per_purchase,
  case
    when coalesce(sum(d.spend), 0) > 0
    then sum(d.purchase_value) / sum(d.spend)
    else null
  end as roas
from data_pipeline.meta_ads_daily d
group by d.ad_account_id, d.campaign_id, d.campaign_name;

create or replace view analytics.meta_adset_performance as
select
  d.ad_account_id,
  d.campaign_id,
  d.campaign_name,
  d.adset_id,
  d.adset_name,
  coalesce(sum(d.spend), 0) as spend,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.reach), 0) as reach,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(d.clicks)::numeric / sum(d.impressions)
    else null
  end as ctr,
  coalesce(sum(d.inline_link_clicks), 0) as link_clicks,
  coalesce(sum(d.landing_page_views), 0) as landing_page_views,
  coalesce(sum(d.adds_to_cart), 0) as adds_to_cart,
  coalesce(sum(d.checkouts_initiated), 0) as checkouts,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.purchase_value), 0) as purchase_value,
  case
    when coalesce(sum(d.purchases), 0) > 0
    then sum(d.spend) / sum(d.purchases)
    else null
  end as cost_per_purchase,
  case
    when coalesce(sum(d.spend), 0) > 0
    then sum(d.purchase_value) / sum(d.spend)
    else null
  end as roas
from data_pipeline.meta_ads_daily d
group by d.ad_account_id, d.campaign_id, d.campaign_name, d.adset_id, d.adset_name;

create or replace view analytics.meta_ad_performance as
select
  d.ad_account_id,
  d.campaign_id,
  d.campaign_name,
  d.adset_id,
  d.adset_name,
  d.ad_id,
  d.ad_name,
  coalesce(sum(d.spend), 0) as spend,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(coalesce(d.frequency, 0) * coalesce(d.impressions, 0)) / sum(d.impressions)
    else null
  end as frequency,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(d.clicks)::numeric / sum(d.impressions)
    else null
  end as ctr,
  coalesce(sum(d.inline_link_clicks), 0) as link_clicks,
  coalesce(sum(d.landing_page_views), 0) as landing_page_views,
  coalesce(sum(d.adds_to_cart), 0) as adds_to_cart,
  coalesce(sum(d.checkouts_initiated), 0) as checkouts,
  coalesce(sum(d.purchases), 0) as purchases,
  case
    when coalesce(sum(d.purchases), 0) > 0
    then sum(d.spend) / sum(d.purchases)
    else null
  end as cost_per_purchase,
  case
    when coalesce(sum(d.spend), 0) > 0
    then sum(d.purchase_value) / sum(d.spend)
    else null
  end as roas,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.purchase_value), 0) as purchase_value
from data_pipeline.meta_ads_daily d
group by
  d.ad_account_id,
  d.campaign_id,
  d.campaign_name,
  d.adset_id,
  d.adset_name,
  d.ad_id,
  d.ad_name;

create or replace view analytics.meta_ads_funnel as
select
  d.ad_account_id,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.clicks), 0) as clicks,
  coalesce(sum(d.inline_link_clicks), 0) as link_clicks,
  coalesce(sum(d.landing_page_views), 0) as landing_page_views,
  coalesce(sum(d.adds_to_cart), 0) as adds_to_cart,
  coalesce(sum(d.checkouts_initiated), 0) as checkouts,
  coalesce(sum(d.purchases), 0) as purchases,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(d.clicks)::numeric / sum(d.impressions)
    else null
  end as ctr,
  case
    when coalesce(sum(d.clicks), 0) > 0
    then sum(d.inline_link_clicks)::numeric / sum(d.clicks)
    else null
  end as link_click_rate,
  case
    when coalesce(sum(d.inline_link_clicks), 0) > 0
    then sum(d.landing_page_views) / sum(d.inline_link_clicks)
    else null
  end as lpv_rate,
  case
    when coalesce(sum(d.landing_page_views), 0) > 0
    then sum(d.adds_to_cart) / sum(d.landing_page_views)
    else null
  end as atc_rate,
  case
    when coalesce(sum(d.adds_to_cart), 0) > 0
    then sum(d.checkouts_initiated) / sum(d.adds_to_cart)
    else null
  end as checkout_rate,
  case
    when coalesce(sum(d.checkouts_initiated), 0) > 0
    then sum(d.purchases) / sum(d.checkouts_initiated)
    else null
  end as purchase_rate,
  case
    when coalesce(sum(d.landing_page_views), 0) > 0
    then sum(d.purchases) / sum(d.landing_page_views)
    else null
  end as purchase_per_lpv
from data_pipeline.meta_ads_daily d
group by d.ad_account_id;

create or replace view analytics.meta_ads_video_performance as
select
  d.ad_account_id,
  d.campaign_id,
  d.campaign_name,
  d.adset_id,
  d.adset_name,
  d.ad_id,
  d.ad_name,
  coalesce(sum(d.video_plays), 0) as video_plays,
  coalesce(sum(d.video_plays_25), 0) as video_plays_25,
  coalesce(sum(d.video_plays_50), 0) as video_plays_50,
  coalesce(sum(d.video_plays_75), 0) as video_plays_75,
  coalesce(sum(d.video_plays_95), 0) as video_plays_95,
  coalesce(sum(d.video_plays_100), 0) as video_plays_100,
  coalesce(sum(d.thruplays), 0) as thruplays,
  case
    when coalesce(sum(d.video_plays), 0) > 0
    then sum(coalesce(d.video_avg_play_time, 0) * coalesce(d.video_plays, 0)) / sum(d.video_plays)
    else avg(d.video_avg_play_time)
  end as video_avg_play_time,
  case
    when coalesce(sum(d.video_plays), 0) > 0
    then sum(d.video_plays_25) / sum(d.video_plays)
    else null
  end as retention_25,
  case
    when coalesce(sum(d.video_plays), 0) > 0
    then sum(d.video_plays_50) / sum(d.video_plays)
    else null
  end as retention_50,
  case
    when coalesce(sum(d.video_plays), 0) > 0
    then sum(d.video_plays_95) / sum(d.video_plays)
    else null
  end as retention_95
from data_pipeline.meta_ads_daily d
group by
  d.ad_account_id,
  d.campaign_id,
  d.campaign_name,
  d.adset_id,
  d.adset_name,
  d.ad_id,
  d.ad_name;

create or replace view analytics.meta_ads_objective_performance as
select
  d.ad_account_id,
  coalesce(nullif(d.objective, ''), 'Unknown') as objective,
  coalesce(sum(d.spend), 0) as spend,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.purchase_value), 0) as purchase_value,
  case
    when coalesce(sum(d.spend), 0) > 0
    then sum(d.purchase_value) / sum(d.spend)
    else null
  end as roas
from data_pipeline.meta_ads_daily d
group by d.ad_account_id, coalesce(nullif(d.objective, ''), 'Unknown');

create or replace view analytics.meta_ads_action_performance as
select
  a.ad_account_id,
  a.action_type,
  coalesce(sum(a.value), 0) as total_actions,
  count(distinct a.ad_id) as ads_with_action,
  count(distinct a.campaign_id) as campaigns_with_action,
  min(a.date) as first_seen,
  max(a.date) as last_seen,
  coalesce(sum(v.conversion_value), 0) as conversion_value
from data_pipeline.meta_ads_actions_daily a
left join data_pipeline.meta_ads_action_values_daily v
  on v.ad_account_id = a.ad_account_id
 and v.date = a.date
 and v.campaign_id = a.campaign_id
 and v.adset_id = a.adset_id
 and v.ad_id = a.ad_id
 and v.action_type = a.action_type
group by a.ad_account_id, a.action_type;

create or replace view analytics.meta_ads_placement_performance as
select
  p.ad_account_id,
  p.publisher_platform,
  p.platform_position,
  coalesce(sum(p.spend), 0) as spend,
  coalesce(sum(p.impressions), 0) as impressions,
  coalesce(sum(p.reach), 0) as reach,
  coalesce(sum(p.clicks), 0) as clicks,
  coalesce(sum(p.link_clicks), 0) as link_clicks,
  coalesce(sum(p.purchases), 0) as purchases,
  coalesce(sum(p.purchase_value), 0) as purchase_value
from data_pipeline.meta_ads_placement_daily p
group by p.ad_account_id, p.publisher_platform, p.platform_position;

create or replace view analytics.meta_ads_device_performance as
select
  d.ad_account_id,
  d.impression_device,
  coalesce(sum(d.spend), 0) as spend,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.clicks), 0) as clicks,
  coalesce(sum(d.link_clicks), 0) as link_clicks,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.purchase_value), 0) as purchase_value
from data_pipeline.meta_ads_device_daily d
group by d.ad_account_id, d.impression_device;

create or replace view analytics.meta_ads_demographic_performance as
select
  d.ad_account_id,
  d.age,
  d.gender,
  coalesce(sum(d.spend), 0) as spend,
  coalesce(sum(d.impressions), 0) as impressions,
  coalesce(sum(d.clicks), 0) as clicks,
  coalesce(sum(d.link_clicks), 0) as link_clicks,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.purchase_value), 0) as purchase_value
from data_pipeline.meta_ads_demographic_daily d
group by d.ad_account_id, d.age, d.gender;

create or replace view analytics.meta_ads_geo_performance as
select
  g.ad_account_id,
  g.country,
  g.region,
  coalesce(sum(g.spend), 0) as spend,
  coalesce(sum(g.impressions), 0) as impressions,
  coalesce(sum(g.clicks), 0) as clicks,
  coalesce(sum(g.link_clicks), 0) as link_clicks,
  coalesce(sum(g.purchases), 0) as purchases,
  coalesce(sum(g.purchase_value), 0) as purchase_value
from data_pipeline.meta_ads_geo_daily g
group by g.ad_account_id, g.country, g.region;

create or replace view analytics.meta_ads_recent as
select *
from analytics.meta_ads_daily
where date >= (current_date - 2)
order by date desc, spend desc;

create or replace view analytics.meta_ads_sync_health as
select
  s.ad_account_id,
  s.last_successful_today_sync_at,
  s.last_successful_recent_repair_at,
  s.last_backfill_completed_at,
  s.last_attempted_sync_at,
  s.account_timezone,
  s.account_currency,
  s.api_version,
  s.last_warning,
  r.status as last_status,
  r.mode as last_mode,
  r.rows_fetched as last_rows_fetched,
  r.rows_inserted as last_rows_inserted,
  r.rows_updated as last_rows_updated,
  r.api_requests as last_api_requests,
  r.pages_fetched as last_pages_fetched,
  r.retry_count as last_retry_count,
  r.last_error_code,
  r.last_error_message,
  extract(epoch from (r.finished_at - r.started_at)) as last_duration_seconds,
  b.status as backfill_status,
  b.next_chunk_start as backfill_next_chunk_start,
  b.requested_from as backfill_requested_from,
  b.requested_to as backfill_requested_to
from data_pipeline.meta_sync_state s
left join lateral (
  select *
  from data_pipeline.meta_sync_runs run
  where run.ad_account_id = s.ad_account_id
  order by run.started_at desc
  limit 1
) r on true
left join lateral (
  select *
  from data_pipeline.meta_backfill_jobs job
  where job.ad_account_id = s.ad_account_id
  order by job.updated_at desc
  limit 1
) b on true;

create or replace view analytics.meta_ads_creative_performance as
select
  d.ad_account_id,
  d.ad_id,
  d.ad_name,
  a.creative_id,
  c.name as creative_name,
  c.title,
  c.call_to_action_type,
  c.thumbnail_url,
  c.image_url,
  c.video_id,
  c.destination_url,
  coalesce(sum(d.spend), 0) as spend,
  case
    when coalesce(sum(d.impressions), 0) > 0
    then sum(d.clicks)::numeric / sum(d.impressions)
    else null
  end as ctr,
  coalesce(sum(d.landing_page_views), 0) as landing_page_views,
  coalesce(sum(d.purchases), 0) as purchases,
  case
    when coalesce(sum(d.purchases), 0) > 0
    then sum(d.spend) / sum(d.purchases)
    else null
  end as cost_per_purchase,
  case
    when coalesce(sum(d.spend), 0) > 0
    then sum(d.purchase_value) / sum(d.spend)
    else null
  end as roas,
  case
    when coalesce(sum(d.video_plays), 0) > 0
    then sum(d.video_plays_25) / sum(d.video_plays)
    else null
  end as retention_25
from data_pipeline.meta_ads_daily d
left join data_pipeline.meta_ads a
  on a.ad_id = d.ad_id
left join data_pipeline.meta_creatives c
  on c.creative_id = a.creative_id
group by
  d.ad_account_id,
  d.ad_id,
  d.ad_name,
  a.creative_id,
  c.name,
  c.title,
  c.call_to_action_type,
  c.thumbnail_url,
  c.image_url,
  c.video_id,
  c.destination_url;

grant usage on schema analytics to service_role;
grant usage on schema analytics to authenticated;

grant select on analytics.meta_ads_daily to service_role, authenticated;
grant select on analytics.meta_ads_sheet_parity to service_role, authenticated;
grant select on analytics.meta_ads_kpis to service_role, authenticated;
grant select on analytics.meta_ads_daily_summary to service_role, authenticated;
grant select on analytics.meta_campaign_performance to service_role, authenticated;
grant select on analytics.meta_adset_performance to service_role, authenticated;
grant select on analytics.meta_ad_performance to service_role, authenticated;
grant select on analytics.meta_ads_funnel to service_role, authenticated;
grant select on analytics.meta_ads_video_performance to service_role, authenticated;
grant select on analytics.meta_ads_objective_performance to service_role, authenticated;
grant select on analytics.meta_ads_action_performance to service_role, authenticated;
grant select on analytics.meta_ads_placement_performance to service_role, authenticated;
grant select on analytics.meta_ads_device_performance to service_role, authenticated;
grant select on analytics.meta_ads_demographic_performance to service_role, authenticated;
grant select on analytics.meta_ads_geo_performance to service_role, authenticated;
grant select on analytics.meta_ads_recent to service_role, authenticated;
grant select on analytics.meta_ads_sync_health to service_role, authenticated;
grant select on analytics.meta_ads_creative_performance to service_role, authenticated;
