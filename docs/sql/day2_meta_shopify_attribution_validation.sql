-- docs/sql/day2_meta_shopify_attribution_validation.sql
-- Day 2 — Meta → Shopify Attribution Layer — Validation
-- Target: data_pipeline.shopify_meta_attribution (and analytics.shopify_meta_attribution alias)
-- View defined in supabase/migrations/035_shopify_meta_attribution_layer.sql
-- Validates: one-row-per-order, channel vs meta separation, hierarchy, conflicts, malformed, integrity
-- Run after applying migration 035. All queries are dynamic — do not hardcode counts.

-- ============================================================
-- V1 — one row per order
-- ============================================================
-- Must be equal. Never multiple rows per shopify_order_id.
select
  count(*) as rows,
  count(distinct shopify_order_id) as distinct_orders,
  (count(*) = count(distinct shopify_order_id)) as is_one_row_per_order
from data_pipeline.shopify_meta_attribution;

-- Optional: list duplicates if any
-- select shopify_order_id, count(*) from data_pipeline.shopify_meta_attribution group by shopify_order_id having count(*) > 1;

-- ============================================================
-- V2 — source/channel coverage
-- ============================================================
select
  channel,
  count(*) as orders,
  round(100.0 * count(*) / sum(count(*)) over (), 2) as pct,
  count(*) filter (where channel_attributed) as attributed_orders
from data_pipeline.shopify_meta_attribution
group by channel
order by orders desc;

-- Also overall
select
  count(*) as total_orders,
  count(*) filter (where channel_attributed) as channel_attributed_orders,
  round(100.0 * count(*) filter (where channel_attributed) / nullif(count(*),0), 2) as channel_attributed_pct,
  count(*) filter (where channel = 'UNKNOWN') as unknown_orders,
  round(100.0 * count(*) filter (where channel = 'UNKNOWN') / nullif(count(*),0), 2) as unknown_pct
from data_pipeline.shopify_meta_attribution;

-- ============================================================
-- V3 — Meta attribution state distribution
-- ============================================================
select
  meta_attribution_state,
  count(*) as orders,
  round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from data_pipeline.shopify_meta_attribution
group by meta_attribution_state
order by case meta_attribution_state
  when 'EXACT_AD' then 1
  when 'EXACT_ADSET' then 2
  when 'EXACT_CAMPAIGN' then 3
  when 'META_SOURCE_ONLY' then 4
  when 'NO_META_MATCH' then 5 else 6 end;

-- ============================================================
-- V4 — attribution method distribution
-- ============================================================
select
  attribution_method,
  count(*) as orders,
  round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from data_pipeline.shopify_meta_attribution
group by attribution_method
order by orders desc;

-- ============================================================
-- V5 — exact Meta hierarchy (EXACT_AD must have all three resolved)
-- ============================================================
select
  count(*) as exact_ad_orders,
  count(*) filter (where resolved_ad_id is not null and resolved_adset_id is not null and resolved_campaign_id is not null) as fully_resolved,
  count(*) filter (where resolved_ad_id is null or resolved_adset_id is null or resolved_campaign_id is null) as incomplete
from data_pipeline.shopify_meta_attribution
where meta_attribution_state = 'EXACT_AD';

-- ============================================================
-- V6 — exact adset hierarchy (EXACT_ADSET: ad null, adset+camp not null)
-- ============================================================
select
  count(*) as exact_adset_orders,
  count(*) filter (where resolved_ad_id is null) as ad_null_ok,
  count(*) filter (where resolved_adset_id is not null) as adset_resolved,
  count(*) filter (where resolved_campaign_id is not null) as campaign_resolved,
  count(*) filter (where resolved_ad_id is not null) as unexpected_ad
from data_pipeline.shopify_meta_attribution
where meta_attribution_state = 'EXACT_ADSET';

-- ============================================================
-- V7 — direct correctness
-- ============================================================
-- For source direct: channel=DIRECT, channel_attributed=true, meta_attribution_state=NO_META_MATCH
-- unless an exact Meta ID independently exists (suspicious tracking)
select
  count(*) as direct_orders,
  count(*) filter (where channel = 'DIRECT' and channel_attributed = true) as correct_direct,
  count(*) filter (where channel = 'DIRECT' and meta_attribution_state != 'NO_META_MATCH') as suspicious_direct_with_meta,
  count(*) filter (where channel = 'DIRECT' and has_malformed_utm) as malformed_direct
from data_pipeline.shopify_meta_attribution
where lower(btrim(coalesce(utm_source_raw,''))) = 'direct'
   or channel = 'DIRECT';

-- List suspicious direct with Meta IDs if any
-- select shopify_order_id, utm_source_raw, matched_ad_id, matched_adset_id, matched_campaign_id
-- from data_pipeline.shopify_meta_attribution
-- where channel = 'DIRECT' and meta_attribution_state != 'NO_META_MATCH';

-- ============================================================
-- V8 — unknown channel (truly blank/missing/malformed)
-- ============================================================
select
  count(*) as unknown_orders,
  count(*) filter (where has_malformed_utm) as malformed,
  count(*) filter (where utm_source_raw is null or btrim(utm_source_raw) = '') as blank_source,
  count(*) filter (where channel_attributed = false) as unattributed_flag
from data_pipeline.shopify_meta_attribution
where channel = 'UNKNOWN';

-- Show unknown samples
-- select shopify_order_id, utm_source_raw, utm_medium_raw, utm_campaign_raw, malformed_utm_fields
-- from data_pipeline.shopify_meta_attribution where channel = 'UNKNOWN' limit 10;

-- ============================================================
-- V9 — hierarchy conflicts
-- ============================================================
select
  adset_consistency_status,
  count(*) as orders,
  round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from data_pipeline.shopify_meta_attribution
group by adset_consistency_status
order by orders desc;

select
  campaign_consistency_status,
  count(*) as orders,
  round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from data_pipeline.shopify_meta_attribution
group by campaign_consistency_status
order by orders desc;

select
  hierarchy_conflict,
  count(*) as orders,
  round(100.0 * count(*) / nullif((select count(*) from data_pipeline.shopify_meta_attribution),0), 2) as pct
from data_pipeline.shopify_meta_attribution
group by hierarchy_conflict;

-- ============================================================
-- V10 — malformed UTMs
-- ============================================================
select
  has_malformed_utm,
  count(*) as orders
from data_pipeline.shopify_meta_attribution
group by has_malformed_utm;

-- List malformed values and counts
select
  unnest(malformed_utm_fields) as malformed_field,
  count(*) as orders
from data_pipeline.shopify_meta_attribution
where has_malformed_utm
group by unnest(malformed_utm_fields);

-- Raw malformed value samples
-- select utm_source_raw, utm_medium_raw, utm_campaign_raw, utm_term_raw, utm_content_raw, malformed_utm_fields
-- from data_pipeline.shopify_meta_attribution where has_malformed_utm limit 20;

-- ============================================================
-- V11 — resolved entity integrity (no orphan IDs)
-- ============================================================
select 'ad' as entity,
  count(*) filter (where resolved_ad_id is not null and not exists (select 1 from data_pipeline.meta_ads ad where ad.ad_id = resolved_ad_id)) as orphan_count
from data_pipeline.shopify_meta_attribution
union all
select 'adset',
  count(*) filter (where resolved_adset_id is not null and not exists (select 1 from data_pipeline.meta_adsets a where a.adset_id = resolved_adset_id))
from data_pipeline.shopify_meta_attribution
union all
select 'campaign',
  count(*) filter (where resolved_campaign_id is not null and not exists (select 1 from data_pipeline.meta_campaigns c where c.campaign_id = resolved_campaign_id))
from data_pipeline.shopify_meta_attribution;

-- Detail orphans if any
-- select shopify_order_id, resolved_ad_id from data_pipeline.shopify_meta_attribution where resolved_ad_id is not null and not exists (select 1 from data_pipeline.meta_ads ad where ad.ad_id = resolved_ad_id);

-- ============================================================
-- V12 — hierarchy integrity (ad's adset/campaign = resolved)
-- ============================================================
select
  count(*) as exact_ad_orders,
  count(*) filter (where exists (
    select 1 from data_pipeline.meta_ads ad
    where ad.ad_id = resolved_ad_id
      and ad.adset_id = resolved_adset_id
      and ad.campaign_id = resolved_campaign_id
  )) as hierarchy_integrity_ok,
  count(*) filter (where not exists (
    select 1 from data_pipeline.meta_ads ad
    where ad.ad_id = resolved_ad_id
      and ad.adset_id = resolved_adset_id
      and ad.campaign_id = resolved_campaign_id
  )) as hierarchy_integrity_violations
from data_pipeline.shopify_meta_attribution
where meta_attribution_state = 'EXACT_AD';

-- Also for adset: adset's campaign = resolved campaign
select
  count(*) as exact_adset_orders,
  count(*) filter (where exists (
    select 1 from data_pipeline.meta_adsets a
    where a.adset_id = resolved_adset_id
      and a.campaign_id = resolved_campaign_id
  )) as adset_hierarchy_ok
from data_pipeline.shopify_meta_attribution
where meta_attribution_state = 'EXACT_ADSET';

-- ============================================================
-- V13 — compare against Day 1 expectations (dynamic)
-- ============================================================
select
  count(*) as total_orders,
  count(*) filter (where channel_attributed) as channel_attributed_orders,
  round(100.0 * count(*) filter (where channel_attributed) / nullif(count(*),0), 2) as channel_attributed_pct,
  count(*) filter (where channel = 'UNKNOWN') as unknown_orders,
  round(100.0 * count(*) filter (where channel = 'UNKNOWN') / nullif(count(*),0), 2) as unknown_pct,
  count(*) filter (where meta_attribution_state in ('EXACT_AD','EXACT_ADSET','EXACT_CAMPAIGN')) as exact_meta_orders,
  round(100.0 * count(*) filter (where meta_attribution_state in ('EXACT_AD','EXACT_ADSET','EXACT_CAMPAIGN')) / nullif(count(*),0), 2) as exact_meta_pct,
  count(*) filter (where channel = 'DIRECT') as direct_orders,
  round(100.0 * count(*) filter (where channel = 'DIRECT') / nullif(count(*),0), 2) as direct_pct,
  count(*) filter (where channel in ('GOOGLE','KWIKENGAGE','OTHER')) as other_channel_orders,
  round(100.0 * count(*) filter (where channel in ('GOOGLE','KWIKENGAGE','OTHER')) / nullif(count(*),0), 2) as other_pct,
  count(*) filter (where channel = 'META') as meta_channel_orders,
  round(100.0 * count(*) filter (where channel = 'META') / nullif(count(*),0), 2) as meta_channel_pct
from data_pipeline.shopify_meta_attribution;

-- Window-specific (2026-08-01 to 2026-09-04, current date) for Day 1 comparison
select
  count(*) as window_total,
  count(*) filter (where meta_attribution_state in ('EXACT_AD','EXACT_ADSET','EXACT_CAMPAIGN')) as window_exact_meta,
  count(*) filter (where channel = 'DIRECT') as window_direct
from data_pipeline.shopify_meta_attribution
where created_at_shopify >= '2026-08-01'::timestamptz
  and created_at_shopify <= '2026-09-04 23:59:59+00'::timestamptz;

-- ============================================================
-- Extra: sample records per state (sanitized)
-- ============================================================
-- select shopify_order_id, created_at_shopify, utm_source_raw, utm_campaign_raw, utm_term_raw, utm_content_raw, channel, meta_attribution_state, attribution_method, resolved_campaign_id, resolved_adset_id, resolved_ad_id, adset_consistency_status, campaign_consistency_status, hierarchy_conflict, has_malformed_utm
-- from data_pipeline.shopify_meta_attribution where meta_attribution_state = 'EXACT_AD' limit 3;

-- select * from data_pipeline.shopify_meta_attribution where meta_attribution_state = 'EXACT_ADSET' limit 3;
-- select * from data_pipeline.shopify_meta_attribution where channel = 'DIRECT' limit 3;
-- select * from data_pipeline.shopify_meta_attribution where channel = 'GOOGLE' limit 3;
-- select * from data_pipeline.shopify_meta_attribution where meta_attribution_state = 'META_SOURCE_ONLY' limit 3;
-- select * from data_pipeline.shopify_meta_attribution where hierarchy_conflict = true limit 3;
-- select * from data_pipeline.shopify_meta_attribution where channel = 'UNKNOWN' limit 3;
