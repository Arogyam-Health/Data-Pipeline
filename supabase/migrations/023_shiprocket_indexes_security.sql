-- 023_shiprocket_indexes_security.sql
-- Additive indexes + RLS for new Shiprocket objects.
-- Does not weaken existing RLS.

create index if not exists idx_shiprocket_orders_shipment_status
  on data_pipeline.shiprocket_orders (shipment_status);

create index if not exists idx_shiprocket_orders_current_status
  on data_pipeline.shiprocket_orders (current_status);

create index if not exists idx_shiprocket_orders_courier
  on data_pipeline.shiprocket_orders (courier_name);

create index if not exists idx_shiprocket_orders_channel
  on data_pipeline.shiprocket_orders (channel_id);

create index if not exists idx_shiprocket_orders_payment_method
  on data_pipeline.shiprocket_orders (payment_method);

create index if not exists idx_shiprocket_orders_delivered_date
  on data_pipeline.shiprocket_orders (delivered_date);

create index if not exists idx_shiprocket_orders_last_webhook
  on data_pipeline.shiprocket_orders (last_webhook_sync_at);

create index if not exists idx_shiprocket_orders_return_awb
  on data_pipeline.shiprocket_orders (return_awb_code);

create index if not exists idx_shiprocket_orders_shipment_id
  on data_pipeline.shiprocket_orders (shipment_id);

create index if not exists idx_sr_enrichment_shopify_format
  on data_pipeline.shiprocket_order_enrichment (order_id_shopify_format);

create index if not exists idx_sr_enrichment_phone
  on data_pipeline.shiprocket_order_enrichment (customer_phone_shopify);

create index if not exists idx_sr_scans_sr_order
  on data_pipeline.shiprocket_scans (sr_order_id);

alter table data_pipeline.shiprocket_order_enrichment enable row level security;
alter table data_pipeline.shiprocket_scans enable row level security;

drop policy if exists "Service role can do everything on shiprocket_order_enrichment"
  on data_pipeline.shiprocket_order_enrichment;
create policy "Service role can do everything on shiprocket_order_enrichment"
  on data_pipeline.shiprocket_order_enrichment
  for all
  using (current_setting('request.jwt.claim.role', true) = 'service_role')
  with check (current_setting('request.jwt.claim.role', true) = 'service_role');

drop policy if exists "Service role can do everything on shiprocket_scans"
  on data_pipeline.shiprocket_scans;
create policy "Service role can do everything on shiprocket_scans"
  on data_pipeline.shiprocket_scans
  for all
  using (current_setting('request.jwt.claim.role', true) = 'service_role')
  with check (current_setting('request.jwt.claim.role', true) = 'service_role');

revoke all on data_pipeline.shiprocket_order_enrichment from anon, authenticated;
revoke all on data_pipeline.shiprocket_scans from anon, authenticated;
grant all on data_pipeline.shiprocket_order_enrichment to service_role;
grant all on data_pipeline.shiprocket_scans to service_role;
