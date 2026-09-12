-- 052 — Align Journey delivered-date classification with the application resolver.
-- Recreates affected current-business views explicitly. UNDELIVERED must
-- never match DELIVERED by substring; scan evidence remains exact and explicit.

create or replace view data_pipeline.shiprocket_order_explorer as
select
  o.sr_order_id,
  o.unique_key,
  o.shipment_status_id,
  o.shipment_status,
  o.scans1_status,
  o.scans1_sr_status_label,
  o.scans1_sr_status,
  o.scans1_location,
  o.scans1_date,
  o.scans1_activity,
  o.scans0_status,
  o.scans0_sr_status_label,
  o.scans0_sr_status,
  o.scans0_location,
  o.scans0_date,
  o.scans0_activity,
  o.order_id,
  o.is_return,
  o.etd,
  o.current_ts,
  o.current_status_id,
  o.current_status,
  o.courier_name,
  o.channel_id,
  o.awb,
  o.order_date,
  o.created_at_sr,
  o.customer_name as shiprocket_customer_name,
  o.customer_email,
  o.customer_phone as shiprocket_customer_phone,
  o.pickup_location,
  o.payment_status,
  o.payment_method,
  o.order_total,
  o.tax,
  o.order_status,
  o.order_status_code,
  o.shipment_id,
  o.tracking_url,
  o.delivered_date,
  o.products,
  o.last_local_api_sync_at,
  o.last_webhook_sync_at,
  o.return_awb_code,
  o.awb_assigned_date,
  o.pickup_scheduled_date,
  o.pickup_exception_reason,
  o.undelivered_reason,
  o.undelivered_reason_code,
  o.pick_exception_reason_code,
  o.delivery_attempt_count,
  o.pickup_attempt_count,
  o.qc_image,
  o.qc_failure_reason,
  o.pod_status,
  o.pod,
  o.shipping_method,
  o.created_at,
  o.updated_at,
  coalesce(
    nullif(e.order_id_shopify_format, ''),
    nullif(data_pipeline.extract_shopify_order_id_format(o.order_id), '')
  ) as order_id_shopify_format,
  e.shopify_order_identifier,
  e.customer_name_shopify,
  e.customer_phone_shopify,
  coalesce(
    nullif(e.coach, ''),
    case
      when coalesce(btrim(o.order_id), '') <> '' then 'Misba'
      else null
    end
  ) as coach,
  e.last_enriched_at,
  o.billing_name,
  o.billing_email,
  o.billing_phone,
  o.source_date,
  case
    when coalesce(o.shipment_status, '') ilike '%rto%'
      or coalesce(o.current_status, '') ilike '%rto%' then 'rto'
    when coalesce(o.shipment_status, '') ilike '%ndr%'
      or coalesce(o.current_status, '') ilike '%ndr%' then 'ndr'
    when coalesce(o.shipment_status, '') ilike '%out for delivery%'
      or coalesce(o.current_status, '') ilike '%out for delivery%' then 'out_for_delivery'
    when upper(trim(coalesce(o.shipment_status, ''))) = 'DELIVERED'
      or upper(trim(coalesce(o.current_status, ''))) = 'DELIVERED' then 'delivered'
    when coalesce(o.shipment_status, '') ilike '%transit%'
      or coalesce(o.current_status, '') ilike '%transit%' then 'in_transit'
    else 'other'
  end as status_bucket,
  case
    when coalesce(o.payment_method, '') ilike '%cod%' then 'COD'
    when coalesce(o.payment_method, '') = '' then ''
    else 'Prepaid'
  end as payment_bucket,
  nullif(regexp_replace(coalesce(o.order_total, ''), '[^0-9.-]', '', 'g'), '')::numeric as order_total_num,
  case
    when coalesce(o.scans1_status, o.scans0_status, o.scan_status, '') <> '' then true
    else false
  end as has_scan_activity,
  (o.last_local_api_sync_at is not null) as api_enriched,
  (e.shopify_order_identifier is not null) as shopify_matched,
  (o.raw_payload is not null) as has_raw_payload,
  rs.remittance_count,
  rs.latest_crf_id,
  rs.latest_utr,
  rs.latest_remittance_date,
  rs.latest_remittance_status,
  rs.latest_remittance_type,
  rs.latest_remittance_method,
  rs.latest_order_settlement_value,
  rs.latest_total_adjusted_amt,
  rs.latest_channel_name,
  rs.latest_linked_crf_ids,
  rs.latest_cod_available,
  rs.latest_standard_cod_available,
  rs.latest_instant_cod_available,
  rs.latest_early_cod_available,
  rs.latest_freight_charges_from_cod,
  rs.latest_rto_reversal_amount,
  rs.latest_early_cod_charges,
  rs.latest_instant_cod_charges,
  rs.latest_remittance_amount,
  rs.latest_adjusted_amount,
  rs.latest_remarks,
  case
    when coalesce(rs.matched_count, 0) > 0 then 'matched'
    when coalesce(rs.ambiguous_count, 0) > 0 then 'ambiguous'
    else 'unmatched'
  end as remittance_match_status,
  -- Pabbly state (latest delivery record)
  p.status                                    as pabbly_status,
  p.attempt_count                             as pabbly_attempt_count,
  p.response_code                             as pabbly_response_code,
  p.first_attempt_at                          as pabbly_first_attempt_at,
  p.last_attempt_at                           as pabbly_last_attempt_at,
  p.sent_at                                   as pabbly_sent_at,
  p.last_error                                as pabbly_last_error,
  p.next_attempt_at                           as pabbly_next_attempt_at,
  p.final_failure_at                          as pabbly_final_failure_at,
  coalesce(pc.total_count, 0)                 as pabbly_delivery_count,
  coalesce(pc.sent_count, 0)                  as pabbly_sent_count,
  coalesce(pc.failed_count, 0)                as pabbly_failed_count
from data_pipeline.shiprocket_orders o
left join data_pipeline.shiprocket_order_enrichment e
  on e.sr_order_id = o.sr_order_id
left join lateral (
  select
    count(*)::int as remittance_count,
    count(*) filter (where ro.match_status = 'matched')::int as matched_count,
    count(*) filter (where ro.match_status = 'ambiguous')::int as ambiguous_count,
    (array_agg(ro.crf_id order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_crf_id,
    (array_agg(ro.utr order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_utr,
    (array_agg(ro.remittance_date order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_remittance_date,
    (array_agg(r.status order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_remittance_status,
    (array_agg(ro.remittance_type order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_remittance_type,
    (array_agg(r.remittance_method order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_remittance_method,
    (array_agg(ro.order_value order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_order_settlement_value,
    (array_agg(ro.total_adjusted_amt order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_total_adjusted_amt,
    (array_agg(ro.channel_name order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_channel_name,
    (array_agg(ro.linked_crf_ids order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_linked_crf_ids,
    (array_agg(r.cod_available order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_cod_available,
    (array_agg(r.standard_cod_available order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_standard_cod_available,
    (array_agg(r.instant_cod_available order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_instant_cod_available,
    (array_agg(r.early_cod_available order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_early_cod_available,
    (array_agg(r.freight_charges_from_cod order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_freight_charges_from_cod,
    (array_agg(r.rto_reversal_amount order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_rto_reversal_amount,
    (array_agg(r.early_cod_charges order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_early_cod_charges,
    (array_agg(r.instant_cod_charges order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_instant_cod_charges,
    (array_agg(r.remittance_amount order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_remittance_amount,
    (array_agg(r.adjusted_amount order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_adjusted_amount,
    (array_agg(r.remarks order by ro.remittance_date desc nulls last, ro.updated_at desc))[1] as latest_remarks
  from data_pipeline.shiprocket_remittance_orders ro
  left join data_pipeline.shiprocket_remittances r on r.crf_id = ro.crf_id
  where ro.matched_sr_order_id = o.sr_order_id
) rs on true
left join lateral (
  select *
  from data_pipeline.shiprocket_pabbly_deliveries d
  where d.sr_order_id = o.sr_order_id
  order by d.created_at desc, d.id desc
  limit 1
) p on true
left join lateral (
  select
    count(*)                                    as total_count,
    count(*) filter (where status = 'sent')     as sent_count,
    count(*) filter (where status = 'failed')   as failed_count
  from data_pipeline.shiprocket_pabbly_deliveries d2
  where d2.sr_order_id = o.sr_order_id
) pc on true;


grant select on data_pipeline.shiprocket_order_explorer to service_role;

-- 052 — Normalize delivered dates in current-business Journey views.
-- Apply only after 049A and after the application reads the effective view.
-- This file contains explicit definitions based on the validated post-048 SQL;
-- it does not inspect or rewrite target-database definitions dynamically.

create or replace view data_pipeline.shopify_order_delivery_remittance with (security_invoker = true) as
with
-- 1. Day 2 attribution as base (already one-row-per-order)
day2 as (
  select * from data_pipeline.shopify_meta_attribution
),
scan_evidence as (
  select
    s.sr_order_id,
    max(s.scan_date) filter (where
      coalesce(s.sr_status, '') = '7'
      or upper(coalesce(s.sr_status_label, '')) = 'DELIVERED'
      or upper(trim(coalesce(s.status, ''))) = '000-T-DL'
      or upper(trim(coalesce(s.activity, ''))) = 'SHIPMENT DELIVERED'
    ) as forward_delivery_scan_date,
    bool_or(
      coalesce(s.sr_status, '') = '7'
      or upper(coalesce(s.sr_status_label, '')) = 'DELIVERED'
      or upper(trim(coalesce(s.status, ''))) = '000-T-DL'
      or upper(trim(coalesce(s.activity, ''))) = 'SHIPMENT DELIVERED'
    ) as has_forward_delivery_scan,
    (array_agg(
      case when (
        upper(coalesce(s.status, '')) like '%RTO%'
        or upper(coalesce(s.sr_status_label, '')) like '%RTO%'
        or upper(coalesce(s.activity, '')) like '%RTO%'
        or upper(coalesce(s.activity, '')) like '%RETURN TO SELLER%'
      ) then true else false end
      order by s.scan_date desc nulls last, s.scan_index desc
    ))[1] as latest_scan_is_rto
  from data_pipeline.shiprocket_scans s
  group by s.sr_order_id
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
    o.is_return,
    o.return_awb_code,
    o.order_date,
    o.created_at_sr,
    e.shopify_order_identifier,
    e.order_id_shopify_format,
    e.customer_name_shopify,
    e.customer_phone_shopify,
    se.forward_delivery_scan_date,
    se.has_forward_delivery_scan,
    coalesce(se.latest_scan_is_rto, false) as latest_scan_is_rto,
    -- Derived buckets (from 027, fixed: UNDELIVERED must not match DELIVERED)
    case
      when coalesce(o.shipment_status,'') ilike '%rto%' or coalesce(o.current_status,'') ilike '%rto%' then 'rto'
      when coalesce(o.shipment_status,'') ilike '%ndr%' or coalesce(o.current_status,'') ilike '%ndr%' or lower(coalesce(o.shipment_status,'')) = 'undelivered' or lower(coalesce(o.current_status,'')) = 'undelivered' then 'ndr'
      when coalesce(o.shipment_status,'') ilike '%out for delivery%' or coalesce(o.current_status,'') ilike '%out for delivery%' then 'out_for_delivery'
      when lower(coalesce(o.shipment_status,'')) = 'delivered' or lower(coalesce(o.current_status,'')) = 'delivered' or o.shipment_status_id = '7' or o.current_status_id = '7' then 'delivered'
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
  left join scan_evidence se on se.sr_order_id = o.sr_order_id
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
  left join shiprocket_canonical s
    on s.shopify_order_identifier = d.shopify_order_id
   and not data_pipeline.is_return_shipment(s.is_return, s.order_id, s.return_awb_code, s.shipment_status, s.current_status)
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
  from data_pipeline.shiprocket_effective_remittance_orders
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
    ps.forward_delivery_scan_date,
    ps.has_forward_delivery_scan,
    ps.latest_scan_is_rto,
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
delivery_classified as (
  select
    p.*,
    case
      when p.shiprocket_match_status != 'MATCHED' then 'NOT_SHIPPED'
      when p.shiprocket_status_raw ilike '%cancelled%' or p.shiprocket_current_status_raw ilike '%canceled%' or p.shiprocket_order_status = 'new' then 'CANCELLED'
      when p.latest_scan_is_rto or p.shiprocket_status_raw ilike '%rto%' or p.shiprocket_current_status_raw ilike '%rto%' then 'RTO'
      when lower(coalesce(p.shiprocket_status_raw,'')) = 'delivered' or lower(coalesce(p.shiprocket_current_status_raw,'')) = 'delivered' or p.shiprocket_status_id = '7' or p.shiprocket_current_status_id = '7' then 'DELIVERED'
      when nullif(btrim(p.shiprocket_delivered_date_raw), '') is not null then 'DELIVERED'
      when p.has_forward_delivery_scan then 'DELIVERED'
      when lower(coalesce(p.shiprocket_status_raw,'')) = 'undelivered' or lower(coalesce(p.shiprocket_current_status_raw,'')) = 'undelivered' or p.shiprocket_status_raw ilike '%ndr%' or p.shiprocket_current_status_raw ilike '%ndr%' then 'NDR_OPEN'
      when p.shiprocket_status_bucket = 'out_for_delivery' then 'IN_TRANSIT'
      when p.shiprocket_status_bucket in ('in_transit','other') and p.shiprocket_awb is not null then 'IN_TRANSIT'
      when p.shiprocket_awb is not null then 'IN_TRANSIT'
      else 'UNKNOWN'
    end as delivery_outcome
  from with_payment p
),
with_delivery as (
  select
    p.*,
    (p.shiprocket_match_status = 'MATCHED' and p.shiprocket_awb is not null) as is_shipped,
    (p.delivery_outcome = 'DELIVERED' and p.shiprocket_match_status = 'MATCHED') as is_delivered,
    (p.delivery_outcome = 'RTO') as is_rto,
    (p.delivery_outcome = 'NDR_OPEN') as is_ndr,
    (p.shiprocket_status_raw ilike '%cancelled%' or p.shiprocket_current_status_raw ilike '%canceled%') as is_cancelled,
    case
      when p.delivery_outcome = 'DELIVERED'
        and p.shiprocket_delivered_date_raw ~ '^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})?)?$'
        and substring(p.shiprocket_delivered_date_raw, 6, 2) between '01' and '12'
        and substring(p.shiprocket_delivered_date_raw, 9, 2) between '01' and '31'
        and (length(p.shiprocket_delivered_date_raw) < 12 or substring(p.shiprocket_delivered_date_raw, 12, 2) between '00' and '23')
        and (length(p.shiprocket_delivered_date_raw) < 15 or substring(p.shiprocket_delivered_date_raw, 15, 2) between '00' and '59')
        and (length(p.shiprocket_delivered_date_raw) < 18 or substring(p.shiprocket_delivered_date_raw, 18, 2) between '00' and '59')
        then p.shiprocket_delivered_date_raw::timestamptz
      when p.delivery_outcome = 'DELIVERED'
        and p.shiprocket_delivered_date_raw ~ '^\d{2} \d{2} \d{4} \d{2}:\d{2}:\d{2}$'
        and substring(p.shiprocket_delivered_date_raw, 1, 2) between '01' and '31'
        and substring(p.shiprocket_delivered_date_raw, 4, 2) between '01' and '12'
        and substring(p.shiprocket_delivered_date_raw, 12, 2) between '00' and '23'
        and substring(p.shiprocket_delivered_date_raw, 15, 2) between '00' and '59'
        and substring(p.shiprocket_delivered_date_raw, 18, 2) between '00' and '59'
        then to_timestamp(p.shiprocket_delivered_date_raw, 'DD MM YYYY HH24:MI:SS')
      when p.delivery_outcome = 'DELIVERED' and p.forward_delivery_scan_date ~ '^\d{4}-\d{2}-\d{2}' then p.forward_delivery_scan_date::timestamptz
      else null
    end as delivered_at,
    case when p.shiprocket_awb_assigned_date_raw ~ '^\d{4}-\d{2}-\d{2}' then p.shiprocket_awb_assigned_date_raw::timestamptz else null end as shipped_at,
    case when p.shiprocket_pickup_scheduled_date_raw ~ '^\d{4}-\d{2}-\d{2}' then p.shiprocket_pickup_scheduled_date_raw::timestamptz else null end as pickup_scheduled_at
  from delivery_classified p
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
    when delivery_outcome = 'RTO' then 'RTO'
    when delivery_outcome = 'DELIVERED' then
      case
        when is_cod and coalesce(remittance_row_count,0) > 0 then 'DELIVERED_COD_REMITTED'
        when is_cod then 'DELIVERED_COD_NOT_REMITTED'
        else 'DELIVERED_PREPAID'
      end
    when delivery_outcome = 'CANCELLED' then 'CANCELLED'
    when delivery_outcome = 'NDR_OPEN' then 'NDR_OPEN'
    when delivery_outcome = 'IN_TRANSIT' then 'IN_TRANSIT'
    else 'UNKNOWN'
  end as order_outcome
from with_delivery;

grant select on data_pipeline.shopify_order_delivery_remittance to service_role, authenticated;
grant usage on schema data_pipeline to service_role, authenticated;

create or replace view analytics.shopify_order_delivery_remittance with (security_invoker = true) as
select * from data_pipeline.shopify_order_delivery_remittance;

grant select on analytics.shopify_order_delivery_remittance to service_role, authenticated;
grant usage on schema analytics to service_role, authenticated;

create or replace view data_pipeline.mart_order_journey_remittance with (security_invoker = true) as
with latest_remittance as (
  select distinct on (ro.matched_sr_order_id)
    ro.matched_sr_order_id,
    ro.order_value,
    ro.total_adjusted_amt,
    ro.remittance_date,
    ro.match_method,
    ro.match_reason_code
  from data_pipeline.shiprocket_effective_remittance_orders ro
  where ro.matched_sr_order_id is not null
    and ro.match_status = 'matched'
  order by ro.matched_sr_order_id, ro.remittance_date desc nulls last, ro.updated_at desc
)
select
  j.*,
  r.order_value as latest_remittance_order_value,
  r.total_adjusted_amt as latest_total_adjusted_amt,
  r.remittance_date as latest_remittance_date,
  r.match_method as latest_remittance_match_method,
  r.match_reason_code as latest_remittance_match_reason_code
from data_pipeline.mart_order_journey_ndr j
left join latest_remittance r
  on r.matched_sr_order_id = j.shiprocket_sr_order_id;

create or replace view analytics.mart_order_journey_remittance with (security_invoker = true) as
select * from data_pipeline.mart_order_journey_remittance;

grant select on analytics.mart_order_journey_remittance to service_role, authenticated;
