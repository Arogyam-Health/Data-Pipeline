-- 021_website_roas_fix.sql - fix ROAS to use website conversion value, not total value

-- Add website purchase value approximation: website_purchases * (purchase_value / nullif(purchases,0))
drop function if exists analytics.meta_campaign_performance_for_range(date,date) cascade;
create or replace function analytics.meta_campaign_performance_for_range(p_from date, p_to date)
returns table (
  campaign_id text, campaign_name text,
  spend numeric, impressions numeric, reach numeric,
  ctr numeric, cpm numeric, frequency numeric,
  link_clicks numeric, landing_page_views numeric, adds_to_cart numeric,
  checkouts numeric, purchases numeric, cost_per_purchase numeric, purchase_value numeric, roas numeric,
  website_purchases numeric, website_purchase_value numeric, website_roas numeric,
  delivery text, status text, effective_status text, budget numeric, ends timestamptz, attribution_setting text
)
language sql stable as $$
  select
    d.campaign_id, max(d.campaign_name),
    coalesce(sum(d.spend),0), coalesce(sum(d.impressions),0), coalesce(sum(d.reach),0),
    case when coalesce(sum(d.impressions),0)>0 then sum(d.clicks)::numeric/sum(d.impressions) else null end,
    case when coalesce(sum(d.impressions),0)>0 then sum(d.spend)/sum(d.impressions)*1000 else null end,
    case when coalesce(sum(d.impressions),0)>0 then sum(coalesce(d.frequency,0)*coalesce(d.impressions,0))/sum(d.impressions) else null end,
    coalesce(sum(d.inline_link_clicks),0), coalesce(sum(d.landing_page_views),0), coalesce(sum(d.adds_to_cart),0),
    coalesce(sum(d.checkouts_initiated),0), coalesce(sum(d.purchases),0),
    case when coalesce(sum(d.purchases),0)>0 then sum(d.spend)/sum(d.purchases) else null end,
    coalesce(sum(d.purchase_value),0),
    case when coalesce(sum(d.spend),0)>0 then sum(d.purchase_value)/sum(d.spend) else null end,
    coalesce(sum(d.website_purchases),0),
    coalesce(sum(case when coalesce(d.purchases,0)>0 then d.purchase_value * (d.website_purchases::numeric / d.purchases) else 0 end),0),
    case when coalesce(sum(d.spend),0)>0 then coalesce(sum(case when coalesce(d.purchases,0)>0 then d.purchase_value * (d.website_purchases::numeric / d.purchases) else 0 end),0) / sum(d.spend) else null end,
    max(coalesce(c.effective_status,c.status)), max(c.status), max(c.effective_status),
    max(coalesce(c.daily_budget,c.lifetime_budget)), max(c.stop_time), max(c.attribution_setting)
  from data_pipeline.meta_ads_daily d
  left join data_pipeline.meta_campaigns c on c.campaign_id=d.campaign_id
  where d.date >= p_from and d.date <= p_to
  group by d.campaign_id order by coalesce(sum(d.spend),0) desc;
$$;

drop function if exists analytics.meta_campaign_performance_filtered(date,date,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric) cascade;
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
  ctr numeric, cpm numeric, frequency numeric, link_clicks numeric, landing_page_views numeric, adds_to_cart numeric,
  checkouts numeric, purchases numeric, cost_per_purchase numeric, purchase_value numeric, roas numeric,
  website_purchases numeric, website_purchase_value numeric, website_roas numeric,
  delivery text, status text, effective_status text, budget numeric, ends timestamptz, attribution_setting text
)
language sql stable as $$
  select
    a.campaign_id, max(a.campaign_name), coalesce(sum(a.spend),0), coalesce(sum(a.impressions),0), coalesce(sum(a.reach),0),
    case when coalesce(sum(a.impressions),0)>0 then sum(a.clicks)/sum(a.impressions) else null end,
    case when coalesce(sum(a.impressions),0)>0 then sum(a.spend)/sum(a.impressions)*1000 else null end,
    case when coalesce(sum(a.impressions),0)>0 then sum(a.weighted_impr_freq)/sum(a.impressions) else null end,
    coalesce(sum(a.link_clicks),0), coalesce(sum(a.landing_page_views),0), coalesce(sum(a.adds_to_cart),0),
    coalesce(sum(a.checkouts),0), coalesce(sum(a.purchases),0),
    case when coalesce(sum(a.purchases),0)>0 then sum(a.spend)/sum(a.purchases) else null end,
    coalesce(sum(a.purchase_value),0),
    case when coalesce(sum(a.spend),0)>0 then sum(a.purchase_value)/sum(a.spend) else null end,
    coalesce(sum(a.website_purchases),0),
    coalesce(sum(a.website_value),0),
    case when coalesce(sum(a.spend),0)>0 then sum(a.website_value)/sum(a.spend) else null end,
    max(a.effective_status), max(a.status), max(a.effective_status),
    max(a.budget), max(a.ends), max(a.attribution_setting)
  from (
    select
      d.campaign_id, max(d.campaign_name) as campaign_name,
      sum(d.spend) as spend, sum(d.impressions) as impressions, sum(d.reach) as reach,
      sum(d.clicks) as clicks, sum(d.inline_link_clicks) as link_clicks,
      sum(d.landing_page_views) as landing_page_views, sum(d.adds_to_cart) as adds_to_cart, sum(d.checkouts_initiated) as checkouts,
      sum(d.purchases) as purchases, sum(d.website_purchases) as website_purchases, sum(d.purchase_value) as purchase_value,
      sum(case when coalesce(d.purchases,0)>0 then d.purchase_value * (d.website_purchases::numeric / d.purchases) else 0 end) as website_value,
      sum(coalesce(d.frequency,0)*coalesce(d.impressions,0)) as weighted_impr_freq,
      max(coalesce(c.effective_status,c.status)) as effective_status, max(c.status) as status,
      max(coalesce(c.daily_budget,c.lifetime_budget)) as budget, max(c.stop_time) as ends, max(c.attribution_setting) as attribution_setting
    from data_pipeline.meta_ads_daily d
    left join data_pipeline.meta_campaigns c on c.campaign_id=d.campaign_id
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
  ) a
  group by a.campaign_id order by coalesce(sum(a.spend),0) desc;
$$;

grant execute on function analytics.meta_campaign_performance_for_range(date,date) to service_role;
grant execute on function analytics.meta_campaign_performance_filtered(date,date,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,numeric,numeric) to service_role;
