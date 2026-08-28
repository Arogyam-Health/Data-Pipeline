-- 018_ga4_schema.sql
-- Isolated GA4 canonical tables under data_pipeline.
-- Portable: no project IDs, no URLs, no credentials, no OIDC/access tokens.
-- Does not alter Shiprocket, Shopify, or Meta tables.

-- ============================================================
-- Property metadata (no credentials)
-- ============================================================

create table if not exists data_pipeline.ga4_properties (
  property_id text primary key,
  display_name text,
  reporting_timezone text,
  currency_code text,
  last_verified_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Sync metadata
-- ============================================================

create table if not exists data_pipeline.ga4_sync_runs (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  dataset text not null
    check (dataset in ('daily', 'channel', 'utm')),
  mode text not null
    check (mode in ('test', 'recent', 'backfill', 'repair', 'connection_test')),
  status text not null
    check (status in ('running', 'success', 'partial', 'failed')),
  requested_from date,
  requested_to date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  base_rows_fetched integer not null default 0,
  ecommerce_rows_fetched integer not null default 0,
  rows_upserted integer not null default 0,
  api_requests integer not null default 0,
  pages_fetched integer not null default 0,
  retry_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now()
);

create table if not exists data_pipeline.ga4_sync_errors (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null
    references data_pipeline.ga4_sync_runs(id) on delete cascade,
  dataset text,
  operation text,
  error_code text,
  error_message text,
  retryable boolean not null default false,
  attempt integer,
  created_at timestamptz not null default now()
);

create table if not exists data_pipeline.ga4_sync_state (
  property_id text not null,
  dataset text not null
    check (dataset in ('daily', 'channel', 'utm')),
  last_successful_sync_at timestamptz,
  last_successful_from date,
  last_successful_to date,
  last_backfill_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, dataset)
);

create table if not exists data_pipeline.ga4_sync_locks (
  property_id text not null,
  dataset text not null
    check (dataset in ('daily', 'channel', 'utm')),
  lock_token uuid not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  mode text,
  primary key (property_id, dataset)
);

create table if not exists data_pipeline.ga4_backfill_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  dataset text not null
    check (dataset in ('daily', 'channel', 'utm')),
  requested_from date not null,
  requested_to date not null,
  chunk_days integer not null,
  next_chunk_start date,
  status text not null
    check (status in ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Facts
-- ============================================================

create table if not exists data_pipeline.ga4_daily (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  date date not null,
  sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_rate numeric,
  bounce_rate numeric,
  users bigint not null default 0,
  new_users bigint not null default 0,
  views bigint not null default 0,
  add_to_carts bigint not null default 0,
  items_added_to_cart bigint not null default 0,
  begin_checkout bigint not null default 0,
  purchases numeric not null default 0,
  revenue numeric(20, 4) not null default 0,
  last_synced_at timestamptz not null default now(),
  last_sync_run_id uuid
    references data_pipeline.ga4_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, date)
);

create table if not exists data_pipeline.ga4_channel_daily (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  date date not null,
  channel text not null,
  sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_rate numeric,
  bounce_rate numeric,
  users bigint not null default 0,
  new_users bigint not null default 0,
  views bigint not null default 0,
  add_to_carts bigint not null default 0,
  items_added_to_cart bigint not null default 0,
  begin_checkout bigint not null default 0,
  purchases numeric not null default 0,
  revenue numeric(20, 4) not null default 0,
  last_synced_at timestamptz not null default now(),
  last_sync_run_id uuid
    references data_pipeline.ga4_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, date, channel)
);

create table if not exists data_pipeline.ga4_utm_daily (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  date date not null,
  utm_key text not null,
  utm_source text not null,
  utm_campaign text not null,
  utm_medium text not null,
  utm_content text not null,
  sessions bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_rate numeric,
  bounce_rate numeric,
  users bigint not null default 0,
  new_users bigint not null default 0,
  views bigint not null default 0,
  add_to_carts bigint not null default 0,
  items_added_to_cart bigint not null default 0,
  begin_checkout bigint not null default 0,
  purchases numeric not null default 0,
  revenue numeric(20, 4) not null default 0,
  last_synced_at timestamptz not null default now(),
  last_sync_run_id uuid
    references data_pipeline.ga4_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, date, utm_source, utm_campaign, utm_medium, utm_content)
);

-- ============================================================
-- updated_at triggers (reuse existing helper)
-- ============================================================

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'ga4_properties',
    'ga4_sync_state',
    'ga4_backfill_jobs',
    'ga4_daily',
    'ga4_channel_daily',
    'ga4_utm_daily'
  ]
  loop
    if not exists (
      select 1 from pg_trigger
      where tgname = 'trg_' || tbl || '_updated_at'
    ) then
      execute format(
        'create trigger trg_%I_updated_at
           before update on data_pipeline.%I
           for each row
           execute function data_pipeline.set_updated_at()',
        tbl,
        tbl
      );
    end if;
  end loop;
end;
$$;

-- ============================================================
-- Sync lock helpers (row-based; isolated from Shopify/Meta)
-- ============================================================

create or replace function data_pipeline.try_acquire_ga4_sync_lock(
  p_property_id text,
  p_dataset text,
  p_mode text default 'recent',
  p_ttl_seconds integer default 900
) returns uuid
language plpgsql
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  delete from data_pipeline.ga4_sync_locks
  where property_id = p_property_id
    and dataset = p_dataset
    and expires_at < now();

  insert into data_pipeline.ga4_sync_locks (
    property_id, dataset, lock_token, locked_at, expires_at, mode
  ) values (
    p_property_id, p_dataset, v_token, now(), now() + make_interval(secs => p_ttl_seconds), p_mode
  );

  return v_token;
exception
  when unique_violation then
    return null;
end;
$$;

create or replace function data_pipeline.release_ga4_sync_lock(
  p_property_id text,
  p_dataset text,
  p_lock_token uuid
) returns boolean
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from data_pipeline.ga4_sync_locks
  where property_id = p_property_id
    and dataset = p_dataset
    and lock_token = p_lock_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
