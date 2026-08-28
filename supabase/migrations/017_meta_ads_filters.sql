-- 017_meta_ads_filters.sql
-- Optional dashboard filters. Identity filters apply to facts;
-- purchase / spend / ROAS / frequency / video apply at ad-in-range grain.
-- Does not alter Shopify or Shiprocket functions.

create or replace function analytics.meta_ads_filter_options(p_from date, p_to date)
returns table (
  kind text,
  id text,
  label text,
  campaign_id text,
  adset_id text
)
language sql
stable
as $$
  select 'campaign'::text, d.campaign_id, max(d.campaign_name), d.campaign_id, null::text
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from and d.date <= p_to
  group by d.campaign_id
  union all
  select 'adset', d.adset_id, max(d.adset_name), d.campaign_id, d.adset_id
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from and d.date <= p_to
  group by d.campaign_id, d.adset_id
  union all
  select 'ad', d.ad_id, max(d.ad_name), d.campaign_id, d.adset_id
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from and d.date <= p_to
  group by d.campaign_id, d.adset_id, d.ad_id
  union all
  select 'objective', coalesce(nullif(d.objective, ''), 'Unknown'), coalesce(nullif(d.objective, ''), 'Unknown'), null, null
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from and d.date <= p_to
  group by coalesce(nullif(d.objective, ''), 'Unknown');
$$;

create or replace function analytics.meta_ads_filtered_ads(
  p_from date,
  p_to date,
  p_campaign_id text default null,
  p_adset_id text default null,
  p_ad_id text default null,
  p_objective text default null,
  p_search text default null,
  p_purchase_status text default null,
  p_video_status text default null,
  p_min_spend numeric default null,
  p_max_spend numeric default null,
  p_min_roas numeric default null,
  p_max_roas numeric default null,
  p_min_frequency numeric default null,
  p_funnel_status text default null,
  p_messaging_status text default null,
  p_min_purchases numeric default null,
  p_max_frequency numeric default null
)
returns table (
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  objective text,
  spend numeric,
  impressions numeric,
  reach numeric,
  frequency numeric,
  clicks numeric,
  link_clicks numeric,
  landing_page_views numeric,
  adds_to_cart numeric,
  checkouts numeric,
  purchases numeric,
  purchase_value numeric,
  website_purchases numeric,
  messaging_conversations numeric,
  registrations numeric,
  video_plays numeric,
  video_plays_25 numeric,
  video_plays_50 numeric,
  video_plays_75 numeric,
  video_plays_95 numeric,
  video_plays_100 numeric,
  thruplays numeric,
  video_avg_play_time numeric,
  weighted_impr_freq numeric
)
language sql
stable
as $$
  select
    d.campaign_id,
    max(d.campaign_name),
    d.adset_id,
    max(d.adset_name),
    d.ad_id,
    max(d.ad_name),
    max(d.objective),
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
    coalesce(sum(d.adds_to_cart), 0),
    coalesce(sum(d.checkouts_initiated), 0),
    coalesce(sum(d.purchases), 0),
    coalesce(sum(d.purchase_value), 0),
    coalesce(sum(d.website_purchases), 0),
    coalesce(sum(d.messaging_conversations_started), 0),
    coalesce(sum(d.registrations_completed), 0),
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
    coalesce(sum(coalesce(d.frequency, 0) * coalesce(d.impressions, 0)), 0)
  from data_pipeline.meta_ads_daily d
  where d.date >= p_from
    and d.date <= p_to
    and (p_campaign_id is null or p_campaign_id = '' or d.campaign_id = p_campaign_id)
    and (p_adset_id is null or p_adset_id = '' or d.adset_id = p_adset_id)
    and (p_ad_id is null or p_ad_id = '' or d.ad_id = p_ad_id)
    and (
      p_objective is null or p_objective = ''
      or coalesce(nullif(d.objective, ''), 'Unknown') = p_objective
    )
    and (
      p_search is null or p_search = ''
      or d.campaign_name ilike '%' || p_search || '%'
      or d.adset_name ilike '%' || p_search || '%'
      or d.ad_name ilike '%' || p_search || '%'
      or d.campaign_id = p_search
      or d.adset_id = p_search
      or d.ad_id = p_search
    )
  group by d.campaign_id, d.adset_id, d.ad_id
  having
    (
      p_purchase_status is null or p_purchase_status in ('', 'all')
      or (p_purchase_status = 'with' and coalesce(sum(d.purchases), 0) > 0)
      or (p_purchase_status = 'without' and coalesce(sum(d.purchases), 0) = 0)
    )
    and (
      p_video_status is null or p_video_status in ('', 'all')
      or (p_video_status = 'has_video' and coalesce(sum(d.video_plays), 0) > 0)
    )
    and (p_min_spend is null or coalesce(sum(d.spend), 0) >= p_min_spend)
    and (p_max_spend is null or coalesce(sum(d.spend), 0) <= p_max_spend)
    and (
      p_min_roas is null
      or (
        coalesce(sum(d.spend), 0) > 0
        and coalesce(sum(d.purchase_value), 0) / sum(d.spend) >= p_min_roas
      )
    )
    and (
      p_max_roas is null
      or (
        coalesce(sum(d.spend), 0) > 0
        and coalesce(sum(d.purchase_value), 0) / sum(d.spend) <= p_max_roas
      )
    )
    and (
      p_min_frequency is null
      or (
        coalesce(sum(d.impressions), 0) > 0
        and sum(coalesce(d.frequency, 0) * coalesce(d.impressions, 0)) / sum(d.impressions) >= p_min_frequency
      )
    )
    and (
      p_funnel_status is null or p_funnel_status in ('', 'all')
      or (p_funnel_status = 'has_lpv' and coalesce(sum(d.landing_page_views), 0) > 0)
      or (p_funnel_status = 'has_atc' and coalesce(sum(d.adds_to_cart), 0) > 0)
      or (p_funnel_status = 'has_checkout' and coalesce(sum(d.checkouts_initiated), 0) > 0)
    )
    and (
      p_messaging_status is null or p_messaging_status in ('', 'all')
      or (p_messaging_status = 'with' and coalesce(sum(d.messaging_conversations_started), 0) > 0)
      or (p_messaging_status = 'without' and coalesce(sum(d.messaging_conversations_started), 0) = 0)
    )
    and (p_min_purchases is null or coalesce(sum(d.purchases), 0) >= p_min_purchases)
    and (
      p_max_frequency is null
      or (
        coalesce(sum(d.impressions), 0) > 0
        and sum(coalesce(d.frequency, 0) * coalesce(d.impressions, 0)) / sum(d.impressions) <= p_max_frequency
      )
    );
$$;

create or replace function analytics.meta_ads_kpis_filtered(
  p_from date, p_to date,
  p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null,
  p_objective text default null, p_search text default null,
  p_purchase_status text default null, p_video_status text default null,
  p_min_spend numeric default null, p_max_spend numeric default null,
  p_min_roas numeric default null, p_max_roas numeric default null,
  p_min_frequency numeric default null,
  p_funnel_status text default null, p_messaging_status text default null,
  p_min_purchases numeric default null, p_max_frequency numeric default null
)
returns table (
  spend numeric, impressions numeric, reach numeric, frequency numeric,
  clicks numeric, link_clicks numeric, landing_page_views numeric,
  ctr numeric, link_ctr numeric, cpc numeric, cpm numeric,
  adds_to_cart numeric, checkouts numeric, purchases numeric,
  cost_per_add_to_cart numeric, cost_per_checkout numeric, cost_per_purchase numeric,
  purchase_value numeric, roas numeric, website_purchases numeric,
  messaging_conversations numeric, registrations numeric
)
language sql
stable
as $$
  select
    coalesce(sum(a.spend), 0),
    coalesce(sum(a.impressions), 0),
    coalesce(sum(a.reach), 0),
    case when coalesce(sum(a.impressions), 0) > 0 then sum(a.weighted_impr_freq) / sum(a.impressions) else null end,
    coalesce(sum(a.clicks), 0),
    coalesce(sum(a.link_clicks), 0),
    coalesce(sum(a.landing_page_views), 0),
    case when coalesce(sum(a.impressions), 0) > 0 then sum(a.clicks) / sum(a.impressions) else null end,
    case when coalesce(sum(a.impressions), 0) > 0 then sum(a.link_clicks) / sum(a.impressions) else null end,
    case when coalesce(sum(a.link_clicks), 0) > 0 then sum(a.spend) / sum(a.link_clicks) else null end,
    case when coalesce(sum(a.impressions), 0) > 0 then sum(a.spend) / sum(a.impressions) * 1000 else null end,
    coalesce(sum(a.adds_to_cart), 0),
    coalesce(sum(a.checkouts), 0),
    coalesce(sum(a.purchases), 0),
    case when coalesce(sum(a.adds_to_cart), 0) > 0 then sum(a.spend) / sum(a.adds_to_cart) else null end,
    case when coalesce(sum(a.checkouts), 0) > 0 then sum(a.spend) / sum(a.checkouts) else null end,
    case when coalesce(sum(a.purchases), 0) > 0 then sum(a.spend) / sum(a.purchases) else null end,
    coalesce(sum(a.purchase_value), 0),
    case when coalesce(sum(a.spend), 0) > 0 then sum(a.purchase_value) / sum(a.spend) else null end,
    coalesce(sum(a.website_purchases), 0),
    coalesce(sum(a.messaging_conversations), 0),
    coalesce(sum(a.registrations), 0)
  from analytics.meta_ads_filtered_ads(
    p_from, p_to, p_campaign_id, p_adset_id, p_ad_id, p_objective, p_search,
    p_purchase_status, p_video_status, p_min_spend, p_max_spend, p_min_roas, p_max_roas, p_min_frequency,
    p_funnel_status, p_messaging_status, p_min_purchases, p_max_frequency
  ) a;
$$;

create or replace function analytics.meta_ads_daily_filtered(
  p_from date, p_to date,
  p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null,
  p_objective text default null, p_search text default null,
  p_purchase_status text default null, p_video_status text default null,
  p_min_spend numeric default null, p_max_spend numeric default null,
  p_min_roas numeric default null, p_max_roas numeric default null,
  p_min_frequency numeric default null,
  p_funnel_status text default null, p_messaging_status text default null,
  p_min_purchases numeric default null, p_max_frequency numeric default null
)
returns table (
  date date, spend numeric, purchases numeric, purchase_value numeric,
  roas numeric, impressions numeric, link_clicks numeric
)
language sql
stable
as $$
  with ads as (
    select * from analytics.meta_ads_filtered_ads(
      p_from, p_to, p_campaign_id, p_adset_id, p_ad_id, p_objective, p_search,
      p_purchase_status, p_video_status, p_min_spend, p_max_spend, p_min_roas, p_max_roas, p_min_frequency,
      p_funnel_status, p_messaging_status, p_min_purchases, p_max_frequency
    )
  )
  select
    d.date,
    coalesce(sum(d.spend), 0),
    coalesce(sum(d.purchases), 0),
    coalesce(sum(d.purchase_value), 0),
    case when coalesce(sum(d.spend), 0) > 0 then sum(d.purchase_value) / sum(d.spend) else null end,
    coalesce(sum(d.impressions), 0),
    coalesce(sum(d.inline_link_clicks), 0)
  from data_pipeline.meta_ads_daily d
  join ads a on a.ad_id = d.ad_id
  where d.date >= p_from and d.date <= p_to
  group by d.date
  order by d.date;
$$;

create or replace function analytics.meta_campaign_performance_filtered(
  p_from date, p_to date,
  p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null,
  p_objective text default null, p_search text default null,
  p_purchase_status text default null, p_video_status text default null,
  p_min_spend numeric default null, p_max_spend numeric default null,
  p_min_roas numeric default null, p_max_roas numeric default null,
  p_min_frequency numeric default null,
  p_funnel_status text default null, p_messaging_status text default null,
  p_min_purchases numeric default null, p_max_frequency numeric default null
)
returns table (
  campaign_id text, campaign_name text, spend numeric, impressions numeric, reach numeric,
  ctr numeric, link_clicks numeric, landing_page_views numeric, adds_to_cart numeric,
  checkouts numeric, purchases numeric, cost_per_purchase numeric, purchase_value numeric, roas numeric
)
language sql
stable
as $$
  select
    a.campaign_id, max(a.campaign_name), coalesce(sum(a.spend), 0), coalesce(sum(a.impressions), 0),
    coalesce(sum(a.reach), 0),
    case when coalesce(sum(a.impressions), 0) > 0 then sum(a.clicks) / sum(a.impressions) else null end,
    coalesce(sum(a.link_clicks), 0), coalesce(sum(a.landing_page_views), 0),
    coalesce(sum(a.adds_to_cart), 0), coalesce(sum(a.checkouts), 0), coalesce(sum(a.purchases), 0),
    case when coalesce(sum(a.purchases), 0) > 0 then sum(a.spend) / sum(a.purchases) else null end,
    coalesce(sum(a.purchase_value), 0),
    case when coalesce(sum(a.spend), 0) > 0 then sum(a.purchase_value) / sum(a.spend) else null end
  from analytics.meta_ads_filtered_ads(
    p_from, p_to, p_campaign_id, p_adset_id, p_ad_id, p_objective, p_search,
    p_purchase_status, p_video_status, p_min_spend, p_max_spend, p_min_roas, p_max_roas, p_min_frequency,
    p_funnel_status, p_messaging_status, p_min_purchases, p_max_frequency
  ) a
  group by a.campaign_id
  order by coalesce(sum(a.spend), 0) desc;
$$;

create or replace function analytics.meta_adset_performance_filtered(
  p_from date, p_to date,
  p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null,
  p_objective text default null, p_search text default null,
  p_purchase_status text default null, p_video_status text default null,
  p_min_spend numeric default null, p_max_spend numeric default null,
  p_min_roas numeric default null, p_max_roas numeric default null,
  p_min_frequency numeric default null,
  p_funnel_status text default null, p_messaging_status text default null,
  p_min_purchases numeric default null, p_max_frequency numeric default null
)
returns table (
  campaign_id text, campaign_name text, adset_id text, adset_name text,
  spend numeric, impressions numeric, ctr numeric, landing_page_views numeric,
  adds_to_cart numeric, checkouts numeric, purchases numeric,
  cost_per_purchase numeric, purchase_value numeric, roas numeric
)
language sql
stable
as $$
  select
    a.campaign_id, max(a.campaign_name), a.adset_id, max(a.adset_name),
    coalesce(sum(a.spend), 0), coalesce(sum(a.impressions), 0),
    case when coalesce(sum(a.impressions), 0) > 0 then sum(a.clicks) / sum(a.impressions) else null end,
    coalesce(sum(a.landing_page_views), 0), coalesce(sum(a.adds_to_cart), 0),
    coalesce(sum(a.checkouts), 0), coalesce(sum(a.purchases), 0),
    case when coalesce(sum(a.purchases), 0) > 0 then sum(a.spend) / sum(a.purchases) else null end,
    coalesce(sum(a.purchase_value), 0),
    case when coalesce(sum(a.spend), 0) > 0 then sum(a.purchase_value) / sum(a.spend) else null end
  from analytics.meta_ads_filtered_ads(
    p_from, p_to, p_campaign_id, p_adset_id, p_ad_id, p_objective, p_search,
    p_purchase_status, p_video_status, p_min_spend, p_max_spend, p_min_roas, p_max_roas, p_min_frequency,
    p_funnel_status, p_messaging_status, p_min_purchases, p_max_frequency
  ) a
  group by a.campaign_id, a.adset_id
  order by coalesce(sum(a.spend), 0) desc;
$$;

create or replace function analytics.meta_ad_performance_filtered(
  p_from date, p_to date,
  p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null,
  p_objective text default null, p_search text default null,
  p_purchase_status text default null, p_video_status text default null,
  p_min_spend numeric default null, p_max_spend numeric default null,
  p_min_roas numeric default null, p_max_roas numeric default null,
  p_min_frequency numeric default null,
  p_funnel_status text default null, p_messaging_status text default null,
  p_min_purchases numeric default null, p_max_frequency numeric default null
)
returns table (
  campaign_id text, campaign_name text, adset_id text, adset_name text,
  ad_id text, ad_name text, spend numeric, frequency numeric, ctr numeric,
  landing_page_views numeric, adds_to_cart numeric, checkouts numeric,
  purchases numeric, cost_per_purchase numeric, roas numeric
)
language sql
stable
as $$
  select
    a.campaign_id, a.campaign_name, a.adset_id, a.adset_name, a.ad_id, a.ad_name,
    a.spend, a.frequency,
    case when a.impressions > 0 then a.clicks / a.impressions else null end,
    a.landing_page_views, a.adds_to_cart, a.checkouts, a.purchases,
    case when a.purchases > 0 then a.spend / a.purchases else null end,
    case when a.spend > 0 then a.purchase_value / a.spend else null end
  from analytics.meta_ads_filtered_ads(
    p_from, p_to, p_campaign_id, p_adset_id, p_ad_id, p_objective, p_search,
    p_purchase_status, p_video_status, p_min_spend, p_max_spend, p_min_roas, p_max_roas, p_min_frequency,
    p_funnel_status, p_messaging_status, p_min_purchases, p_max_frequency
  ) a
  order by a.spend desc;
$$;

create or replace function analytics.meta_ads_funnel_filtered(
  p_from date, p_to date,
  p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null,
  p_objective text default null, p_search text default null,
  p_purchase_status text default null, p_video_status text default null,
  p_min_spend numeric default null, p_max_spend numeric default null,
  p_min_roas numeric default null, p_max_roas numeric default null,
  p_min_frequency numeric default null,
  p_funnel_status text default null, p_messaging_status text default null,
  p_min_purchases numeric default null, p_max_frequency numeric default null
)
returns table (
  impressions numeric, clicks numeric, link_clicks numeric, landing_page_views numeric,
  adds_to_cart numeric, checkouts numeric, purchases numeric,
  ctr numeric, link_click_rate numeric, lpv_rate numeric, atc_rate numeric,
  checkout_rate numeric, purchase_rate numeric, purchase_per_lpv numeric
)
language sql
stable
as $$
  select
    coalesce(sum(a.impressions), 0), coalesce(sum(a.clicks), 0), coalesce(sum(a.link_clicks), 0),
    coalesce(sum(a.landing_page_views), 0), coalesce(sum(a.adds_to_cart), 0),
    coalesce(sum(a.checkouts), 0), coalesce(sum(a.purchases), 0),
    case when coalesce(sum(a.impressions), 0) > 0 then sum(a.clicks) / sum(a.impressions) else null end,
    case when coalesce(sum(a.clicks), 0) > 0 then sum(a.link_clicks) / sum(a.clicks) else null end,
    case when coalesce(sum(a.link_clicks), 0) > 0 then sum(a.landing_page_views) / sum(a.link_clicks) else null end,
    case when coalesce(sum(a.landing_page_views), 0) > 0 then sum(a.adds_to_cart) / sum(a.landing_page_views) else null end,
    case when coalesce(sum(a.adds_to_cart), 0) > 0 then sum(a.checkouts) / sum(a.adds_to_cart) else null end,
    case when coalesce(sum(a.checkouts), 0) > 0 then sum(a.purchases) / sum(a.checkouts) else null end,
    case when coalesce(sum(a.landing_page_views), 0) > 0 then sum(a.purchases) / sum(a.landing_page_views) else null end
  from analytics.meta_ads_filtered_ads(
    p_from, p_to, p_campaign_id, p_adset_id, p_ad_id, p_objective, p_search,
    p_purchase_status, p_video_status, p_min_spend, p_max_spend, p_min_roas, p_max_roas, p_min_frequency,
    p_funnel_status, p_messaging_status, p_min_purchases, p_max_frequency
  ) a;
$$;

create or replace function analytics.meta_ads_video_filtered(
  p_from date, p_to date,
  p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null,
  p_objective text default null, p_search text default null,
  p_purchase_status text default null, p_video_status text default null,
  p_min_spend numeric default null, p_max_spend numeric default null,
  p_min_roas numeric default null, p_max_roas numeric default null,
  p_min_frequency numeric default null,
  p_funnel_status text default null, p_messaging_status text default null,
  p_min_purchases numeric default null, p_max_frequency numeric default null
)
returns table (
  ad_id text, ad_name text, campaign_name text, video_plays numeric,
  video_plays_25 numeric, video_plays_50 numeric, video_plays_75 numeric,
  video_plays_95 numeric, video_plays_100 numeric, thruplays numeric,
  video_avg_play_time numeric, retention_25 numeric, retention_50 numeric, retention_95 numeric
)
language sql
stable
as $$
  select
    a.ad_id, a.ad_name, a.campaign_name, a.video_plays,
    a.video_plays_25, a.video_plays_50, a.video_plays_75, a.video_plays_95, a.video_plays_100,
    a.thruplays, a.video_avg_play_time,
    case when a.video_plays > 0 then a.video_plays_25 / a.video_plays else null end,
    case when a.video_plays > 0 then a.video_plays_50 / a.video_plays else null end,
    case when a.video_plays > 0 then a.video_plays_95 / a.video_plays else null end
  from analytics.meta_ads_filtered_ads(
    p_from, p_to, p_campaign_id, p_adset_id, p_ad_id, p_objective, p_search,
    p_purchase_status, p_video_status, p_min_spend, p_max_spend, p_min_roas, p_max_roas, p_min_frequency,
    p_funnel_status, p_messaging_status, p_min_purchases, p_max_frequency
  ) a
  order by a.video_plays desc;
$$;

create or replace function analytics.meta_ads_action_performance_filtered(
  p_from date, p_to date,
  p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null,
  p_objective text default null, p_search text default null,
  p_purchase_status text default null, p_video_status text default null,
  p_min_spend numeric default null, p_max_spend numeric default null,
  p_min_roas numeric default null, p_max_roas numeric default null,
  p_min_frequency numeric default null,
  p_funnel_status text default null, p_messaging_status text default null,
  p_min_purchases numeric default null, p_max_frequency numeric default null
)
returns table (
  action_type text, total_actions numeric, ads_with_action bigint,
  campaigns_with_action bigint, first_seen date, last_seen date, conversion_value numeric
)
language sql
stable
as $$
  with ads as (
    select ad_id from analytics.meta_ads_filtered_ads(
      p_from, p_to, p_campaign_id, p_adset_id, p_ad_id, p_objective, p_search,
      p_purchase_status, p_video_status, p_min_spend, p_max_spend, p_min_roas, p_max_roas, p_min_frequency,
      p_funnel_status, p_messaging_status, p_min_purchases, p_max_frequency
    )
  )
  select
    a.action_type,
    coalesce(sum(a.value), 0),
    count(distinct a.ad_id),
    count(distinct a.campaign_id),
    min(a.date),
    max(a.date),
    coalesce(sum(v.conversion_value), 0)
  from data_pipeline.meta_ads_actions_daily a
  join ads f on f.ad_id = a.ad_id
  left join data_pipeline.meta_ads_action_values_daily v
    on v.ad_account_id = a.ad_account_id
   and v.date = a.date
   and v.campaign_id = a.campaign_id
   and v.adset_id = a.adset_id
   and v.ad_id = a.ad_id
   and v.action_type = a.action_type
  where a.date >= p_from and a.date <= p_to
  group by a.action_type
  order by coalesce(sum(a.value), 0) desc;
$$;

grant execute on function analytics.meta_ads_filter_options(date, date) to service_role;
grant execute on function analytics.meta_ads_filtered_ads(date, date, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) to service_role;
grant execute on function analytics.meta_ads_kpis_filtered(date, date, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) to service_role;
grant execute on function analytics.meta_ads_daily_filtered(date, date, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) to service_role;
grant execute on function analytics.meta_campaign_performance_filtered(date, date, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) to service_role;
grant execute on function analytics.meta_adset_performance_filtered(date, date, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) to service_role;
grant execute on function analytics.meta_ad_performance_filtered(date, date, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) to service_role;
grant execute on function analytics.meta_ads_funnel_filtered(date, date, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) to service_role;
grant execute on function analytics.meta_ads_video_filtered(date, date, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) to service_role;
grant execute on function analytics.meta_ads_action_performance_filtered(date, date, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, numeric, numeric) to service_role;
