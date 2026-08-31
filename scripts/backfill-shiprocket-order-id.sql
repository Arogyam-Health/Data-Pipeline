-- ONE-OFF: fill tracking fields from stored webhook JSON.
-- Run in the Supabase SQL Editor. Do not add this to numbered migrations.
--
-- Step 1 only (this file): UPDATE shiprocket_orders.
-- Step 2: apply supabase/migrations/029_enrich_shiprocket_order_conflict.sql
-- Step 3: run the enrichment SELECT at the bottom.

update data_pipeline.shiprocket_orders o
set
  order_id = coalesce(
    nullif(trim(o.order_id), ''),
    nullif(trim(o.raw_payload->>'order_id'), ''),
    nullif(trim(o.raw_payload->'data'->>'order_id'), '')
  ),
  return_awb_code = coalesce(
    nullif(trim(o.return_awb_code), ''),
    nullif(trim(o.raw_payload->>'return_awb_code'), ''),
    nullif(trim(o.raw_payload->'data'->>'return_awb_code'), '')
  ),
  etd = coalesce(
    nullif(trim(o.etd), ''),
    nullif(trim(o.raw_payload->>'etd'), ''),
    nullif(trim(o.raw_payload->'data'->>'etd'), '')
  ),
  undelivered_reason = coalesce(
    nullif(trim(o.undelivered_reason), ''),
    nullif(trim(o.raw_payload->>'undelivered_reason'), ''),
    nullif(trim(o.raw_payload->'data'->>'undelivered_reason'), '')
  ),
  undelivered_reason_code = coalesce(
    nullif(trim(o.undelivered_reason_code), ''),
    nullif(trim(o.raw_payload->>'undelivered_reason_code'), ''),
    nullif(trim(o.raw_payload->'data'->>'undelivered_reason_code'), '')
  ),
  awb_assigned_date = coalesce(
    nullif(trim(o.awb_assigned_date), ''),
    nullif(trim(o.raw_payload->>'awb_assigned_date'), ''),
    nullif(trim(o.raw_payload->'data'->>'awb_assigned_date'), '')
  ),
  pickup_scheduled_date = coalesce(
    nullif(trim(o.pickup_scheduled_date), ''),
    nullif(trim(o.raw_payload->>'pickup_scheduled_date'), ''),
    nullif(trim(o.raw_payload->'data'->>'pickup_scheduled_date'), '')
  ),
  delivery_attempt_count = coalesce(
    nullif(trim(o.delivery_attempt_count), ''),
    nullif(trim(o.raw_payload->>'delivery_attempt_count'), ''),
    nullif(trim(o.raw_payload->'data'->>'delivery_attempt_count'), '')
  ),
  pod_status = coalesce(
    nullif(trim(o.pod_status), ''),
    nullif(trim(o.raw_payload->>'pod_status'), ''),
    nullif(trim(o.raw_payload->'data'->>'pod_status'), '')
  ),
  shipping_method = coalesce(
    nullif(trim(o.shipping_method), ''),
    nullif(trim(o.raw_payload->>'shipping_method'), ''),
    nullif(trim(o.raw_payload->'data'->>'shipping_method'), '')
  ),
  current_ts = coalesce(
    nullif(trim(o.current_ts), ''),
    nullif(trim(o.raw_payload->>'current_timestamp'), ''),
    nullif(trim(o.raw_payload->'data'->>'current_timestamp'), '')
  )
where o.raw_payload is not null;

-- After applying 029 and 030, run this separately:
-- select data_pipeline.enrich_shiprocket_order(o.sr_order_id)
-- from data_pipeline.shiprocket_orders o
-- where coalesce(trim(o.order_id), '') <> '';
