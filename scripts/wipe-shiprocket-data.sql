-- ONE-OFF: wipe Shiprocket operational data so you can re-test webhook → DB → dashboard.
-- Run this in the Supabase SQL Editor. Do NOT add it to numbered migrations.
--
-- SAFE SCOPE:
--   Deletes only Shiprocket tables + shiprocket rows in integration_events + the
--   shiprocket_webhooks queue.
--   Does NOT touch Shopify, Meta, or GA4 tables.
--   Does NOT drop tables, views, functions, or RLS.
--
-- Views such as data_pipeline.shiprocket_order_explorer will go empty automatically.

begin;

-- 1) Preview counts (these SELECT results appear above the DELETE in the editor)
select 'shiprocket_orders' as table_name, count(*)::int as rows from data_pipeline.shiprocket_orders
union all
select 'shiprocket_order_enrichment', count(*)::int from data_pipeline.shiprocket_order_enrichment
union all
select 'shiprocket_scans', count(*)::int from data_pipeline.shiprocket_scans
union all
select 'shiprocket_pabbly_deliveries', count(*)::int from data_pipeline.shiprocket_pabbly_deliveries
union all
select 'shiprocket_remittance_orders', count(*)::int from data_pipeline.shiprocket_remittance_orders
union all
select 'shiprocket_remittances', count(*)::int from data_pipeline.shiprocket_remittances
union all
select 'shiprocket_remittance_imports', count(*)::int from data_pipeline.shiprocket_remittance_imports
union all
select 'integration_events (shiprocket)', count(*)::int
  from data_pipeline.integration_events
 where provider = 'shiprocket';

-- 2) Child tables first (respect FKs)
delete from data_pipeline.shiprocket_remittance_orders;
delete from data_pipeline.shiprocket_remittance_imports;
delete from data_pipeline.shiprocket_remittances;

delete from data_pipeline.shiprocket_scans;
delete from data_pipeline.shiprocket_order_enrichment;
delete from data_pipeline.shiprocket_pabbly_deliveries;

-- 3) Canonical orders (scans/enrichment also CASCADE if any remain)
delete from data_pipeline.shiprocket_orders;

-- 4) Shared event log — Shiprocket only
delete from data_pipeline.integration_events
 where provider = 'shiprocket';

-- 5) Pending/archived webhook queue
do $$
begin
  perform pgmq.purge_queue('shiprocket_webhooks');
exception
  when undefined_function then
    delete from pgmq.q_shiprocket_webhooks;
    delete from pgmq.a_shiprocket_webhooks;
  when undefined_table then
    null;
end
$$;

-- 6) Confirm everything is empty
select 'shiprocket_orders' as table_name, count(*)::int as rows from data_pipeline.shiprocket_orders
union all
select 'shiprocket_order_enrichment', count(*)::int from data_pipeline.shiprocket_order_enrichment
union all
select 'shiprocket_scans', count(*)::int from data_pipeline.shiprocket_scans
union all
select 'shiprocket_pabbly_deliveries', count(*)::int from data_pipeline.shiprocket_pabbly_deliveries
union all
select 'shiprocket_remittance_orders', count(*)::int from data_pipeline.shiprocket_remittance_orders
union all
select 'shiprocket_remittances', count(*)::int from data_pipeline.shiprocket_remittances
union all
select 'shiprocket_remittance_imports', count(*)::int from data_pipeline.shiprocket_remittance_imports
union all
select 'integration_events (shiprocket)', count(*)::int
  from data_pipeline.integration_events
 where provider = 'shiprocket'
union all
select 'explorer view', count(*)::int from data_pipeline.shiprocket_order_explorer;

commit;
