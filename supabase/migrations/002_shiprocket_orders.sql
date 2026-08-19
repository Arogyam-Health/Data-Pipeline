-- 002_shiprocket_orders.sql
-- Creates the shiprocket_orders table for processed Shiprocket order data.
-- Portable: no project IDs, no URLs, no credentials.

create table if not exists data_pipeline.shiprocket_orders (
  id                    uuid primary key default gen_random_uuid(),
  sr_order_id           text not null,

  -- Shiprocket Unique Key (computed from sr_order_id)
  unique_key            text,

  -- Status fields
  shipment_status_id    text,
  shipment_status       text,
  current_status_id     text,
  current_status        text,
  order_status          text,
  order_status_code     text,
  payment_status        text,

  -- Shipment details
  courier_name          text,
  awb                   text,
  channel_id            text,
  shipment_id           text,
  tracking_url          text,
  is_return             boolean default false,
  etd                   text,

  -- Current timestamp (from Shiprocket)
  current_ts            text,

  -- Scans 1 (most recent scan — matches Apps Script "Scans 1" columns)
  scans1_status         text,
  scans1_sr_status_label text,
  scans1_sr_status      text,
  scans1_location       text,
  scans1_date           text,
  scans1_activity       text,

  -- Scans 0 (second most recent scan — matches Apps Script "Scans 0" columns)
  scans0_status         text,
  scans0_sr_status_label text,
  scans0_sr_status      text,
  scans0_location       text,
  scans0_date           text,
  scans0_activity       text,

  -- Latest scan (derived — convenience field for current scan)
  scan_status           text,
  scan_sr_status_label  text,
  scan_sr_status        text,
  scan_location         text,
  scan_date             text,
  scan_activity         text,

  -- Order details
  order_id              text,
  order_date            text,
  created_at_sr         text,
  customer_name         text,
  customer_email        text,
  customer_phone        text,
  pickup_location       text,
  payment_method        text,
  order_total           text,
  tax                   text,
  products              text,
  delivered_date        text,

  -- Metadata
  last_webhook_sync_at  timestamptz not null default now(),
  raw_payload           jsonb not null,

  -- Integration tracking
  integration_event_id  uuid references data_pipeline.integration_events(id),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Business key: sr_order_id for upserts
create unique index if not exists idx_shiprocket_orders_sr_order_id
  on data_pipeline.shiprocket_orders (sr_order_id);

-- Lookup by order_id
create index if not exists idx_shiprocket_orders_order_id
  on data_pipeline.shiprocket_orders (order_id);

-- Lookup by AWB
create index if not exists idx_shiprocket_orders_awb
  on data_pipeline.shiprocket_orders (awb);

-- Auto-update updated_at
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_shiprocket_orders_updated_at'
  ) then
    create trigger trg_shiprocket_orders_updated_at
      before update on data_pipeline.shiprocket_orders
      for each row
      execute function data_pipeline.set_updated_at();
  end if;
end;
$$;
