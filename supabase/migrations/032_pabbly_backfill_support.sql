-- 032_pabbly_backfill_support.sql
-- Makes event_id nullable so we can create delivery records for
-- orders that were loaded via Shopify sync (not via Shiprocket webhooks).

alter table data_pipeline.shiprocket_pabbly_deliveries
  alter column event_id drop not null;

alter table data_pipeline.shiprocket_pabbly_delivery_logs
  alter column event_id drop not null;
