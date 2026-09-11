-- 042 — Explain remittance matching and retain row-level import audit history.

alter table data_pipeline.shiprocket_remittance_orders
  add column if not exists match_method text not null default 'NONE',
  add column if not exists match_reason_code text not null default 'UNKNOWN',
  add column if not exists match_candidate_count integer not null default 0,
  add column if not exists last_import_id uuid references data_pipeline.shiprocket_remittance_imports(id) on delete set null;

alter table data_pipeline.shiprocket_remittance_imports
  add column if not exists matched_by_awb integer not null default 0,
  add column if not exists matched_by_order_id integer not null default 0,
  add column if not exists matched_by_shopify_format integer not null default 0;

create index if not exists idx_sr_remittance_orders_last_import
  on data_pipeline.shiprocket_remittance_orders (last_import_id);

create table if not exists data_pipeline.shiprocket_remittance_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references data_pipeline.shiprocket_remittance_imports(id) on delete cascade,
  crf_id text,
  awb text,
  order_id text,
  match_status text not null check (match_status in ('matched', 'unmatched', 'ambiguous')),
  match_method text not null,
  match_reason_code text not null,
  match_candidate_count integer not null default 0,
  matched_sr_order_id text,
  delivered_date date,
  remittance_date date,
  order_value numeric(20,4),
  total_adjusted_amt numeric(20,4),
  utr text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sr_remittance_import_rows_import
  on data_pipeline.shiprocket_remittance_import_rows (import_id);
create index if not exists idx_sr_remittance_import_rows_match
  on data_pipeline.shiprocket_remittance_import_rows (match_status, match_reason_code);
create index if not exists idx_sr_remittance_import_rows_sr
  on data_pipeline.shiprocket_remittance_import_rows (matched_sr_order_id);

alter table data_pipeline.shiprocket_remittance_import_rows enable row level security;
drop policy if exists "Service role can do everything on shiprocket_remittance_import_rows"
  on data_pipeline.shiprocket_remittance_import_rows;
create policy "Service role can do everything on shiprocket_remittance_import_rows"
  on data_pipeline.shiprocket_remittance_import_rows for all
  using (current_setting('request.jwt.claim.role', true) = 'service_role')
  with check (current_setting('request.jwt.claim.role', true) = 'service_role');
revoke all on data_pipeline.shiprocket_remittance_import_rows from anon, authenticated;
grant all on data_pipeline.shiprocket_remittance_import_rows to service_role;
