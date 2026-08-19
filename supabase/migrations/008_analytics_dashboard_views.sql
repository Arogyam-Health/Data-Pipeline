-- 008_analytics_dashboard_views.sql
-- Enhanced analytics views for Metabase dashboards.
-- Run this in Supabase SQL Editor to deploy all dashboard views.

-- ============================================================
-- SCHEMA
-- ============================================================
create schema if not exists analytics;

-- ============================================================
-- 1. shiprocket_orders (clean, Metabase-friendly)
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
  order_total::numeric as order_total,
  tax::numeric as tax,
  products,
  delivered_date,
  last_webhook_sync_at,
  created_at,
  updated_at
from data_pipeline.shiprocket_orders;

-- ============================================================
-- 2. Status summary (pie chart: orders by status)
-- ============================================================
create or replace view analytics.shiprocket_status_summary as
select
  coalesce(nullif(current_status, ''), 'Unknown') as status,
  count(*) as order_count,
  min(created_at) as first_seen,
  max(updated_at) as last_updated
from data_pipeline.shiprocket_orders
group by coalesce(nullif(current_status, ''), 'Unknown');

-- ============================================================
-- 3. Daily delivery summary (line chart: orders over time)
-- ============================================================
create or replace view analytics.shiprocket_delivery_summary as
select
  date_trunc('day', created_at)::date as date,
  count(*) as total_orders,
  count(*) filter (where current_status ilike '%delivered%') as delivered_count,
  count(*) filter (where current_status ilike '%rto%' or current_status ilike '%return%') as rto_count,
  count(*) filter (where is_return = true) as return_count,
  count(*) filter (where current_status ilike '%transit%') as in_transit_count,
  count(*) filter (where current_status ilike '%pending%' or current_status ilike '%processing%') as pending_count,
  round(
    100.0 * count(*) filter (where current_status ilike '%delivered%') / nullif(count(*), 0),
    2
  ) as delivery_rate_pct,
  sum(order_total::numeric) as total_revenue,
  round(avg(order_total::numeric), 2) as avg_order_value
from data_pipeline.shiprocket_orders
group by date_trunc('day', created_at)
order by date desc;

-- ============================================================
-- 4. Courier performance (bar chart: orders by courier)
-- ============================================================
create or replace view analytics.shiprocket_courier_performance as
select
  coalesce(nullif(courier_name, ''), 'Unknown') as courier,
  count(*) as total_orders,
  count(*) filter (where current_status ilike '%delivered%') as delivered,
  count(*) filter (where current_status ilike '%rto%') as rto_count,
  round(
    100.0 * count(*) filter (where current_status ilike '%delivered%') / nullif(count(*), 0),
    2
  ) as delivery_rate_pct,
  sum(order_total::numeric) as total_revenue,
  round(avg(order_total::numeric), 2) as avg_order_value
from data_pipeline.shiprocket_orders
group by coalesce(nullif(courier_name, ''), 'Unknown')
order by total_orders desc;

-- ============================================================
-- 5. Payment breakdown (pie chart: payment methods)
-- ============================================================
create or replace view analytics.shiprocket_payment_breakdown as
select
  coalesce(nullif(payment_method, ''), 'Unknown') as payment_method,
  coalesce(nullif(payment_status, ''), 'Unknown') as payment_status,
  count(*) as order_count,
  sum(order_total::numeric) as total_value,
  round(avg(order_total::numeric), 2) as avg_value
from data_pipeline.shiprocket_orders
group by
  coalesce(nullif(payment_method, ''), 'Unknown'),
  coalesce(nullif(payment_status, ''), 'Unknown')
order by order_count desc;

-- ============================================================
-- 6. Webhook processing health (gauge: events by status)
-- ============================================================
create or replace view analytics.webhook_processing_health as
select
  status,
  count(*) as event_count,
  round(avg(attempt_count), 2) as avg_attempts,
  min(received_at) as oldest_event,
  max(updated_at) as newest_event,
  max(received_at) filter (where status = 'pending') as oldest_pending,
  max(received_at) filter (where status = 'failed') as latest_failure
from data_pipeline.integration_events
where provider = 'shiprocket'
group by status;

-- ============================================================
-- 7. Recent orders (table: last 50 orders)
-- ============================================================
create or replace view analytics.shiprocket_recent_orders as
select
  sr_order_id,
  order_id,
  current_status,
  courier_name,
  awb,
  customer_name,
  payment_method,
  payment_status,
  order_total::numeric as order_total,
  tracking_url,
  created_at,
  last_webhook_sync_at
from data_pipeline.shiprocket_orders
order by created_at desc
limit 50;

-- ============================================================
-- 8. KPI summary (single-value cards)
-- ============================================================
create or replace view analytics.shiprocket_kpis as
select
  (select count(*) from data_pipeline.shiprocket_orders) as total_orders,
  (select count(*) from data_pipeline.shiprocket_orders where current_status ilike '%delivered%') as delivered_orders,
  (select count(*) from data_pipeline.shiprocket_orders where current_status ilike '%transit%') as in_transit_orders,
  (select count(*) from data_pipeline.shiprocket_orders where current_status ilike '%pending%' or current_status ilike '%processing%') as pending_orders,
  (select count(*) from data_pipeline.shiprocket_orders where current_status ilike '%rto%' or is_return = true) as rto_orders,
  (select round(100.0 * count(*) filter (where current_status ilike '%delivered%') / nullif(count(*), 0), 2) from data_pipeline.shiprocket_orders) as delivery_rate_pct,
  (select sum(order_total::numeric) from data_pipeline.shiprocket_orders) as total_revenue,
  (select round(avg(order_total::numeric), 2) from data_pipeline.shiprocket_orders) as avg_order_value,
  (select count(*) from data_pipeline.integration_events where provider = 'shiprocket' and status = 'pending') as pending_events,
  (select count(*) from data_pipeline.integration_events where provider = 'shiprocket' and status = 'processed') as processed_events,
  (select count(*) from data_pipeline.integration_events where provider = 'shiprocket' and status = 'failed') as failed_events;

-- ============================================================
-- 9. Hourly webhook volume (line chart: webhooks per hour)
-- ============================================================
create or replace view analytics.shiprocket_hourly_volume as
select
  date_trunc('hour', received_at) as hour,
  count(*) as webhooks_received,
  count(*) filter (where status = 'processed') as processed,
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'failed') as failed
from data_pipeline.integration_events
where provider = 'shiprocket'
  and received_at >= now() - interval '7 days'
group by date_trunc('hour', received_at)
order by hour desc;

-- ============================================================
-- 10. Pabbly delivery status (if Pabbly is enabled)
-- ============================================================
create or replace view analytics.pabbly_delivery_summary as
select
  status,
  count(*) as delivery_count,
  round(avg(attempt_count), 2) as avg_attempts,
  min(created_at) as oldest,
  max(updated_at) as newest
from data_pipeline.shiprocket_pabbly_deliveries
group by status;

-- ============================================================
-- GRANTS (Metabase reads via service_role)
-- ============================================================
grant usage on schema analytics to service_role;
grant select on all tables in schema analytics to service_role;
grant select on all tables in schema analytics to authenticated;
