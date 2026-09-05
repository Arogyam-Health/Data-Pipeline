-- 036_shopify_order_delivery_remittance.sql
-- Day 3 — Shopify → Shiprocket → CRF/UTR Remittance — Order-level delivery + settlement layer
-- Purpose: One row per Shopify order, extending Day 2 (data_pipeline.shopify_meta_attribution)
--          with deterministic Shiprocket shipment/outcome + remittance settlement.
-- Depends on: 022_shiprocket_enrichment (shopify mapping), 025_shiprocket_remittance (CRF tables),
--             027_shiprocket_order_360 (explorer), 035_shopify_meta_attribution_layer (Day 2).
-- Grain: ONE ROW PER SHOPIFY ORDER (COUNT(*) = COUNT(DISTINCT shopify_order_id)).
--        Shiprocket one-to-many (5 shopify orders have 2 sr_orders) → AMBIGUOUS, not LIMIT 1.
--        Remittance one-to-many (one UTR → 44 AWBs, one AWB → 3 rows) → aggregated before join.
-- Design: VIEW in data_pipeline (dynamic, not materialized) + alias in analytics.
--         Reuses existing enrich_shiprocket_order logic (8-digit order_number/order_name).
--         Reuses existing matchRemittanceOrderRow priority: AWB > order_id > shopify_format.
-- Portable: no project IDs, no secrets.

create schema if not exists data_pipeline;
create schema if not exists analytics;

-- Helpful indexes for Day 3 joins (idempotent)
create index if not exists idx_shiprocket_enrichment_shopify_identifier
  on data_pipeline.shiprocket_order_enrichment (shopify_order_identifier);
create index if not exists idx_shiprocket_remittance_orders_awb
  on data_pipeline.shiprocket_remittance_orders (awb);
create index if not exists idx_shiprocket_remittance_orders_order_id
  on data_pipeline.shiprocket_remittance_orders (order_id);
create index if not exists idx_shiprocket_remittance_orders_matched_sr
  on data_pipeline.shiprocket_remittance_orders (matched_sr_order_id);
create index if not exists idx_shiprocket_orders_order_id
  on data_pipeline.shiprocket_orders (order_id);
create index if not exists idx_shiprocket_orders_awb
  on data_pipeline.shiprocket_orders (awb);

-- ============================================================
-- Main Day 3 view: data_pipeline.shopify_order_delivery_remittance
-- ============================================================
create or replace view data_pipeline.shopify_order_delivery_remittance as
with
-- 1. Day 2 attribution as base (already one-row-per-order)
day2 as (
  select * from data_pipeline.shopify_meta_attribution
),
-- 2. Canonical Shiprocket order layer (one row per sr_order_id, deduped)
--    Use shiprocket_orders + enrichment, with status_bucket from 027
shiprocket_canonical as (
  select
    o.sr_order_id,
    o.order_id,
    o.awb,
    o.shipment_id,
    o.courier_name,
    o.channel_id,
    o.shipment_status,
    o.shipment_status_id,
    o.current_status,
    o.current_status_id,
    o.order_status,
    o.order_status_code,
    o.payment_method as shiprocket_payment_method,
    o.payment_status,
    o.order_total as shiprocket_order_total,
    o.delivered_date,
    o.awb_assigned_date,
    o.pickup_scheduled_date,
    o.undelivered_reason,
    o.undelivered_reason_code,
    o.delivery_attempt_count,
    o.etd,
    o.current_ts,
    o.tracking_url,
    o.order_date,
    o.created_at_sr,
    e.shopify_order_identifier,
    e.order_id_shopify_format,
    e.customer_name_shopify,
    e.customer_phone_shopify,
    -- Derived buckets (from 027_shiprocket_order_360 status_bucket / payment_bucket)
    case
      when coalesce(o.shipment_status,'') ilike '%rto%' or coalesce(o.current_status,'') ilike '%rto%' then 'rto'
      when coalesce(o.shipment_status,'') ilike '%ndr%'  or coalesce(o.current_status,'') ilike '%ndr%'  then 'ndr'
      when coalesce(o.shipment_status,'') ilike '%out for delivery%' or coalesce(o.current_status,'') ilike '%out for delivery%' then 'out_for_delivery'
      when coalesce(o.shipment_status,'') ilike '%delivered%' or coalesce(o.current_status,'') ilike '%delivered%' then 'delivered'
      when coalesce(o.shipment_status,'') ilike '%transit%' or coalesce(o.current_status,'') ilike '%transit%' then 'in_transit'
      else 'other'
    end as status_bucket,
    -- Shiprocket payment_method is null in current data; will fallback to Shopify gateway in final layer
    case
      when coalesce(o.payment_method,'') ilike '%cod%' then 'COD'
      when coalesce(o.payment_method,'') = '' then ''
      else 'Prepaid'
    end as shiprocket_payment_bucket
  from data_pipeline.shiprocket_orders o
  left join data_pipeline.shiprocket_order_enrichment e on e.sr_order_id = o.sr_order_id
),
-- 3. Shopify → Shiprocket mapping with ambiguity detection
--    One Shopify order may have 0, 1, or 2 Shiprocket orders (5 cases with 2)
shopify_shiprocket_map as (
  select
    d.shopify_order_id,
    count(s.sr_order_id) as sr_count,
    -- Deterministic pick: most recent Shiprocket order by created_at_sr / last_webhook_sync_at if not ambiguous
    (array_agg(s.sr_order_id order by coalesce(s.awb_assigned_date,'') desc, s.sr_order_id desc))[1] as picked_sr_order_id,
    case
      when count(s.sr_order_id) = 0 then 'NOT_MATCHED'
      when count(s.sr_order_id) = 1 then 'MATCHED'
      else 'AMBIGUOUS'
    end as shiprocket_match_status,
    case
      when count(s.sr_order_id) = 0 then null
      when count(s.sr_order_id) = 1 then 'EXISTING_SHOPIFY_ORDER_ID'
      else 'AMBIGUOUS_MULTIPLE_SR'
    end as shiprocket_match_method,
    case
      when count(s.sr_order_id) = 1 then 'HIGH'
      when count(s.sr_order_id) = 0 then 'NONE'
      else 'LOW'
    end as shiprocket_match_confidence
  from day2 d
  left join shiprocket_canonical s on s.shopify_order_identifier = d.shopify_order_id
  group by d.shopify_order_id
),
-- 4. Picked Shiprocket row (only when MATCHED, else null to avoid forcing)
picked_shiprocket as (
  select
    m.shopify_order_id,
    m.shiprocket_match_status,
    m.shiprocket_match_method,
    m.shiprocket_match_confidence,
    s.*
  from shopify_shiprocket_map m
  left join shiprocket_canonical s
    on s.sr_order_id = m.picked_sr_order_id
    and m.shiprocket_match_status = 'MATCHED'
),
-- 5. Remittance order-level summary (aggregate per sr_order_id before Shopify join)
--    Grain: shiprocket_remittance_orders has (crf_id, awb, order_id) PK, one UTR → 44 AWBs.
--    Aggregate to one row per matched_sr_order_id.
remittance_per_sr as (
  select
    matched_sr_order_id,
    count(*)::int as remittance_row_count,
    count(distinct crf_id)::int as crf_count,
    count(distinct utr) filter (where utr is not null and btrim(utr) <> '')::int as utr_count,
    array_agg(distinct utr) filter (where utr is not null and btrim(utr) <> '') as utr_list,
    coalesce(sum(total_adjusted_amt::numeric), 0) as remitted_amount_total,
    coalesce(sum(order_value::numeric), 0) as order_value_total,
    min(remittance_date) as first_remitted_at,
    max(remittance_date) as latest_remitted_at,
    (array_agg(crf_id order by remittance_date desc nulls last, updated_at desc))[1] as latest_crf_id,
    (array_agg(utr order by remittance_date desc nulls last, updated_at desc))[1] as latest_utr,
    (array_agg(remittance_date order by remittance_date desc nulls last))[1] as latest_remittance_date,
    -- Match status for this SR: if any row is matched, consider matched (should be all same)
    case
      when count(*) filter (where match_status = 'matched') > 0 and count(*) filter (where match_status = 'ambiguous') = 0 then 'MATCHED'
      when count(*) filter (where match_status = 'ambiguous') > 0 then 'AMBIGUOUS'
      else 'NOT_MATCHED'
    end as sr_remittance_match_status
  from data_pipeline.shiprocket_remittance_orders
  where matched_sr_order_id is not null
  group by matched_sr_order_id
),
-- 6. Join Day2 + Shiprocket + Remittance
joined as (
  select
    d.*,
    -- Shiprocket matching
    ps.shiprocket_match_status,
    ps.shiprocket_match_method,
    ps.shiprocket_match_confidence,
    ps.sr_order_id as shiprocket_sr_order_id,
    ps.awb as shiprocket_awb,
    ps.shipment_id as shiprocket_shipment_id,
    ps.courier_name as shiprocket_courier_name,
    ps.channel_id as shiprocket_channel_id,
    ps.shipment_status as shiprocket_status_raw,
    ps.shipment_status_id as shiprocket_status_id,
    ps.current_status as shiprocket_current_status_raw,
    ps.current_status_id as shiprocket_current_status_id,
    ps.order_status as shiprocket_order_status,
    ps.order_status_code as shiprocket_order_status_code,
    ps.shiprocket_payment_method,
    ps.shiprocket_payment_bucket,
    ps.status_bucket as shiprocket_status_bucket,
    ps.delivered_date as shiprocket_delivered_date_raw,
    ps.awb_assigned_date as shiprocket_awb_assigned_date_raw,
    ps.pickup_scheduled_date as shiprocket_pickup_scheduled_date_raw,
    ps.tracking_url as shiprocket_tracking_url,
    ps.order_date as shiprocket_order_date_raw,
    ps.undelivered_reason,
    ps.delivery_attempt_count,
    ps.etd,
    ps.current_ts,
    -- Shopify payment for COD determination (authoritative, since shiprocket payment_method is null)
    -- Use shopify_orders.payment_gateway_names via Day2? Day2 view does not expose it, so join directly
    o.payment_gateway_names as shopify_payment_gateway_names,
    o.financial_status as shopify_financial_status,
    o.fulfillment_status as shopify_fulfillment_status,
    -- Remittance (via SR)
    rs.remittance_row_count,
    rs.crf_count,
    rs.utr_count,
    rs.utr_list,
    rs.remitted_amount_total,
    rs.order_value_total,
    rs.first_remitted_at,
    rs.latest_remitted_at,
    rs.latest_crf_id,
    rs.latest_utr,
    rs.latest_remittance_date,
    rs.sr_remittance_match_status
  from day2 d
  left join picked_shiprocket ps on ps.shopify_order_id = d.shopify_order_id
  left join data_pipeline.shopify_orders o on o.shopify_order_id = d.shopify_order_id
  left join remittance_per_sr rs on rs.matched_sr_order_id = ps.sr_order_id
),
-- 7. Add payment_type / is_cod and delivery_outcome before using them in remittance logic
with_payment as (
  select
    j.*,
    case
      when exists (select 1 from unnest(coalesce(j.shopify_payment_gateway_names, array[]::text[])) g where lower(g) like '%cod%' or lower(g) like '%cash%') then 'COD'
      when j.shopify_payment_gateway_names is not null and array_length(j.shopify_payment_gateway_names,1) > 0 then 'PREPAID'
      when j.shiprocket_payment_bucket = 'COD' then 'COD'
      when j.shiprocket_payment_bucket = 'Prepaid' then 'PREPAID'
      else 'UNKNOWN'
    end as payment_type,
    exists (select 1 from unnest(coalesce(j.shopify_payment_gateway_names, array[]::text[])) g where lower(g) like '%cod%' or lower(g) like '%cash%') as is_cod
  from joined j
),
with_delivery as (
  select
    p.*,
    case
      when p.shiprocket_match_status != 'MATCHED' then 'NOT_SHIPPED'
      when p.shiprocket_status_raw ilike '%cancelled%' or p.shiprocket_current_status_raw ilike '%canceled%' or p.shiprocket_order_status = 'new' then 'CANCELLED'
      when p.shiprocket_status_raw ilike '%rto delivered%' or p.shiprocket_current_status_raw ilike '%rto delivered%' then 'RTO'
      when p.shiprocket_status_raw ilike '%rto%' or p.shiprocket_current_status_raw ilike '%rto%' then 'RTO'
      when p.shiprocket_status_raw ilike '%delivered%' or p.shiprocket_current_status_raw ilike '%delivered%' then 'DELIVERED'
      when p.shiprocket_status_raw ilike '%ndr%' or p.shiprocket_current_status_raw ilike '%ndr%' or p.shiprocket_status_raw = 'UNDELIVERED' or p.shiprocket_current_status_raw = 'UNDELIVERED' then 'NDR_OPEN'
      when p.shiprocket_status_bucket = 'out_for_delivery' then 'IN_TRANSIT'
      when p.shiprocket_status_bucket in ('in_transit','other') and p.shiprocket_awb is not null then 'IN_TRANSIT'
      when p.shiprocket_awb is not null then 'IN_TRANSIT'
      else 'UNKNOWN'
    end as delivery_outcome,
    (p.shiprocket_match_status = 'MATCHED' and p.shiprocket_awb is not null) as is_shipped,
    ((p.shiprocket_status_raw ilike '%delivered%' or p.shiprocket_current_status_raw ilike '%delivered%') and p.shiprocket_match_status = 'MATCHED' and not (p.shiprocket_status_raw ilike '%rto delivered%')) as is_delivered,
    (p.shiprocket_status_raw ilike '%rto%' or p.shiprocket_current_status_raw ilike '%rto%') as is_rto,
    (p.shiprocket_status_raw ilike '%ndr%' or p.shiprocket_current_status_raw ilike '%ndr%' or p.shiprocket_status_raw = 'UNDELIVERED') as is_ndr,
    (p.shiprocket_status_raw ilike '%cancelled%' or p.shiprocket_current_status_raw ilike '%canceled%') as is_cancelled,
    case when p.shiprocket_delivered_date_raw ~ '^\d{4}-\d{2}-\d{2}' then p.shiprocket_delivered_date_raw::timestamptz else null end as delivered_at,
    case when p.shiprocket_awb_assigned_date_raw ~ '^\d{4}-\d{2}-\d{2}' then p.shiprocket_awb_assigned_date_raw::timestamptz else null end as shipped_at,
    case when p.shiprocket_pickup_scheduled_date_raw ~ '^\d{4}-\d{2}-\d{2}' then p.shiprocket_pickup_scheduled_date_raw::timestamptz else null end as pickup_scheduled_at
  from with_payment p
)
select
  -- Shopify / acquisition (from Day2, preserved unchanged)
  shopify_order_id,
  order_name,
  order_number,
  created_at_shopify,
  processed_at,
  financial_status,
  fulfillment_status,
  total_price as shopify_order_total,
  currency,
  -- Raw UTM (Day2)
  utm_source_raw,
  utm_medium_raw,
  utm_campaign_raw,
  utm_term_raw,
  utm_content_raw,
  utm_source_normalized,
  utm_medium_normalized,
  utm_campaign_normalized,
  utm_term_normalized,
  utm_content_normalized,
  -- Channel (Day2)
  channel,
  channel_attributed,
  channel_source_raw,
  channel_source_normalized,
  is_meta_source,
  -- Meta resolved (Day2)
  matched_campaign_id,
  matched_adset_id,
  matched_ad_id,
  resolved_campaign_id,
  resolved_campaign_name,
  resolved_adset_id,
  resolved_adset_name,
  resolved_ad_id,
  resolved_ad_name,
  meta_attribution_state,
  attribution_state as day2_attribution_state,
  attribution_method as day2_attribution_method,
  adset_consistency_status,
  campaign_consistency_status,
  hierarchy_conflict,
  has_malformed_utm,
  malformed_utm_fields,
  tracking_quality as day2_tracking_quality,
  -- Shiprocket matching
  shiprocket_match_status,
  shiprocket_match_method,
  shiprocket_match_confidence,
  shiprocket_sr_order_id,
  shiprocket_awb as awb,
  shiprocket_shipment_id as shipment_id,
  shiprocket_courier_name as courier_name,
  shiprocket_channel_id as channel_id,
  -- Shipment outcome raw
  shiprocket_status_raw,
  shiprocket_status_id,
  shiprocket_current_status_raw,
  shiprocket_current_status_id,
  shiprocket_order_status,
  shiprocket_order_status_code,
  shiprocket_status_bucket,
  delivery_outcome,
  is_shipped,
  is_delivered,
  is_rto,
  is_ndr,
  is_cancelled,
  delivered_at,
  shipped_at,
  pickup_scheduled_at,
  shiprocket_tracking_url,
  shiprocket_order_date_raw,
  undelivered_reason,
  delivery_attempt_count,
  payment_type,
  is_cod,
  shopify_payment_gateway_names,
  shopify_financial_status,
  -- Remittance (order-level, aggregated)
  case
    when is_cod = false then 'NOT_APPLICABLE'
    when delivery_outcome != 'DELIVERED' then 'NOT_APPLICABLE'
    when sr_remittance_match_status = 'MATCHED' then 'MATCHED'
    when sr_remittance_match_status = 'AMBIGUOUS' then 'AMBIGUOUS'
    when shiprocket_match_status != 'MATCHED' then 'NOT_APPLICABLE'
    else 'NOT_MATCHED'
  end as remittance_match_status,
  case
    when is_cod = false then null
    when delivery_outcome != 'DELIVERED' then null
    when sr_remittance_match_status = 'MATCHED' then 'AWB'
    when shiprocket_match_status = 'MATCHED' and shiprocket_awb is not null then 'AWB'
    else null
  end as remittance_match_method,
  coalesce(sr_remittance_match_status, 'NOT_APPLICABLE') as sr_remittance_match_status_raw,
  -- Remittance status (normalized business)
  case
    when is_cod = false then 'NOT_APPLICABLE'
    when delivery_outcome != 'DELIVERED' then 'NOT_APPLICABLE'
    when sr_remittance_match_status = 'AMBIGUOUS' then 'AMBIGUOUS'
    when remittance_row_count is not null and remittance_row_count > 0 then 'REMITTED'
    when delivery_outcome = 'DELIVERED' and is_cod then 'DELIVERED_NOT_REMITTED'
    else 'UNKNOWN'
  end as remittance_status,
  coalesce(remittance_row_count,0) as remittance_row_count,
  coalesce(remitted_amount_total,0) as remitted_amount,
  coalesce(order_value_total,0) as remittance_order_value_total,
  first_remitted_at,
  latest_remitted_at,
  latest_crf_id as crf_id,
  latest_utr as utr,
  utr_list,
  utr_count,
  crf_count,
  -- Critical metric
  (delivery_outcome = 'DELIVERED' and is_cod and coalesce(remittance_row_count,0) = 0) as is_delivered_cod_not_remitted,
  -- Quality / diagnostics
  (shiprocket_match_status = 'MATCHED') as has_shiprocket_match,
  (coalesce(remittance_row_count,0) > 0) as has_remittance_match,
  case
    when shiprocket_match_status = 'AMBIGUOUS' or sr_remittance_match_status = 'AMBIGUOUS' then 'AMBIGUOUS'
    when has_malformed_utm then 'MALFORMED_UTM'
    when hierarchy_conflict then 'HIERARCHY_CONFLICT'
    when shiprocket_match_status = 'NOT_MATCHED' then 'NO_SHIPMENT'
    else 'OK'
  end as journey_data_quality,
  -- End-to-end order outcome
  case
    when shiprocket_match_status = 'AMBIGUOUS' or sr_remittance_match_status = 'AMBIGUOUS' then 'AMBIGUOUS'
    when shiprocket_match_status != 'MATCHED' then 'NOT_SHIPPED'
    when shiprocket_status_raw ilike '%rto%' or shiprocket_current_status_raw ilike '%rto%' then 'RTO'
    when shiprocket_status_raw ilike '%delivered%' or shiprocket_current_status_raw ilike '%delivered%' then
      case
        when is_cod and coalesce(remittance_row_count,0) > 0 then 'DELIVERED_COD_REMITTED'
        when is_cod then 'DELIVERED_COD_NOT_REMITTED'
        else 'DELIVERED_PREPAID'
      end
    when shiprocket_status_raw ilike '%cancelled%' or shiprocket_current_status_raw ilike '%canceled%' then 'CANCELLED'
    when shiprocket_status_raw ilike '%ndr%' or shiprocket_current_status_raw ilike '%ndr%' then 'NDR_OPEN'
    when shiprocket_match_status = 'MATCHED' then 'IN_TRANSIT'
    else 'UNKNOWN'
  end as order_outcome
from with_delivery;

grant select on data_pipeline.shopify_order_delivery_remittance to service_role, authenticated;
grant usage on schema data_pipeline to service_role, authenticated;

create or replace view analytics.shopify_order_delivery_remittance as
select * from data_pipeline.shopify_order_delivery_remittance;

grant select on analytics.shopify_order_delivery_remittance to service_role, authenticated;
grant usage on schema analytics to service_role, authenticated;

comment on view data_pipeline.shopify_order_delivery_remittance is
'Day 3 canonical order-level journey: Day 2 attribution (one-row-per-order) + Shiprocket shipment/outcome (via 8-digit order_number) + CRF/UTR remittance (AWB>order_id>shopify_format). See docs/DAY3_SHOPIFY_SHIPROCKET_REMITTANCE.md';
