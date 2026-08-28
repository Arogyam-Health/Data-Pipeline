-- ONE-OFF: fill order_id from stored webhook JSON when the worker omitted it.
-- Run in Supabase SQL Editor. Does not drop tables or change schema.

update data_pipeline.shiprocket_orders
set
  order_id = coalesce(
    nullif(trim(order_id), ''),
    nullif(trim(raw_payload->>'order_id'), ''),
    nullif(trim(raw_payload->'data'->>'order_id'), '')
  ),
  return_awb_code = coalesce(
    nullif(trim(return_awb_code), ''),
    nullif(trim(raw_payload->>'return_awb_code'), ''),
    nullif(trim(raw_payload->'data'->>'return_awb_code'), '')
  ),
  etd = coalesce(
    nullif(trim(etd), ''),
    nullif(trim(raw_payload->>'etd'), ''),
    nullif(trim(raw_payload->'data'->>'etd'), '')
  ),
  undelivered_reason = coalesce(
    nullif(trim(undelivered_reason), ''),
    nullif(trim(raw_payload->>'undelivered_reason'), ''),
    nullif(trim(raw_payload->'data'->>'undelivered_reason'), '')
  ),
  undelivered_reason_code = coalesce(
    nullif(trim(undelivered_reason_code), ''),
    nullif(trim(raw_payload->>'undelivered_reason_code'), ''),
    nullif(trim(raw_payload->'data'->>'undelivered_reason_code'), '')
  ),
  awb_assigned_date = coalesce(
    nullif(trim(awb_assigned_date), ''),
    nullif(trim(raw_payload->>'awb_assigned_date'), ''),
    nullif(trim(raw_payload->'data'->>'awb_assigned_date'), '')
  ),
  pickup_scheduled_date = coalesce(
    nullif(trim(pickup_scheduled_date), ''),
    nullif(trim(raw_payload->>'pickup_scheduled_date'), ''),
    nullif(trim(raw_payload->'data'->>'pickup_scheduled_date'), '')
  ),
  delivery_attempt_count = coalesce(
    nullif(trim(delivery_attempt_count), ''),
    nullif(trim(raw_payload->>'delivery_attempt_count'), ''),
    nullif(trim(raw_payload->'data'->>'delivery_attempt_count'), '')
  ),
  pod_status = coalesce(
    nullif(trim(pod_status), ''),
    nullif(trim(raw_payload->>'pod_status'), ''),
    nullif(trim(raw_payload->'data'->>'pod_status'), '')
  ),
  shipping_method = coalesce(
    nullif(trim(shipping_method), ''),
    nullif(trim(raw_payload->>'shipping_method'), ''),
    nullif(trim(raw_payload->'data'->>'shipping_method'), '')
  ),
  current_ts = coalesce(
    nullif(trim(current_ts), ''),
    nullif(trim(raw_payload->>'current_timestamp'), ''),
    nullif(trim(raw_payload->'data'->>'current_timestamp'), '')
  )
where raw_payload is not null;

-- Re-run Shopify enrichment for rows that now have an order id
select data_pipeline.enrich_shiprocket_order(sr_order_id)
from data_pipeline.shiprocket_orders
where coalesce(trim(order_id), '') <> '';
