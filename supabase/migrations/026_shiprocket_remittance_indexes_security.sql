-- 026_shiprocket_remittance_indexes_security.sql
-- Additive remittance indexes + RLS. Does not weaken existing RLS.

create index if not exists idx_shiprocket_orders_billing_email
  on data_pipeline.shiprocket_orders (billing_email);

create index if not exists idx_sr_remittances_utr
  on data_pipeline.shiprocket_remittances (utr);

create index if not exists idx_sr_remittances_status
  on data_pipeline.shiprocket_remittances (status);

create index if not exists idx_sr_remittances_date
  on data_pipeline.shiprocket_remittances (remittance_date);

create index if not exists idx_sr_remittance_orders_crf
  on data_pipeline.shiprocket_remittance_orders (crf_id);

create index if not exists idx_sr_remittance_orders_awb
  on data_pipeline.shiprocket_remittance_orders (awb);

create index if not exists idx_sr_remittance_orders_order_id
  on data_pipeline.shiprocket_remittance_orders (order_id);

create index if not exists idx_sr_remittance_orders_date
  on data_pipeline.shiprocket_remittance_orders (remittance_date);

create index if not exists idx_sr_remittance_orders_match
  on data_pipeline.shiprocket_remittance_orders (match_status);

create index if not exists idx_sr_remittance_orders_sr
  on data_pipeline.shiprocket_remittance_orders (matched_sr_order_id);

create index if not exists idx_sr_remittance_imports_hash
  on data_pipeline.shiprocket_remittance_imports (file_hash);

alter table data_pipeline.shiprocket_remittances enable row level security;
alter table data_pipeline.shiprocket_remittance_orders enable row level security;
alter table data_pipeline.shiprocket_remittance_imports enable row level security;

drop policy if exists "Service role can do everything on shiprocket_remittances"
  on data_pipeline.shiprocket_remittances;
create policy "Service role can do everything on shiprocket_remittances"
  on data_pipeline.shiprocket_remittances
  for all
  using (current_setting('request.jwt.claim.role', true) = 'service_role')
  with check (current_setting('request.jwt.claim.role', true) = 'service_role');

drop policy if exists "Service role can do everything on shiprocket_remittance_orders"
  on data_pipeline.shiprocket_remittance_orders;
create policy "Service role can do everything on shiprocket_remittance_orders"
  on data_pipeline.shiprocket_remittance_orders
  for all
  using (current_setting('request.jwt.claim.role', true) = 'service_role')
  with check (current_setting('request.jwt.claim.role', true) = 'service_role');

drop policy if exists "Service role can do everything on shiprocket_remittance_imports"
  on data_pipeline.shiprocket_remittance_imports;
create policy "Service role can do everything on shiprocket_remittance_imports"
  on data_pipeline.shiprocket_remittance_imports
  for all
  using (current_setting('request.jwt.claim.role', true) = 'service_role')
  with check (current_setting('request.jwt.claim.role', true) = 'service_role');

revoke all on data_pipeline.shiprocket_remittances from anon, authenticated;
revoke all on data_pipeline.shiprocket_remittance_orders from anon, authenticated;
revoke all on data_pipeline.shiprocket_remittance_imports from anon, authenticated;
grant all on data_pipeline.shiprocket_remittances to service_role;
grant all on data_pipeline.shiprocket_remittance_orders to service_role;
grant all on data_pipeline.shiprocket_remittance_imports to service_role;
