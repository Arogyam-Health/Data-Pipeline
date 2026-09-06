-- Non-production diagnostic for the currently imported remittance set.
-- The importer-established matched_sr_order_id is the only reconciliation key.
-- Main dashboard date filters are operational Shiprocket-order filters; do not
-- add a remittance_date predicate when validating an order cohort.

with matched_remittance as (
  select
    ro.crf_id,
    ro.utr,
    ro.awb,
    ro.order_id as remittance_order_id,
    ro.matched_sr_order_id,
    ro.total_adjusted_amt,
    ro.remittance_date,
    ro.match_status
  from data_pipeline.shiprocket_remittance_orders ro
  where ro.match_status = 'matched'
), joined as (
  select
    mr.*,
    e.shopify_order_identifier,
    e.status_bucket,
    e.shipment_status,
    e.current_status,
    e.delivered_date,
    e.payment_bucket,
    e.payment_method,
    e.shopify_matched,
    case when e.status_bucket = 'delivered'
      or (lower(coalesce(e.shipment_status, '') || ' ' || coalesce(e.current_status, '')) like '%delivered%'
          and lower(coalesce(e.shipment_status, '') || ' ' || coalesce(e.current_status, '')) not like '%rto%')
      then true else false end as is_delivered,
    case when coalesce(e.payment_bucket, '') = 'COD'
      or lower(coalesce(e.payment_method, '')) like '%cod%' then true else false end as is_cod
  from matched_remittance mr
  left join data_pipeline.shiprocket_order_explorer e
    on trim(e.sr_order_id::text) = trim(mr.matched_sr_order_id::text)
)
select
  *,
  count(*) over () as total_matched_remittance_rows,
  count(*) filter (where is_delivered and is_cod) over () as delivered_cod_rows,
  count(*) filter (where is_delivered and not is_cod and payment_bucket = 'Prepaid') over () as delivered_prepaid_rows,
  count(*) filter (where is_delivered and not is_cod and coalesce(payment_bucket, '') <> 'Prepaid') over () as delivered_unknown_payment_rows,
  count(*) filter (where lower(coalesce(shipment_status, '') || ' ' || coalesce(current_status, '')) like '%rto%') over () as rto_rows,
  count(*) filter (where status_bucket = 'in_transit') over () as in_transit_rows,
  count(*) filter (where not is_delivered and lower(coalesce(shipment_status, '') || ' ' || coalesce(current_status, '')) not like '%rto%') over () as other_not_delivered_rows,
  case
    when is_delivered and is_cod then 'DELIVERED_REMITTED'
    when is_delivered and not is_cod and payment_bucket = 'Prepaid' then 'NOT_APPLICABLE_PREPAID'
    when is_delivered and not is_cod then 'UNKNOWN_PAYMENT'
    when not is_delivered then 'REMITTED_NOT_DELIVERED'
    else 'UNKNOWN_PAYMENT'
  end as final_reconciliation_status,
  case
    when shopify_order_identifier is null then 'SHIPROCKET_ORDER_NOT_FOUND'
    when not is_delivered then 'SHIPMENT_NOT_DELIVERED'
    when not is_cod then 'PAYMENT_NOT_CONFIDENTLY_COD'
    else null
  end as reason_not_counted_as_delivered_remitted
from joined
order by crf_id, awb;
