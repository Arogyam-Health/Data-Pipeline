-- 025_shiprocket_remittance.sql
-- Additive billing webhook fields + remittance/settlement domain.
-- Does not rename/drop existing columns. Does not touch Shopify/Meta/GA4.

alter table data_pipeline.shiprocket_orders
  add column if not exists billing_name text,
  add column if not exists billing_email text,
  add column if not exists billing_phone text,
  add column if not exists source_date text;

create table if not exists data_pipeline.shiprocket_remittances (
  id uuid primary key default gen_random_uuid(),
  crf_id text not null,
  report_date date,
  remittance_date date,
  cod_available numeric(20,4),
  instant_cod_available numeric(20,4),
  standard_cod_available numeric(20,4),
  early_cod_available numeric(20,4),
  freight_charges_from_cod numeric(20,4),
  rto_reversal_amount numeric(20,4),
  remittance_amount numeric(20,4),
  remittance_method text,
  adjusted_amount numeric(20,4),
  utr text,
  status text,
  remarks text,
  early_cod_charges numeric(20,4),
  instant_cod_charges numeric(20,4),
  source text not null default 'report_upload',
  last_source_sync_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crf_id)
);

create table if not exists data_pipeline.shiprocket_remittance_orders (
  id uuid primary key default gen_random_uuid(),
  remittance_id uuid references data_pipeline.shiprocket_remittances(id) on delete set null,
  crf_id text not null,
  awb text,
  order_id text,
  delivered_date date,
  shipped_date date,
  courier text,
  order_value numeric(20,4),
  channel_name text,
  remittance_type text,
  remittance_date date,
  utr text,
  total_adjusted_amt numeric(20,4),
  linked_crf_ids text,
  matched_sr_order_id text,
  match_status text not null default 'unmatched'
    check (match_status in ('matched', 'unmatched', 'ambiguous')),
  source text not null default 'report_upload',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crf_id, awb, order_id)
);

create table if not exists data_pipeline.shiprocket_remittance_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_hash text not null,
  source text not null default 'report_upload',
  awb_rows_read integer not null default 0,
  awb_rows_upserted integer not null default 0,
  crf_rows_read integer not null default 0,
  crf_rows_upserted integer not null default 0,
  matched_orders integer not null default 0,
  unmatched_orders integer not null default 0,
  ambiguous_orders integer not null default 0,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_shiprocket_remittances_updated_at'
  ) then
    create trigger trg_shiprocket_remittances_updated_at
      before update on data_pipeline.shiprocket_remittances
      for each row
      execute function data_pipeline.set_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_shiprocket_remittance_orders_updated_at'
  ) then
    create trigger trg_shiprocket_remittance_orders_updated_at
      before update on data_pipeline.shiprocket_remittance_orders
      for each row
      execute function data_pipeline.set_updated_at();
  end if;
end;
$$;
