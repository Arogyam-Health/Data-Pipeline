-- 001_data_pipeline_schema.sql
-- Creates the data_pipeline schema and shared integration_events table.
-- Portable: no project IDs, no URLs, no credentials.

-- Create dedicated schema
create schema if not exists data_pipeline;

-- ============================================================
-- Generic integration events table
-- ============================================================
create table if not exists data_pipeline.integration_events (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  event_type      text,
  request_hash    text not null,
  payload         jsonb not null,
  request_headers jsonb,
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'processed', 'failed', 'dead_letter')),
  attempt_count   integer not null default 0,
  last_error      text,
  received_at     timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Uniqueness: prevent exact duplicate webhook requests
create unique index if not exists idx_integration_events_provider_hash
  on data_pipeline.integration_events (provider, request_hash);

-- Fast lookups by status for queue workers
create index if not exists idx_integration_events_status
  on data_pipeline.integration_events (status);

create index if not exists idx_integration_events_provider_status
  on data_pipeline.integration_events (provider, status);

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================
create or replace function data_pipeline.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Attach trigger to integration_events (safe to re-run)
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_integration_events_updated_at'
  ) then
    create trigger trg_integration_events_updated_at
      before update on data_pipeline.integration_events
      for each row
      execute function data_pipeline.set_updated_at();
  end if;
end;
$$;
