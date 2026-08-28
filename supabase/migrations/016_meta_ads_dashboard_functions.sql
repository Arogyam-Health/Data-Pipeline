-- 016_meta_ads_dashboard_functions.sql
-- Date-range Meta analytics functions. Aggregation stays in PostgreSQL.
-- Does not alter Shopify or Shiprocket functions.
-- Portable: no project IDs, URLs, or secrets.

create or replace function analytics.meta_ads_kpis_for_range(p_from date, p_to date)
returns table (
  spend numeric,
  impressions numeric,
  reach numeric,
  frequency numeric,
  clicks numeric,
  link_clicks numeric,
  landing_page_views numeric,
  ctr numeric,
  link_ctr numeric,
  cpc numeric,
  cpm numeric,
  adds_to_cart numeric,
  checkouts numeric,
  purchases numeric,
  cost_per_add_to_cart numeric,
  cost_per_checkout numeric,
  cost_per_purchase numeric,
  purchase_value numeric,
  roas numeric,
  website_purchases numeric,
  messaging_conversations numeric,
  registrations numeric
)
language sql
stable
as $$
  select
    coalesce(sum(d.spend), 0),
    coalesce(sum(d.impressions), 0),
    coalesce(sum(d.reach), 0),
    case
      when coalesce(sum(d.impressions), 0) > 0
      then sum(coalesce(d.frequency, 0) * coalesce(d.impressions, 0)) / sum(d.impressions)
      else null
    end,
    coalesce(sum(d.clicks), 0),
    coalesce(sum(d.inline_link_clicks), 0),
    coalesce(sum(d.landing_page_views), 0),
    case
      when coalesce(sum(d.impressions), 0) > 0
      then sum(d.clicks)::numeric / sum(d.impressions)
      else null
    end,
    case
      when coalesce(sum(d.impressions), 0) > 0
      then sum(d.inline_link_clicks)::numeric / sum(d.impressions)
      else null
    end,
    case
      when coalesce(sum(d.inline_link_clicks), 0) > 0
      then sum(d.spend) / sum(d.inline_link_clicks)
      else null
    end,
    case
      when coalesce(sum(d.impressions), 0) > 0
      then sum(d.spend) / sum(d.impressions) * 1000
      else null
    end,
    coalesce(sum(d.adds_to_cart), 0),
    coalesce(sum(d.checkouts_initiated), 0),
    coalesce(sum(d.purchases), 0),
    case
      when coalesce(sum(d.adds_to_cart), 0) > 0
      then sum(d.spend) / sum(d.adds_to_cart)
      else null
    end,
    case
      when coalesce(sum(d.checkouts_initiated), 0) > 0
      then sum(d.spend) / sum(d.checkouts_initiated)
      else null
    end,
    case
      when coalesce(sum(d.purchases), 0) > 0
      then sum(d.spend) / sum(d.purchases)
      else null
    end,
    coalesce(sum(d.purchase_value), 0),
    case
      when coalesce(sum(d.spend), 0) > 0
      then sum(d.purchase_value) / sum(d.spend)
      else null
    end,
    coalesce(sum(d.website_purchases), 0),
    coalesce(sum(d.messaging_conversations_started), 0),
    coalesce(sum(d.registrations_completed), 0)
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from
    and d.date <= p_to;
$$;

create or replace function analytics.meta_ads_daily_for_range(p_from date, p_to date)
returns table (
  date date,
  spend numeric,
  purchases numeric,
  purchase_value numeric,
  roas numeric,
  impressions numeric,
  link_clicks numeric
)
language sql
stable
as $$
  select
    d.date,
    coalesce(sum(d.spend), 0),
    coalesce(sum(d.purchases), 0),
    coalesce(sum(d.purchase_value), 0),
    case
      when coalesce(sum(d.spend), 0) > 0
      then sum(d.purchase_value) / sum(d.spend)
      else null
    end,
    coalesce(sum(d.impressions), 0),
    coalesce(sum(d.inline_link_clicks), 0)
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from
    and d.date <= p_to
  group by d.date
  order by d.date;
$$;

create or replace function analytics.meta_campaign_performance_for_range(p_from date, p_to date)
returns table (
  campaign_id text,
  campaign_name text,
  spend numeric,
  impressions numeric,
  reach numeric,
  ctr numeric,
  link_clicks numeric,
  landing_page_views numeric,
  adds_to_cart numeric,
  checkouts numeric,
  purchases numeric,
  cost_per_purchase numeric,
  purchase_value numeric,
  roas numeric
)
language sql
stable
as $$
  select
    d.campaign_id,
    d.campaign_name,
    coalesce(sum(d.spend), 0),
    coalesce(sum(d.impressions), 0),
    coalesce(sum(d.reach), 0),
    case
      when coalesce(sum(d.impressions), 0) > 0
      then sum(d.clicks)::numeric / sum(d.impressions)
      else null
    end,
    coalesce(sum(d.inline_link_clicks), 0),
    coalesce(sum(d.landing_page_views), 0),
    coalesce(sum(d.adds_to_cart), 0),
    coalesce(sum(d.checkouts_initiated), 0),
    coalesce(sum(d.purchases), 0),
    case
      when coalesce(sum(d.purchases), 0) > 0
      then sum(d.spend) / sum(d.purchases)
      else null
    end,
    coalesce(sum(d.purchase_value), 0),
    case
      when coalesce(sum(d.spend), 0) > 0
      then sum(d.purchase_value) / sum(d.spend)
      else null
    end
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from
    and d.date <= p_to
  group by d.campaign_id, d.campaign_name
  order by coalesce(sum(d.spend), 0) desc;
$$;

create or replace function analytics.meta_adset_performance_for_range(p_from date, p_to date)
returns table (
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  spend numeric,
  impressions numeric,
  ctr numeric,
  landing_page_views numeric,
  adds_to_cart numeric,
  checkouts numeric,
  purchases numeric,
  cost_per_purchase numeric,
  purchase_value numeric,
  roas numeric
)
language sql
stable
as $$
  select
    d.campaign_id,
    d.campaign_name,
    d.adset_id,
    d.adset_name,
    coalesce(sum(d.spend), 0),
    coalesce(sum(d.impressions), 0),
    case
      when coalesce(sum(d.impressions), 0) > 0
      then sum(d.clicks)::numeric / sum(d.impressions)
      else null
    end,
    coalesce(sum(d.landing_page_views), 0),
    coalesce(sum(d.adds_to_cart), 0),
    coalesce(sum(d.checkouts_initiated), 0),
    coalesce(sum(d.purchases), 0),
    case
      when coalesce(sum(d.purchases), 0) > 0
      then sum(d.spend) / sum(d.purchases)
      else null
    end,
    coalesce(sum(d.purchase_value), 0),
    case
      when coalesce(sum(d.spend), 0) > 0
      then sum(d.purchase_value) / sum(d.spend)
      else null
    end
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from
    and d.date <= p_to
  group by d.campaign_id, d.campaign_name, d.adset_id, d.adset_name
  order by coalesce(sum(d.spend), 0) desc;
$$;

create or replace function analytics.meta_ad_performance_for_range(p_from date, p_to date)
returns table (
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  spend numeric,
  frequency numeric,
  ctr numeric,
  landing_page_views numeric,
  adds_to_cart numeric,
  checkouts numeric,
  purchases numeric,
  cost_per_purchase numeric,
  roas numeric
)
language sql
stable
as $$
  select
    d.campaign_id,
    d.campaign_name,
    d.adset_id,
    d.adset_name,
    d.ad_id,
    d.ad_name,
    coalesce(sum(d.spend), 0),
    case
      when coalesce(sum(d.impressions), 0) > 0
      then sum(coalesce(d.frequency, 0) * coalesce(d.impressions, 0)) / sum(d.impressions)
      else null
    end,
    case
      when coalesce(sum(d.impressions), 0) > 0
      then sum(d.clicks)::numeric / sum(d.impressions)
      else null
    end,
    coalesce(sum(d.landing_page_views), 0),
    coalesce(sum(d.adds_to_cart), 0),
    coalesce(sum(d.checkouts_initiated), 0),
    coalesce(sum(d.purchases), 0),
    case
      when coalesce(sum(d.purchases), 0) > 0
      then sum(d.spend) / sum(d.purchases)
      else null
    end,
    case
      when coalesce(sum(d.spend), 0) > 0
      then sum(d.purchase_value) / sum(d.spend)
      else null
    end
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from
    and d.date <= p_to
  group by
    d.campaign_id,
    d.campaign_name,
    d.adset_id,
    d.adset_name,
    d.ad_id,
    d.ad_name
  order by coalesce(sum(d.spend), 0) desc;
$$;

create or replace function analytics.meta_ads_funnel_for_range(p_from date, p_to date)
returns table (
  impressions numeric,
  clicks numeric,
  link_clicks numeric,
  landing_page_views numeric,
  adds_to_cart numeric,
  checkouts numeric,
  purchases numeric,
  ctr numeric,
  link_click_rate numeric,
  lpv_rate numeric,
  atc_rate numeric,
  checkout_rate numeric,
  purchase_rate numeric,
  purchase_per_lpv numeric
)
language sql
stable
as $$
  select
    coalesce(sum(d.impressions), 0),
    coalesce(sum(d.clicks), 0),
    coalesce(sum(d.inline_link_clicks), 0),
    coalesce(sum(d.landing_page_views), 0),
    coalesce(sum(d.adds_to_cart), 0),
    coalesce(sum(d.checkouts_initiated), 0),
    coalesce(sum(d.purchases), 0),
    case
      when coalesce(sum(d.impressions), 0) > 0
      then sum(d.clicks)::numeric / sum(d.impressions)
      else null
    end,
    case
      when coalesce(sum(d.clicks), 0) > 0
      then sum(d.inline_link_clicks)::numeric / sum(d.clicks)
      else null
    end,
    case
      when coalesce(sum(d.inline_link_clicks), 0) > 0
      then sum(d.landing_page_views) / sum(d.inline_link_clicks)
      else null
    end,
    case
      when coalesce(sum(d.landing_page_views), 0) > 0
      then sum(d.adds_to_cart) / sum(d.landing_page_views)
      else null
    end,
    case
      when coalesce(sum(d.adds_to_cart), 0) > 0
      then sum(d.checkouts_initiated) / sum(d.adds_to_cart)
      else null
    end,
    case
      when coalesce(sum(d.checkouts_initiated), 0) > 0
      then sum(d.purchases) / sum(d.checkouts_initiated)
      else null
    end,
    case
      when coalesce(sum(d.landing_page_views), 0) > 0
      then sum(d.purchases) / sum(d.landing_page_views)
      else null
    end
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from
    and d.date <= p_to;
$$;

create or replace function analytics.meta_ads_video_for_range(p_from date, p_to date)
returns table (
  ad_id text,
  ad_name text,
  campaign_name text,
  video_plays numeric,
  video_plays_25 numeric,
  video_plays_50 numeric,
  video_plays_75 numeric,
  video_plays_95 numeric,
  video_plays_100 numeric,
  thruplays numeric,
  video_avg_play_time numeric,
  retention_25 numeric,
  retention_50 numeric,
  retention_95 numeric
)
language sql
stable
as $$
  select
    d.ad_id,
    d.ad_name,
    d.campaign_name,
    coalesce(sum(d.video_plays), 0),
    coalesce(sum(d.video_plays_25), 0),
    coalesce(sum(d.video_plays_50), 0),
    coalesce(sum(d.video_plays_75), 0),
    coalesce(sum(d.video_plays_95), 0),
    coalesce(sum(d.video_plays_100), 0),
    coalesce(sum(d.thruplays), 0),
    case
      when coalesce(sum(d.video_plays), 0) > 0
      then sum(coalesce(d.video_avg_play_time, 0) * coalesce(d.video_plays, 0)) / sum(d.video_plays)
      else avg(d.video_avg_play_time)
    end,
    case
      when coalesce(sum(d.video_plays), 0) > 0
      then sum(d.video_plays_25) / sum(d.video_plays)
      else null
    end,
    case
      when coalesce(sum(d.video_plays), 0) > 0
      then sum(d.video_plays_50) / sum(d.video_plays)
      else null
    end,
    case
      when coalesce(sum(d.video_plays), 0) > 0
      then sum(d.video_plays_95) / sum(d.video_plays)
      else null
    end
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from
    and d.date <= p_to
  group by d.ad_id, d.ad_name, d.campaign_name
  order by coalesce(sum(d.video_plays), 0) desc;
$$;

create or replace function analytics.meta_ads_action_performance_for_range(p_from date, p_to date)
returns table (
  action_type text,
  total_actions numeric,
  ads_with_action bigint,
  campaigns_with_action bigint,
  first_seen date,
  last_seen date,
  conversion_value numeric
)
language sql
stable
as $$
  select
    a.action_type,
    coalesce(sum(a.value), 0),
    count(distinct a.ad_id),
    count(distinct a.campaign_id),
    min(a.date),
    max(a.date),
    coalesce(sum(v.conversion_value), 0)
  from data_pipeline.meta_ads_actions_daily a
  left join data_pipeline.meta_ads_action_values_daily v
    on v.ad_account_id = a.ad_account_id
   and v.date = a.date
   and v.campaign_id = a.campaign_id
   and v.adset_id = a.adset_id
   and v.ad_id = a.ad_id
   and v.action_type = a.action_type
  where a.date >= p_from
    and a.date <= p_to
  group by a.action_type
  order by coalesce(sum(a.value), 0) desc;
$$;

create or replace function analytics.meta_ads_placement_for_range(p_from date, p_to date)
returns table (
  publisher_platform text,
  platform_position text,
  spend numeric,
  impressions numeric,
  clicks numeric,
  link_clicks numeric,
  purchases numeric,
  purchase_value numeric
)
language sql
stable
as $$
  select
    p.publisher_platform,
    p.platform_position,
    coalesce(sum(p.spend), 0),
    coalesce(sum(p.impressions), 0),
    coalesce(sum(p.clicks), 0),
    coalesce(sum(p.link_clicks), 0),
    coalesce(sum(p.purchases), 0),
    coalesce(sum(p.purchase_value), 0)
  from data_pipeline.meta_ads_placement_daily p
  where p.date >= p_from
    and p.date <= p_to
  group by p.publisher_platform, p.platform_position
  order by coalesce(sum(p.spend), 0) desc;
$$;

create or replace function analytics.meta_ads_device_for_range(p_from date, p_to date)
returns table (
  impression_device text,
  spend numeric,
  impressions numeric,
  clicks numeric,
  link_clicks numeric,
  purchases numeric,
  purchase_value numeric
)
language sql
stable
as $$
  select
    d.impression_device,
    coalesce(sum(d.spend), 0),
    coalesce(sum(d.impressions), 0),
    coalesce(sum(d.clicks), 0),
    coalesce(sum(d.link_clicks), 0),
    coalesce(sum(d.purchases), 0),
    coalesce(sum(d.purchase_value), 0)
  from data_pipeline.meta_ads_device_daily d
  where d.date >= p_from
    and d.date <= p_to
  group by d.impression_device
  order by coalesce(sum(d.spend), 0) desc;
$$;

create or replace function analytics.meta_ads_demographic_for_range(p_from date, p_to date)
returns table (
  age text,
  gender text,
  spend numeric,
  impressions numeric,
  clicks numeric,
  purchases numeric,
  purchase_value numeric
)
language sql
stable
as $$
  select
    d.age,
    d.gender,
    coalesce(sum(d.spend), 0),
    coalesce(sum(d.impressions), 0),
    coalesce(sum(d.clicks), 0),
    coalesce(sum(d.purchases), 0),
    coalesce(sum(d.purchase_value), 0)
  from data_pipeline.meta_ads_demographic_daily d
  where d.date >= p_from
    and d.date <= p_to
  group by d.age, d.gender
  order by coalesce(sum(d.spend), 0) desc;
$$;

create or replace function analytics.meta_ads_geo_for_range(p_from date, p_to date)
returns table (
  country text,
  region text,
  spend numeric,
  impressions numeric,
  clicks numeric,
  purchases numeric,
  purchase_value numeric
)
language sql
stable
as $$
  select
    g.country,
    g.region,
    coalesce(sum(g.spend), 0),
    coalesce(sum(g.impressions), 0),
    coalesce(sum(g.clicks), 0),
    coalesce(sum(g.purchases), 0),
    coalesce(sum(g.purchase_value), 0)
  from data_pipeline.meta_ads_geo_daily g
  where g.date >= p_from
    and g.date <= p_to
  group by g.country, g.region
  order by coalesce(sum(g.spend), 0) desc;
$$;

grant execute on function analytics.meta_ads_kpis_for_range(date, date) to service_role;
grant execute on function analytics.meta_ads_daily_for_range(date, date) to service_role;
grant execute on function analytics.meta_campaign_performance_for_range(date, date) to service_role;
grant execute on function analytics.meta_adset_performance_for_range(date, date) to service_role;
grant execute on function analytics.meta_ad_performance_for_range(date, date) to service_role;
grant execute on function analytics.meta_ads_funnel_for_range(date, date) to service_role;
grant execute on function analytics.meta_ads_video_for_range(date, date) to service_role;
grant execute on function analytics.meta_ads_action_performance_for_range(date, date) to service_role;
grant execute on function analytics.meta_ads_placement_for_range(date, date) to service_role;
grant execute on function analytics.meta_ads_device_for_range(date, date) to service_role;
grant execute on function analytics.meta_ads_demographic_for_range(date, date) to service_role;
grant execute on function analytics.meta_ads_geo_for_range(date, date) to service_role;
