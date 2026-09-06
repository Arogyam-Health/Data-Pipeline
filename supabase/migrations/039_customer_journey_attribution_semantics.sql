-- 039_customer_journey_attribution_semantics.sql
-- Additive semantic correction: channel attribution and Meta attribution are
-- independent dimensions. Existing views/migrations remain immutable.

create schema if not exists data_pipeline;
create schema if not exists analytics;

create or replace view data_pipeline.shopify_meta_attribution_v2 with (security_invoker = true) as
select
  a.*,
  case
    when a.meta_attribution_state in ('EXACT_AD', 'EXACT_ADSET', 'EXACT_CAMPAIGN') then 'META'
    else a.channel
  end as channel_attribution,
  case
    when a.meta_attribution_state in ('EXACT_AD', 'EXACT_ADSET', 'EXACT_CAMPAIGN') then true
    else coalesce(a.channel_attributed, false)
  end as channel_attributed_v2,
  a.utm_source_raw as channel_raw_source,
  case
    when a.meta_attribution_state in ('EXACT_AD', 'EXACT_ADSET', 'EXACT_CAMPAIGN')
      and a.channel <> 'META' then 'EXACT_META_ID_OVERRIDE'
    when a.utm_source_raw is not null and btrim(a.utm_source_raw) <> '' then 'UTM_SOURCE'
    else 'NO_SOURCE_EVIDENCE'
  end as channel_attribution_method,
  (a.meta_attribution_state in ('EXACT_AD', 'EXACT_ADSET', 'EXACT_CAMPAIGN') and a.channel <> 'META') as channel_conflict,
  a.meta_attribution_state as meta_attribution,
  a.attribution_method as meta_attribution_method,
  a.hierarchy_conflict as meta_hierarchy_conflict,
  nullif(concat_ws('; ',
    case when a.adset_consistency_status = 'CONFLICT' then 'utm_term contradicts the resolved Meta ad hierarchy' end,
    case when a.campaign_consistency_status = 'CONFLICT' then 'utm_campaign contradicts the resolved Meta campaign hierarchy' end
  ), '') as meta_conflict_reason
from data_pipeline.shopify_meta_attribution a;

grant select on data_pipeline.shopify_meta_attribution_v2 to service_role, authenticated;

create or replace view analytics.shopify_meta_attribution_v2 with (security_invoker = true) as
select * from data_pipeline.shopify_meta_attribution_v2;
grant select on analytics.shopify_meta_attribution_v2 to service_role, authenticated;

create or replace view data_pipeline.mart_order_journey_v2 with (security_invoker = true) as
select
  j.*,
  a.utm_source_raw as utm_source,
  a.utm_medium_raw as utm_medium,
  a.utm_campaign_raw as utm_campaign,
  a.utm_term_raw as utm_term,
  a.utm_content_raw as utm_content,
  a.channel_attribution,
  a.channel_attributed_v2 as channel_attributed_canonical,
  a.channel_attribution_method,
  a.channel_raw_source,
  a.channel_conflict,
  a.meta_attribution,
  a.meta_attribution_method,
  a.meta_hierarchy_conflict,
  a.meta_conflict_reason
from data_pipeline.mart_order_journey j
left join data_pipeline.shopify_meta_attribution_v2 a using (shopify_order_id);

grant select on data_pipeline.mart_order_journey_v2 to service_role, authenticated;

create or replace view analytics.mart_order_journey_v2 with (security_invoker = true) as
select * from data_pipeline.mart_order_journey_v2;
grant select on analytics.mart_order_journey_v2 to service_role, authenticated;

comment on view data_pipeline.shopify_meta_attribution_v2 is
'Semantic attribution contract: channel_attribution is independent from meta_attribution; exact Meta IDs override weak source text with channel_conflict preserved.';
