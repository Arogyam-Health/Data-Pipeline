-- 003_shiprocket_pabbly_deliveries.sql
-- Tracks Pabbly webhook delivery attempts for idempotency.
-- Portable: no project IDs, no URLs, no credentials.

create table if not exists data_pipeline.shiprocket_pabbly_deliveries (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references data_pipeline.integration_events(id),
  status            text not null default 'pending'
                    check (status in ('pending', 'sent', 'failed')),
  attempt_count     integer not null default 0,
  response_code     integer,
  response_body     jsonb,
  last_error        text,
  first_attempt_at  timestamptz,
  last_attempt_at   timestamptz,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One delivery record per event (idempotency)
create unique index if not exists idx_pabbly_deliveries_event_id
  on data_pipeline.shiprocket_pabbly_deliveries (event_id);

-- Lookup by status for retry processing
create index if not exists idx_pabbly_deliveries_status
  on data_pipeline.shiprocket_pabbly_deliveries (status);

-- Auto-update updated_at
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_pabbly_deliveries_updated_at'
  ) then
    create trigger trg_pabbly_deliveries_updated_at
      before update on data_pipeline.shiprocket_pabbly_deliveries
      for each row
      execute function data_pipeline.set_updated_at();
  end if;
end;
$$;
