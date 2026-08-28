-- 027_shiprocket_order_360.sql
-- One-row-per-order explorer/360 projection + remittance summaries.
-- PostgreSQL CREATE OR REPLACE VIEW cannot insert columns in the middle of an
-- existing view (column positions are matched by ordinal). Drop and recreate.

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
  e.order_id_shopify_format,
  e.shopify_order_identifier,
  e.customer_name_shopify,
  e.customer_phone_shopify,
  e.coach,
  e.last_enriched_at,
  -- New columns appended after 024 explorer shape (do not insert before created_at).
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
  end as remittance_match_status
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
) rs on true;

create view analytics.shiprocket_order_360 as
select * from data_pipeline.shiprocket_order_explorer;

create or replace view analytics.shiprocket_remittance_summary as
select
  count(*) as crf_count,
  count(distinct utr) filter (where utr is not null and btrim(utr) <> '') as distinct_utrs,
  count(*) filter (where status ilike '%success%') as successful_remittances,
  count(*) filter (where status is null or status not ilike '%success%') as other_remittances,
  coalesce(sum(remittance_amount), 0) as remittance_amount_total,
  coalesce(sum(adjusted_amount), 0) as adjusted_amount_total,
  coalesce(sum(freight_charges_from_cod), 0) as freight_charges_total,
  coalesce(sum(rto_reversal_amount), 0) as rto_reversal_total,
  max(remittance_date) as latest_remittance_date
from data_pipeline.shiprocket_remittances;

create or replace view analytics.shiprocket_crf_summary as
select
  r.crf_id,
  r.utr,
  r.report_date,
  r.remittance_date,
  r.status,
  r.remittance_method,
  r.remittance_amount,
  r.adjusted_amount,
  count(ro.id) as awb_count,
  count(ro.id) filter (where ro.match_status = 'matched') as matched_orders,
  count(ro.id) filter (where ro.match_status = 'unmatched') as unmatched_orders,
  count(ro.id) filter (where ro.match_status = 'ambiguous') as ambiguous_orders
from data_pipeline.shiprocket_remittances r
left join data_pipeline.shiprocket_remittance_orders ro on ro.crf_id = r.crf_id
group by
  r.crf_id, r.utr, r.report_date, r.remittance_date, r.status,
  r.remittance_method, r.remittance_amount, r.adjusted_amount;

create or replace view analytics.shiprocket_data_quality as
select
  count(*) as orders_total,
  count(*) filter (where o.order_id is null or btrim(o.order_id) = '') as missing_order_id,
  count(*) filter (where o.awb is null or btrim(o.awb) = '') as missing_awb,
  count(*) filter (where e.order_id_shopify_format is null or e.order_id_shopify_format = '') as missing_shopify_8_digit,
  count(*) filter (where e.shopify_order_identifier is not null) as shopify_matched,
  count(*) filter (where e.sr_order_id is not null and e.shopify_order_identifier is null) as shopify_unmatched,
  count(*) filter (where e.customer_name_shopify is null or e.customer_name_shopify = '') as missing_customer_name,
  count(*) filter (where e.customer_phone_shopify is null or e.customer_phone_shopify = '') as missing_customer_phone,
  count(*) filter (where o.last_local_api_sync_at is null) as last_api_sync_missing,
  max(o.last_webhook_sync_at) as last_webhook_sync,
  (select count(*) from data_pipeline.shiprocket_remittances) as remittance_crfs,
  (select count(*) from data_pipeline.shiprocket_remittance_orders) as remittance_awb_rows,
  (select count(*) from data_pipeline.shiprocket_remittance_orders where match_status = 'matched') as remittance_matched,
  (select count(*) from data_pipeline.shiprocket_remittance_orders where match_status = 'unmatched') as remittance_unmatched,
  (select count(*) from data_pipeline.shiprocket_remittance_orders where match_status = 'ambiguous') as remittance_ambiguous,
  (select max(completed_at) from data_pipeline.shiprocket_remittance_imports) as last_remittance_import
from data_pipeline.shiprocket_orders o
left join data_pipeline.shiprocket_order_enrichment e
  on e.sr_order_id = o.sr_order_id;

grant select on data_pipeline.shiprocket_order_explorer to service_role;
grant select on analytics.shiprocket_order_360 to service_role, authenticated;
grant select on analytics.shiprocket_remittance_summary to service_role, authenticated;
grant select on analytics.shiprocket_crf_summary to service_role, authenticated;
grant select on analytics.shiprocket_data_quality to service_role, authenticated;
