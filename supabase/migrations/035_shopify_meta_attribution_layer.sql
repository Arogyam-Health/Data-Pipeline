-- 035_shopify_meta_attribution_layer.sql
-- Day 2 — Meta → Shopify Attribution Layer
-- Purpose: One row per Shopify order, deterministic Meta hierarchy (ad > adset > campaign)
--          + separate channel attribution (META/DIRECT/GOOGLE/KWIKENGAGE/OTHER/UNKNOWN)
--          Channel attribution ≠ Meta attribution. Direct is attributed, not unattributed.
-- Design: VIEW in data_pipeline (dynamic, no duplication). Chosen over TABLE/MATERIALIZED
--         because: (1) existing analytics views use plain VIEWs (011_shopify_analytics_views.sql),
--         (2) source is note_attributes pivot — view stays fresh without refresh jobs,
--         (3) no aggregation, one-row-per-order guarantee via GROUP BY shopify_order_id.
--         Grants follow analytics view pattern (service_role, authenticated).
-- Portable: no project IDs, no secrets.

create schema if not exists data_pipeline;
create schema if not exists analytics;

-- ============================================================
-- Helper: ensure index for pivot performance (idempotent)
-- ============================================================
create index if not exists idx_shopify_note_attributes_order_name_lower
  on data_pipeline.shopify_note_attributes (shopify_order_id, lower(attribute_name));

-- ============================================================
-- Main attribution view: data_pipeline.shopify_meta_attribution
-- ============================================================
create or replace view data_pipeline.shopify_meta_attribution as
with order_utm as (
  -- ONE ROW PER SHOPIFY ORDER — validated Day 1 pattern
  select
    o.shopify_order_id,
    o.order_name,
    o.order_number,
    o.created_at_shopify,
    o.processed_at,
    o.financial_status,
    o.fulfillment_status,
    o.total_price,
    o.currency,
    -- Raw UTM (preserve original)
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_source')  as utm_source_raw,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_medium')  as utm_medium_raw,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_campaign') as utm_campaign_raw,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_term')     as utm_term_raw,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_content')  as utm_content_raw
  from data_pipeline.shopify_orders o
  left join data_pipeline.shopify_note_attributes na
    on na.shopify_order_id = o.shopify_order_id
  group by o.shopify_order_id, o.order_name, o.order_number, o.created_at_shopify, o.processed_at, o.financial_status, o.fulfillment_status, o.total_price, o.currency
),
normalized as (
  select
    *,
    -- Normalized UTM (btrim + nullif). Source additionally lower().
    nullif(btrim(utm_source_raw), '')  as utm_source_btrim,
    lower(nullif(btrim(utm_source_raw), '')) as utm_source_normalized,
    nullif(btrim(utm_medium_raw), '')  as utm_medium_normalized,
    nullif(btrim(utm_campaign_raw), '') as utm_campaign_normalized,
    nullif(btrim(utm_term_raw), '')     as utm_term_normalized,
    nullif(btrim(utm_content_raw), '')  as utm_content_normalized,
    -- Malformed detection: unresolved template placeholders {{...}}
    (
      coalesce(utm_source_raw,'')  like '%{{%}}%' or
      coalesce(utm_medium_raw,'')  like '%{{%}}%' or
      coalesce(utm_campaign_raw,'') like '%{{%}}%' or
      coalesce(utm_term_raw,'')     like '%{{%}}%' or
      coalesce(utm_content_raw,'')  like '%{{%}}%'
    ) as has_malformed_utm,
    array_remove(array[
      case when coalesce(utm_source_raw,'')  like '%{{%}}%' then 'utm_source' end,
      case when coalesce(utm_medium_raw,'')  like '%{{%}}%' then 'utm_medium' end,
      case when coalesce(utm_campaign_raw,'') like '%{{%}}%' then 'utm_campaign' end,
      case when coalesce(utm_term_raw,'')     like '%{{%}}%' then 'utm_term' end,
      case when coalesce(utm_content_raw,'')  like '%{{%}}%' then 'utm_content' end
    ], null) as malformed_utm_fields
  from order_utm
),
channel as (
  select
    *,
    -- Channel classification (separate from Meta attribution)
    case
      when lower(nullif(btrim(utm_source_raw), '')) in ('facebook','meta','instagram','fb','ig','an') then 'META'
      when lower(nullif(btrim(utm_source_raw), '')) = 'direct' then 'DIRECT'
      when lower(nullif(btrim(utm_source_raw), '')) = 'google' then 'GOOGLE'
      when lower(nullif(btrim(utm_source_raw), '')) = 'kwikengage' then 'KWIKENGAGE'
      when utm_source_normalized is not null and has_malformed_utm = false then 'OTHER'
      when has_malformed_utm = true and utm_source_normalized is not null then 'UNKNOWN' -- malformed placeholders not valid channels
      else 'UNKNOWN'
    end as channel,
    case
      when lower(nullif(btrim(utm_source_raw), '')) in ('facebook','meta','instagram','fb','ig','an') then true
      when lower(nullif(btrim(utm_source_raw), '')) = 'direct' then true
      when lower(nullif(btrim(utm_source_raw), '')) = 'google' then true
      when lower(nullif(btrim(utm_source_raw), '')) = 'kwikengage' then true
      when utm_source_normalized is not null and has_malformed_utm = false then true
      else false
    end as channel_attributed,
    utm_source_raw as channel_source_raw,
    utm_source_normalized as channel_source_normalized,
    -- Meta source flag (for META_SOURCE_ONLY)
    (lower(nullif(btrim(utm_source_raw), '')) in ('facebook','meta','instagram','fb','ig','an')) as is_meta_source
  from normalized
),
matched as (
  select
    c.*,
    -- Direct matching evidence (btrim normalized ids)
    mc.campaign_id as matched_campaign_id,
    mc.name as matched_campaign_name,
    ma.adset_id as matched_adset_id,
    ma.name as matched_adset_name,
    mad.ad_id as matched_ad_id,
    mad.name as matched_ad_name,
    mad.adset_id as matched_ad_adset_id,
    mad.campaign_id as matched_ad_campaign_id,
    ma.campaign_id as matched_adset_campaign_id
  from channel c
  left join data_pipeline.meta_campaigns mc
    on c.utm_campaign_normalized is not null and btrim(c.utm_campaign_normalized) = mc.campaign_id
  left join data_pipeline.meta_adsets ma
    on c.utm_term_normalized is not null and btrim(c.utm_term_normalized) = ma.adset_id
  left join data_pipeline.meta_ads mad
    on c.utm_content_normalized is not null and btrim(c.utm_content_normalized) = mad.ad_id
),
resolved as (
  select
    m.*,
    -- Resolved Meta fields: strongest deterministic identifier wins
    -- resolved_ad_id is only from matched ad
    matched_ad_id as resolved_ad_id,
    coalesce(matched_ad_adset_id, matched_adset_id) as resolved_adset_id,
    coalesce(matched_ad_campaign_id, matched_adset_campaign_id, matched_campaign_id) as resolved_campaign_id,
    -- Names will be joined after (need joins for resolved ids, not just matched)
    -- Keep direct names for debugging: matched_* already, resolved names below
    case
      when matched_ad_id is not null then 'EXACT_AD'
      when matched_adset_id is not null then 'EXACT_ADSET'
      when matched_campaign_id is not null then 'EXACT_CAMPAIGN'
      when is_meta_source then 'META_SOURCE_ONLY'
      else 'NO_META_MATCH'
    end as meta_attribution_state,
    case
      when matched_ad_id is not null then 'UTM_CONTENT_AD_ID'
      when matched_adset_id is not null then 'UTM_TERM_ADSET_ID'
      when matched_campaign_id is not null then 'UTM_CAMPAIGN_ID'
      when lower(nullif(btrim(utm_source_raw), '')) in ('facebook','meta','instagram','fb','ig','an') then 'META_SOURCE_ONLY'
      when lower(nullif(btrim(utm_source_raw), '')) = 'direct' then 'DIRECT_SOURCE'
      when lower(nullif(btrim(utm_source_raw), '')) = 'google' then 'GOOGLE_SOURCE'
      when lower(nullif(btrim(utm_source_raw), '')) = 'kwikengage' then 'KWIKENGAGE_SOURCE'
      when utm_source_normalized is not null and has_malformed_utm = false then 'OTHER_SOURCE'
      else 'NO_SOURCE'
    end as attribution_method
  from matched m
),
-- Join resolved names (authoritative dimension tables)
with_names as (
  select
    r.*,
    mad_resolved.name as resolved_ad_name,
    mas_resolved.name as resolved_adset_name,
    mc_resolved.name as resolved_campaign_name,
    -- Overall attribution state (channel vs meta)
    case
      when r.meta_attribution_state in ('EXACT_AD','EXACT_ADSET','EXACT_CAMPAIGN') then 'META_EXACT'
      when r.meta_attribution_state = 'META_SOURCE_ONLY' then 'META_SOURCE_ONLY'
      when r.channel_attributed = true then 'CHANNEL_ATTRIBUTED'
      else 'UNATTRIBUTED'
    end as attribution_state,
    -- Diagnostics: consistency vs Meta hierarchy
    case
      when r.matched_ad_id is null then 'NOT_APPLICABLE'
      when r.utm_term_normalized is null then 'MISSING_UTM_TERM'
      when btrim(r.utm_term_normalized) = r.matched_ad_adset_id then 'MATCH'
      else 'CONFLICT'
    end as adset_consistency_status,
    case
      when r.matched_ad_id is not null then
        case
          when r.utm_campaign_normalized is null then 'MISSING_UTM_CAMPAIGN'
          when btrim(r.utm_campaign_normalized) = r.matched_ad_campaign_id then 'MATCH'
          else 'CONFLICT'
        end
      when r.matched_adset_id is not null then
        case
          when r.utm_campaign_normalized is null then 'MISSING_UTM_CAMPAIGN'
          when btrim(r.utm_campaign_normalized) = r.matched_adset_campaign_id then 'MATCH'
          else 'CONFLICT'
        end
      else 'NOT_APPLICABLE'
    end as campaign_consistency_status
  from resolved r
  left join data_pipeline.meta_ads mad_resolved
    on mad_resolved.ad_id = r.matched_ad_id
  left join data_pipeline.meta_adsets mas_resolved
    on mas_resolved.adset_id = coalesce(r.matched_ad_adset_id, r.matched_adset_id)
  left join data_pipeline.meta_campaigns mc_resolved
    on mc_resolved.campaign_id = coalesce(r.matched_ad_campaign_id, r.matched_adset_campaign_id, r.matched_campaign_id)
)
select
  -- Identity
  shopify_order_id,
  order_name,
  order_number,
  created_at_shopify,
  processed_at,
  financial_status,
  fulfillment_status,
  total_price,
  currency,
  -- Raw UTM
  utm_source_raw,
  utm_medium_raw,
  utm_campaign_raw,
  utm_term_raw,
  utm_content_raw,
  -- Normalized UTM
  utm_source_normalized,
  utm_medium_normalized,
  utm_campaign_normalized,
  utm_term_normalized,
  utm_content_normalized,
  -- Channel attribution (separate)
  channel,
  channel_attributed,
  channel_source_raw,
  channel_source_normalized,
  is_meta_source,
  -- Direct matching evidence
  matched_campaign_id,
  matched_adset_id,
  matched_ad_id,
  -- Resolved Meta fields (hierarchy derived)
  resolved_campaign_id,
  resolved_campaign_name,
  resolved_adset_id,
  resolved_adset_name,
  resolved_ad_id,
  resolved_ad_name,
  -- Attribution classification
  meta_attribution_state,
  attribution_state,
  attribution_method,
  -- Diagnostics
  adset_consistency_status,
  campaign_consistency_status,
  (adset_consistency_status = 'CONFLICT' or campaign_consistency_status = 'CONFLICT') as hierarchy_conflict,
  has_malformed_utm,
  malformed_utm_fields,
  case
    when meta_attribution_state = 'EXACT_AD' and campaign_consistency_status = 'MATCH' and adset_consistency_status in ('MATCH','MISSING_UTM_TERM') then 'HIGH'
    when meta_attribution_state in ('EXACT_AD','EXACT_ADSET','EXACT_CAMPAIGN') then 'MEDIUM'
    when meta_attribution_state = 'META_SOURCE_ONLY' then 'LOW'
    when channel_attributed = true then 'CHANNEL_ONLY'
    else 'NONE'
  end as tracking_quality
from with_names;

-- Grants (match analytics view pattern)
grant select on data_pipeline.shopify_meta_attribution to service_role, authenticated;
grant usage on schema data_pipeline to service_role, authenticated;

-- Friendly analytics alias (optional, mirrors data_pipeline view)
create or replace view analytics.shopify_meta_attribution as
select * from data_pipeline.shopify_meta_attribution;

grant select on analytics.shopify_meta_attribution to service_role, authenticated;
grant usage on schema analytics to service_role, authenticated;

-- Comment
comment on view data_pipeline.shopify_meta_attribution is
'Day 2 attribution layer: one row per Shopify order, deterministic Meta hierarchy ad>adset>campaign, separate channel attribution (direct/google/kwikengage not unattributed), conflict flags, malformed detection. See docs/DAY2_META_SHOPIFY_ATTRIBUTION_LAYER.md';

-- ============================================================
-- Helpful indexes (if not already created via 034)
-- ============================================================
create index if not exists idx_shopify_orders_created_at
  on data_pipeline.shopify_orders (created_at_shopify);
create index if not exists idx_meta_ads_adset_campaign
  on data_pipeline.meta_ads (adset_id, campaign_id);
create index if not exists idx_meta_adsets_campaign
  on data_pipeline.meta_adsets (campaign_id);
