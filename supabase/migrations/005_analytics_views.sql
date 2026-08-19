-- 005_analytics_views.sql
-- Creates analytics views for Metabase under the analytics schema.
-- Portable: no project IDs, no URLs, no credentials.

create schema if not exists analytics;

-- ============================================================
-- analytics.shiprocket_orders
-- Clean, Metabase-friendly view of Shiprocket orders.
-- Hides raw payloads and internal tracking fields.
-- ============================================================
create or replace view analytics.shiprocket_orders as
select
  id,
  sr_order_id,
  order_id,
  shipment_status_id,
  shipment_status,
  current_status_id,
  current_status,
  order_status,
  order_status_code,
  payment_status,
  payment_method,
  courier_name,
  awb,
  channel_id,
  shipment_id,
  tracking_url,
  is_return,
  etd,
  order_date,
  created_at_sr,
  customer_name,
  customer_email,
  customer_phone,
  pickup_location,
  order_total,
  tax,
  products,
  delivered_date,
  last_webhook_sync_at,
  created_at,
  updated_at
from data_pipeline.shiprocket_orders;

-- ============================================================
-- analytics.shiprocket_status_summary
-- Aggregated shipment status counts.
-- ============================================================
create or replace view analytics.shiprocket_status_summary as
select
  shipment_status,
  current_status,
  count(*) as order_count,
  min(created_at) as first_seen,
  max(updated_at) as last_updated
from data_pipeline.shiprocket_orders
group by shipment_status, current_status;

-- ============================================================
-- analytics.shiprocket_delivery_summary
-- Delivery performance metrics by date.
-- ============================================================
create or replace view analytics.shiprocket_delivery_summary as
select
  date_trunc('day', created_at) as date,
  count(*) as total_orders,
  count(*) filter (where current_status ilike '%delivered%') as delivered_count,
  count(*) filter (where current_status ilike '%rto%') as rto_count,
  count(*) filter (where is_return = true) as return_count,
  round(
    100.0 * count(*) filter (where current_status ilike '%delivered%') / nullif(count(*), 0),
    2
  ) as delivery_rate_pct
from data_pipeline.shiprocket_orders
group by date_trunc('day', created_at)
order by date desc;

-- ============================================================
-- analytics.integration_events_summary
-- Event processing health by provider.
-- ============================================================
create or replace view analytics.integration_events_summary as
select
  provider,
  status,
  count(*) as event_count,
  avg(attempt_count) as avg_attempts,
  min(received_at) as oldest_event,
  max(updated_at) as newest_event
from data_pipeline.integration_events
group by provider, status;
