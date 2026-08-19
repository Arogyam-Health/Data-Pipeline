-- 006_rls_security.sql
-- Row Level Security policies for the data_pipeline schema.
-- Only service_role has access. Anon/authenticated have no grants
-- on this schema, but RLS provides defense-in-depth.

-- Enable RLS on all tables
alter table data_pipeline.integration_events enable row level security;
alter table data_pipeline.shiprocket_orders enable row level security;
alter table data_pipeline.shiprocket_pabbly_deliveries enable row level security;

-- Service-role-only policies (defense-in-depth)
-- These check the JWT role claim so that even if grants are accidentally
-- added for anon/authenticated, they still can't access the data.

create policy "Service role can do everything on integration_events"
  on data_pipeline.integration_events
  for all
  using (current_setting('request.jwt.claim.role', true) = 'service_role')
  with check (current_setting('request.jwt.claim.role', true) = 'service_role');

create policy "Service role can do everything on shiprocket_orders"
  on data_pipeline.shiprocket_orders
  for all
  using (current_setting('request.jwt.claim.role', true) = 'service_role')
  with check (current_setting('request.jwt.claim.role', true) = 'service_role');

create policy "Service role can do everything on pabbly_deliveries"
  on data_pipeline.shiprocket_pabbly_deliveries
  for all
  using (current_setting('request.jwt.claim.role', true) = 'service_role')
  with check (current_setting('request.jwt.claim.role', true) = 'service_role');

-- Analytics views are read-only for authenticated users
grant usage on schema analytics to authenticated;
grant usage on schema analytics to service_role;
grant select on all tables in schema analytics to authenticated;
grant select on all tables in schema analytics to service_role;
