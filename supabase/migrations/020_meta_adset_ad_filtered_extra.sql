-- 020_meta_adset_ad_filtered_extra.sql - fix Ad set/Ad tables showing — for Frequency/CPM/Impressions/Delivery

-- Add impressions/reach/cpm/frequency/delivery to adset/ad for_range and filtered
drop function if exists analytics.meta_adset_performance_for_range(date,date) cascade;
create or replace function analytics.meta_adset_performance_for_range(p_from date, p_to date)
returns table (
  campaign_id text, campaign_name text, adset_id text, adset_name text,
  spend numeric, impressions numeric, reach numeric, cpm numeric, frequency numeric,
  ctr numeric, link_clicks numeric, landing_page_views numeric, adds_to_cart numeric,
  checkouts numeric, purchases numeric, cost_per_purchase numeric, purchase_value numeric, roas numeric,
  delivery text, status text, budget numeric, ends timestamptz, bid_strategy text, attribution_setting text
)
language sql stable as $$
  select d.campaign_id, max(d.campaign_name), d.adset_id, max(d.adset_name),
    coalesce(sum(d.spend),0), coalesce(sum(d.impressions),0), coalesce(sum(d.reach),0),
    case when coalesce(sum(d.impressions),0)>0 then sum(d.spend)/sum(d.impressions)*1000 else null end,
    case when coalesce(sum(d.impressions),0)>0 then sum(coalesce(d.frequency,0)*coalesce(d.impressions,0))/sum(d.impressions) else null end,
    case when coalesce(sum(d.impressions),0)>0 then sum(d.clicks)::numeric/sum(d.impressions) else null end,
    coalesce(sum(d.inline_link_clicks),0), coalesce(sum(d.landing_page_views),0), coalesce(sum(d.adds_to_cart),0),
    coalesce(sum(d.checkouts_initiated),0), coalesce(sum(d.purchases),0),
    case when coalesce(sum(d.purchases),0)>0 then sum(d.spend)/sum(d.purchases) else null end,
    coalesce(sum(d.purchase_value),0),
    case when coalesce(sum(d.spend),0)>0 then sum(d.purchase_value)/sum(d.spend) else null end,
    max(coalesce(a.effective_status,a.status)), max(a.status), max(coalesce(a.daily_budget,a.lifetime_budget)), max(a.end_time), max(a.bid_strategy), max(a.attribution_setting)
  from data_pipeline.meta_ads_daily d left join data_pipeline.meta_adsets a on a.adset_id=d.adset_id
  where d.date >= p_from and d.date <= p_to
  group by d.campaign_id, d.adset_id order by coalesce(sum(d.spend),0) desc;
$$;

drop function if exists analytics.meta_ad_performance_for_range(date,date) cascade;
create or replace function analytics.meta_ad_performance_for_range(p_from date, p_to date)
returns table (
  campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  spend numeric, impressions numeric, reach numeric, cpm numeric, frequency numeric,
  ctr numeric, link_clicks numeric, landing_page_views numeric, adds_to_cart numeric,
  checkouts numeric, purchases numeric, cost_per_purchase numeric, purchase_value numeric, roas numeric,
  delivery text, status text
)
language sql stable as $$
  select d.campaign_id, max(d.campaign_name), d.adset_id, max(d.adset_name), d.ad_id, max(d.ad_name),
    coalesce(sum(d.spend),0), coalesce(sum(d.impressions),0), coalesce(sum(d.reach),0),
    case when coalesce(sum(d.impressions),0)>0 then sum(d.spend)/sum(d.impressions)*1000 else null end,
    case when coalesce(sum(d.impressions),0)>0 then sum(coalesce(d.frequency,0)*coalesce(d.impressions,0))/sum(d.impressions) else null end,
    case when coalesce(sum(d.impressions),0)>0 then sum(d.clicks)::numeric/sum(d.impressions) else null end,
    coalesce(sum(d.inline_link_clicks),0), coalesce(sum(d.landing_page_views),0), coalesce(sum(d.adds_to_cart),0),
    coalesce(sum(d.checkouts_initiated),0), coalesce(sum(d.purchases),0),
    case when coalesce(sum(d.purchases),0)>0 then sum(d.spend)/sum(d.purchases) else null end,
    coalesce(sum(d.purchase_value),0),
    case when coalesce(sum(d.spend),0)>0 then sum(d.purchase_value)/sum(d.spend) else null end,
    max(coalesce(ad.effective_status, ad.status)), max(ad.status)
  from data_pipeline.meta_ads_daily d left join data_pipeline.meta_ads ad on ad.ad_id=d.ad_id
  where d.date >= p_from and d.date <= p_to
  group by d.campaign_id, d.adset_id, d.ad_id order by coalesce(sum(d.spend),0) desc;
$$;

-- Fix filtered versions similarly - add missing columns
drop function if exists analytics.meta_adset_performance_filtered(date,date,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric) cascade;
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
  spend numeric, impressions numeric, reach numeric, cpm numeric, frequency numeric,
  ctr numeric, landing_page_views numeric, adds_to_cart numeric, checkouts numeric, purchases numeric,
  cost_per_purchase numeric, purchase_value numeric, roas numeric,
  delivery text, budget numeric, bid_strategy text, attribution_setting text, ends timestamptz
)
language sql stable as $$
  select a.campaign_id, max(a.campaign_name), a.adset_id, max(a.adset_name),
    coalesce(sum(a.spend),0), coalesce(sum(a.impressions),0), coalesce(sum(a.reach),0),
    case when coalesce(sum(a.impressions),0)>0 then sum(a.spend)/sum(a.impressions)*1000 else null end,
    case when coalesce(sum(a.impressions),0)>0 then sum(a.weighted_impr_freq)/sum(a.impressions) else null end,
    case when coalesce(sum(a.impressions),0)>0 then sum(a.clicks)/sum(a.impressions) else null end,
    coalesce(sum(a.landing_page_views),0), coalesce(sum(a.adds_to_cart),0), coalesce(sum(a.checkouts),0), coalesce(sum(a.purchases),0),
    case when coalesce(sum(a.purchases),0)>0 then sum(a.spend)/sum(a.purchases) else null end,
    coalesce(sum(a.purchase_value),0),
    case when coalesce(sum(a.spend),0)>0 then sum(a.purchase_value)/sum(a.spend) else null end,
    max(a.effective_status), max(a.budget), max(a.bid_strategy), max(a.attribution_setting), max(a.ends)
  from (
    select d.campaign_id, max(d.campaign_name) as campaign_name, d.adset_id, max(d.adset_name) as adset_name,
      sum(d.spend) as spend, sum(d.impressions) as impressions, sum(d.reach) as reach, sum(d.clicks) as clicks,
      sum(d.inline_link_clicks) as link_clicks, sum(d.landing_page_views) as landing_page_views,
      sum(d.adds_to_cart) as adds_to_cart, sum(d.checkouts_initiated) as checkouts, sum(d.purchases) as purchases, sum(d.purchase_value) as purchase_value,
      sum(coalesce(d.frequency,0)*coalesce(d.impressions,0)) as weighted_impr_freq,
      max(coalesce(ast.effective_status,ast.status)) as effective_status, max(coalesce(ast.daily_budget,ast.lifetime_budget)) as budget, max(ast.bid_strategy) as bid_strategy, max(ast.attribution_setting) as attribution_setting, max(ast.end_time) as ends
    from data_pipeline.meta_ads_daily d left join data_pipeline.meta_adsets ast on ast.adset_id=d.adset_id
    where d.date >= p_from and d.date <= p_to
      and (p_campaign_id is null or p_campaign_id='' or d.campaign_id=p_campaign_id)
      and (p_adset_id is null or p_adset_id='' or d.adset_id=p_adset_id)
      and (p_ad_id is null or p_ad_id='' or d.ad_id=p_ad_id)
      and (p_objective is null or p_objective='' or coalesce(nullif(d.objective,''),'Unknown')=p_objective)
      and (p_search is null or p_search='' or d.campaign_name ilike '%'||p_search||'%' or d.adset_name ilike '%'||p_search||'%' or d.ad_name ilike '%'||p_search||'%' or d.campaign_id=p_search or d.adset_id=p_search or d.ad_id=p_search)
    group by d.campaign_id, d.adset_id, d.ad_id
    having (p_purchase_status is null or p_purchase_status in ('','all') or (p_purchase_status='with' and coalesce(sum(d.purchases),0)>0) or (p_purchase_status='without' and coalesce(sum(d.purchases),0)=0))
      and (p_video_status is null or p_video_status in ('','all') or (p_video_status='has_video' and coalesce(sum(d.video_plays),0)>0))
      and (p_min_spend is null or coalesce(sum(d.spend),0)>=p_min_spend) and (p_max_spend is null or coalesce(sum(d.spend),0)<=p_max_spend)
      and (p_min_roas is null or (coalesce(sum(d.spend),0)>0 and coalesce(sum(d.purchase_value),0)/sum(d.spend)>=p_min_roas))
      and (p_max_roas is null or (coalesce(sum(d.spend),0)>0 and coalesce(sum(d.purchase_value),0)/sum(d.spend)<=p_max_roas))
      and (p_min_frequency is null or (coalesce(sum(d.impressions),0)>0 and sum(coalesce(d.frequency,0)*coalesce(d.impressions,0))/sum(d.impressions)>=p_min_frequency))
      and (p_funnel_status is null or p_funnel_status in ('','all') or (p_funnel_status='has_lpv' and coalesce(sum(d.landing_page_views),0)>0) or (p_funnel_status='has_atc' and coalesce(sum(d.adds_to_cart),0)>0) or (p_funnel_status='has_checkout' and coalesce(sum(d.checkouts_initiated),0)>0))
      and (p_messaging_status is null or p_messaging_status in ('','all') or (p_messaging_status='with' and coalesce(sum(d.messaging_conversations_started),0)>0) or (p_messaging_status='without' and coalesce(sum(d.messaging_conversations_started),0)=0))
      and (p_min_purchases is null or coalesce(sum(d.purchases),0)>=p_min_purchases)
      and (p_max_frequency is null or (coalesce(sum(d.impressions),0)>0 and sum(coalesce(d.frequency,0)*coalesce(d.impressions,0))/sum(d.impressions)<=p_max_frequency))
  ) a group by a.campaign_id, a.adset_id order by coalesce(sum(a.spend),0) desc;
$$;

drop function if exists analytics.meta_ad_performance_filtered(date,date,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric) cascade;
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
  campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  spend numeric, impressions numeric, reach numeric, cpm numeric, frequency numeric, ctr numeric,
  landing_page_views numeric, adds_to_cart numeric, checkouts numeric, purchases numeric, cost_per_purchase numeric, purchase_value numeric, roas numeric,
  delivery text
)
language sql stable as $$
  select a.campaign_id, a.campaign_name, a.adset_id, a.adset_name, a.ad_id, a.ad_name,
    a.spend, a.impressions, a.reach,
    case when a.impressions>0 then a.spend/a.impressions*1000 else null end,
    a.frequency,
    case when a.impressions>0 then a.clicks/a.impressions else null end,
    a.landing_page_views, a.adds_to_cart, a.checkouts, a.purchases,
    case when a.purchases>0 then a.spend/a.purchases else null end,
    a.purchase_value, case when a.spend>0 then a.purchase_value/a.spend else null end,
    null::text as delivery
  from analytics.meta_ads_filtered_ads(p_from,p_to,p_campaign_id,p_adset_id,p_ad_id,p_objective,p_search,p_purchase_status,p_video_status,p_min_spend,p_max_spend,p_min_roas,p_max_roas,p_min_frequency,p_funnel_status,p_messaging_status,p_min_purchases,p_max_frequency) a
  order by a.spend desc;
$$;

grant execute on function analytics.meta_adset_performance_for_range(date,date) to service_role;
grant execute on function analytics.meta_ad_performance_for_range(date,date) to service_role;
grant execute on function analytics.meta_adset_performance_filtered(date,date,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric) to service_role;
grant execute on function analytics.meta_ad_performance_filtered(date,date,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric) to service_role;
