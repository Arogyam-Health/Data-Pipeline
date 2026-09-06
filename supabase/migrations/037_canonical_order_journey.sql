-- 037_canonical_order_journey.sql
-- Day 4 — Canonical Customer / Order Journey Mart
-- Purpose: Single analytics-ready view, one row per Shopify order, consolidating Day 1-3
-- Source: data_pipeline.shopify_order_delivery_remittance (Day 3) — do not re-join raw scans/remittance
-- Grain: ONE ROW PER shopify_order_id (COUNT(*) = COUNT(DISTINCT shopify_order_id), Day4 = Day3)
-- Design: VIEW in data_pipeline + alias in analytics, security_invoker, no duplication
-- Revenue: ordered_revenue (Shopify total) vs delivered_order_value vs remitted_amount (separate)
-- Settlement: NO_REMITTANCE_EVIDENCE not OVERDUE (no SLA), preserve raw remittance_status
-- Depends on: 035 (Day2), 036 (Day3), 022 (enrich), 025 (remittance)

create schema if not exists data_pipeline;
create schema if not exists analytics;

-- Helpful index for date filters on mart (idempotent)
create index if not exists idx_shopify_orders_created_at_shopify
  on data_pipeline.shopify_orders (created_at_shopify);
create index if not exists idx_shopify_orders_customer_id
  on data_pipeline.shopify_orders (customer_id);

create or replace view data_pipeline.mart_order_journey with (security_invoker = true) as
with base as (
  select
    d.*,
    -- Customer key from Shopify (stable, not PII)
    o.customer_id as customer_key,
    -- Timezone: preserve original timestamptz, derive IST date (Asia/Kolkata UTC+5:30)
    d.created_at_shopify as order_created_at,
    (d.created_at_shopify at time zone 'Asia/Kolkata')::date as order_date_ist,
    (d.created_at_shopify at time zone 'Asia/Kolkata')::date as order_date,
    date_trunc('week', (d.created_at_shopify at time zone 'Asia/Kolkata')::date)::date as order_week,
    date_trunc('month', (d.created_at_shopify at time zone 'Asia/Kolkata')::date)::date as order_month,
    (d.created_at_shopify at time zone 'Asia/Kolkata') as order_created_at_ist
  from data_pipeline.shopify_order_delivery_remittance d
  left join data_pipeline.shopify_orders o on o.shopify_order_id = d.shopify_order_id
),
enriched as (
  select
    b.*,
    -- Channel flags (Day2 preserved)
    (b.channel in ('META','DIRECT','GOOGLE','KWIKENGAGE','OTHER')) as is_known_channel,
    (b.channel = 'META') as is_meta_channel,
    (b.channel = 'DIRECT') as is_direct_channel,
    -- Meta flags
    (b.meta_attribution_state in ('EXACT_AD','EXACT_ADSET','EXACT_CAMPAIGN')) as has_exact_meta_attribution,
    -- Remittance evidence (safe interpretation)
    case
      when b.remittance_status = 'REMITTED' then 'REMITTED'
      when b.remittance_status = 'DELIVERED_NOT_REMITTED' then 'NO_REMITTANCE_EVIDENCE'
      when b.remittance_status = 'NOT_APPLICABLE' then 'NOT_APPLICABLE'
      when b.remittance_status = 'AMBIGUOUS' then 'AMBIGUOUS'
      else 'UNKNOWN'
    end as settlement_evidence_status,
    (b.remittance_status = 'REMITTED') as has_remittance_evidence,
    -- Canonical outcome (prefer safe NO_REMITTANCE_EVIDENCE, map Day3 order_outcome)
    case
      when b.order_outcome = 'DELIVERED_COD_NOT_REMITTED' then 'DELIVERED_COD_NO_REMITTANCE_EVIDENCE'
      else b.order_outcome
    end as canonical_order_outcome,
    -- Revenue measures (separate, no overwrite)
    (b.shopify_order_total::numeric) as ordered_revenue,
    case when b.is_delivered then (b.shopify_order_total::numeric) else 0 end as delivered_order_value,
    case when b.is_rto then (b.shopify_order_total::numeric) else 0 end as rto_order_value,
    case when b.is_cancelled then (b.shopify_order_total::numeric) else 0 end as cancelled_order_value,
    (b.remitted_amount::numeric) as remitted_amount_num,
    -- Delivery metric flags (0/1 for SUM)
    1 as order_count,
    case when b.is_shipped then 1 else 0 end as shipped_order_count,
    case when b.is_delivered then 1 else 0 end as delivered_order_count,
    case when b.is_rto then 1 else 0 end as rto_order_count,
    case when b.is_ndr then 1 else 0 end as ndr_order_count,
    case when b.is_cancelled then 1 else 0 end as cancelled_order_count,
    case when b.delivery_outcome = 'IN_TRANSIT' then 1 else 0 end as in_transit_order_count,
    -- COD specific
    (b.payment_type = 'PREPAID') as is_prepaid,
    case when b.is_delivered and b.is_cod then 1 else 0 end as delivered_cod_order_count,
    case when b.is_delivered and not b.is_cod and b.payment_type = 'PREPAID' then 1 else 0 end as delivered_prepaid_order_count,
    case when b.is_delivered and b.is_cod and b.remittance_status = 'REMITTED' then 1 else 0 end as delivered_cod_with_remittance_count,
    case when b.is_delivered and b.is_cod and b.remittance_status = 'DELIVERED_NOT_REMITTED' then 1 else 0 end as delivered_cod_without_remittance_evidence_count,
    -- Journey stage (funnel)
    case
      when b.order_outcome = 'AMBIGUOUS' then 'AMBIGUOUS'
      when b.shiprocket_match_status = 'AMBIGUOUS' then 'AMBIGUOUS'
      when b.delivery_outcome = 'RTO' then 'RTO'
      when b.delivery_outcome = 'CANCELLED' then 'CANCELLED'
      when b.delivery_outcome = 'NDR_OPEN' then 'NDR'
      when b.is_delivered and b.is_cod and b.remittance_status = 'REMITTED' then 'SETTLED'
      when b.is_delivered then 'DELIVERED'
      when b.delivery_outcome = 'IN_TRANSIT' then 'IN_TRANSIT'
      when b.shiprocket_match_status != 'MATCHED' then 'SHIPMENT_PENDING'
      else 'ORDER_CREATED'
    end as journey_stage,
    -- Time-to-event (only when both timestamps present and valid)
    case when b.delivered_at is not null and b.shipped_at is not null and b.delivered_at >= b.shipped_at
      then extract(epoch from (b.delivered_at - b.shipped_at)) / 86400.0 else null end as days_ship_to_delivery,
    case when b.shipped_at is not null and b.created_at_shopify is not null and b.shipped_at >= b.created_at_shopify
      then extract(epoch from (b.shipped_at - b.created_at_shopify)) / 86400.0 else null end as days_order_to_ship,
    case when b.delivered_at is not null and b.created_at_shopify is not null and b.delivered_at >= b.created_at_shopify
      then extract(epoch from (b.delivered_at - b.created_at_shopify)) / 86400.0 else null end as days_order_to_delivery,
    (b.remittance_status = 'REMITTED') as has_complete_delivery_journey,
    case
      when (b.payment_type = 'PREPAID' and b.is_delivered) or (b.is_cod and b.is_delivered and b.remittance_status = 'REMITTED') then true
      else false
    end as has_complete_financial_journey
  from base b
)
select
  -- Identity
  shopify_order_id,
  order_name,
  order_number,
  created_at_shopify,
  order_created_at,
  order_created_at_ist,
  order_date,
  order_date_ist,
  order_week,
  order_month,
  processed_at,
  customer_key,
  -- Acquisition (Day2 preserved)
  channel,
  channel_attributed,
  channel_source_raw,
  channel_source_normalized,
  is_meta_source,
  is_known_channel,
  is_meta_channel,
  is_direct_channel,
  meta_attribution_state,
  day2_attribution_state,
  day2_attribution_method as attribution_method,
  resolved_campaign_id,
  resolved_campaign_name,
  resolved_adset_id,
  resolved_adset_name,
  resolved_ad_id,
  resolved_ad_name,
  has_exact_meta_attribution,
  adset_consistency_status,
  campaign_consistency_status,
  hierarchy_conflict,
  has_malformed_utm,
  day2_tracking_quality,
  journey_data_quality,
  -- Commerce
  currency,
  shopify_order_total,
  ordered_revenue,
  financial_status,
  shopify_financial_status,
  fulfillment_status,
  payment_type,
  is_cod,
  is_prepaid,
  shopify_payment_gateway_names,
  -- Shipment
  shiprocket_match_status,
  shiprocket_match_method,
  shiprocket_match_confidence,
  shiprocket_sr_order_id,
  awb,
  shipment_id,
  courier_name,
  channel_id,
  shiprocket_status_raw,
  shiprocket_status_id,
  shiprocket_current_status_raw,
  shiprocket_current_status_id,
  shiprocket_order_status,
  shiprocket_order_status_code,
  shiprocket_status_bucket,
  delivery_outcome,
  canonical_order_outcome,
  is_shipped,
  is_delivered,
  is_rto,
  is_ndr,
  is_cancelled,
  shipped_at,
  delivered_at,
  pickup_scheduled_at,
  shiprocket_tracking_url,
  undelivered_reason,
  delivery_attempt_count,
  -- Analytics measures
  order_count,
  shipped_order_count,
  delivered_order_count,
  rto_order_count,
  ndr_order_count,
  cancelled_order_count,
  in_transit_order_count,
  delivered_cod_order_count,
  delivered_prepaid_order_count,
  delivered_order_value,
  rto_order_value,
  cancelled_order_value,
  -- Settlement
  remittance_match_status,
  remittance_match_method,
  sr_remittance_match_status_raw,
  remittance_status,
  settlement_evidence_status,
  has_remittance_evidence,
  remittance_row_count,
  remitted_amount,
  remitted_amount_num,
  remittance_order_value_total,
  first_remitted_at,
  latest_remitted_at,
  crf_id,
  utr,
  utr_list,
  utr_count,
  crf_count,
  delivered_cod_with_remittance_count,
  delivered_cod_without_remittance_evidence_count,
  is_delivered_cod_not_remitted,
  has_shiprocket_match,
  has_remittance_match,
  has_complete_delivery_journey,
  has_complete_financial_journey,
  -- Journey
  journey_stage,
  -- Time
  days_order_to_ship,
  days_ship_to_delivery,
  days_order_to_delivery
from enriched;

grant select on data_pipeline.mart_order_journey to service_role, authenticated;
grant usage on schema data_pipeline to service_role, authenticated;

create or replace view analytics.mart_order_journey with (security_invoker = true) as
select * from data_pipeline.mart_order_journey;

grant select on analytics.mart_order_journey to service_role, authenticated;
grant usage on schema analytics to service_role, authenticated;

comment on view data_pipeline.mart_order_journey is
'Day 4 canonical order journey mart: one row per Shopify order, Day 2/3 consolidated, revenue/delivery/settlement standardized for Day 5 campaign profitability. See docs/DAY4_CANONICAL_ORDER_JOURNEY.md';
