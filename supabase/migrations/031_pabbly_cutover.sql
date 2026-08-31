-- 031_pabbly_cutover.sql
-- Extends shiprocket_pabbly_deliveries with order identifiers,
-- creates append-only delivery log table,
-- and adds Pabbly state to the order explorer.

-- ============================================================
-- 1. Extend shiprocket_pabbly_deliveries
-- ============================================================

alter table data_pipeline.shiprocket_pabbly_deliveries
  add column if not exists sr_order_id text,
  add column if not exists order_id text;

alter table data_pipeline.shiprocket_pabbly_deliveries
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_duration_ms integer,
  add column if not exists final_failure_at timestamptz;

alter table data_pipeline.shiprocket_pabbly_deliveries
  drop constraint if exists shiprocket_pabbly_deliveries_status_check;

alter table data_pipeline.shiprocket_pabbly_deliveries
  add constraint shiprocket_pabbly_deliveries_status_check
  check (status in ('pending', 'processing', 'retrying', 'sent', 'failed'));

create index if not exists idx_pabbly_deliveries_sr_order_id
  on data_pipeline.shiprocket_pabbly_deliveries (sr_order_id);

create index if not exists idx_pabbly_deliveries_order_id
  on data_pipeline.shiprocket_pabbly_deliveries (order_id);

create index if not exists idx_pabbly_deliveries_next_attempt
  on data_pipeline.shiprocket_pabbly_deliveries (next_attempt_at)
  where status in ('pending', 'retrying');

-- ============================================================
-- 2. Append-only delivery log table
-- ============================================================

create table if not exists data_pipeline.shiprocket_pabbly_delivery_logs (
  id                uuid primary key default gen_random_uuid(),
  delivery_id       uuid not null references data_pipeline.shiprocket_pabbly_deliveries(id),
  event_id          uuid not null,
  sr_order_id       text,
  order_id          text,
  attempt_number    integer not null,
  status            text not null,
  response_code     integer,
  error_category    text,
  error_message     text,
    duration_ms       integer,
  attempted_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists idx_pabbly_logs_delivery_id
  on data_pipeline.shiprocket_pabbly_delivery_logs (delivery_id);

create index if not exists idx_pabbly_logs_sr_order_id
  on data_pipeline.shiprocket_pabbly_delivery_logs (sr_order_id);

create index if not exists idx_pabbly_logs_attempted_at
  on data_pipeline.shiprocket_pabbly_delivery_logs (attempted_at desc);

create index if not exists idx_pabbly_logs_status
  on data_pipeline.shiprocket_pabbly_delivery_logs (status);

-- ============================================================
-- 3. Extend shiprocket_order_explorer with Pabbly state
-- ============================================================

-- Must DROP dependent views first: Postgres refuses CREATE OR REPLACE VIEW when
-- the new column list differs, and DROP fails if dependents exist.
drop view if exists analytics.shiprocket_order_360;
drop view if exists data_pipeline.shiprocket_order_explorer;

create view data_pipeline.shiprocket_order_explorer as
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
    when coalesce(o.shipment_status, '') ilike '%delivered%'
      or coalesce(o.current_status, '') ilike '%delivered%' then 'delivered'
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

-- Recreate the analytics view that was dropped above
create view analytics.shiprocket_order_360 as
select * from data_pipeline.shiprocket_order_explorer;

-- Re-grant permissions
grant select on data_pipeline.shiprocket_order_explorer to service_role;
grant select on analytics.shiprocket_order_360 to service_role, authenticated;
