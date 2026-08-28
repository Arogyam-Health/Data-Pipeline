-- 019_ga4_indexes_security.sql
-- Indexes, RLS, and grants for GA4 tables.
-- Portable: no project IDs, no URLs, no credentials.
-- Does not weaken Shiprocket, Shopify, or Meta RLS.

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_ga4_daily_property_date
  on data_pipeline.ga4_daily (property_id, date);

create index if not exists idx_ga4_channel_property_date
  on data_pipeline.ga4_channel_daily (property_id, date);

create index if not exists idx_ga4_channel_property_channel_date
  on data_pipeline.ga4_channel_daily (property_id, channel, date);

create index if not exists idx_ga4_channel_channel_date
  on data_pipeline.ga4_channel_daily (channel, date);

create index if not exists idx_ga4_utm_property_date
  on data_pipeline.ga4_utm_daily (property_id, date);

create index if not exists idx_ga4_utm_property_source_date
  on data_pipeline.ga4_utm_daily (property_id, utm_source, date);

create index if not exists idx_ga4_utm_property_campaign_date
  on data_pipeline.ga4_utm_daily (property_id, utm_campaign, date);

create index if not exists idx_ga4_utm_property_medium_date
  on data_pipeline.ga4_utm_daily (property_id, utm_medium, date);

create index if not exists idx_ga4_utm_source_campaign_date
  on data_pipeline.ga4_utm_daily (property_id, utm_source, utm_campaign, date);

create index if not exists idx_ga4_sync_runs_started_at
  on data_pipeline.ga4_sync_runs (started_at);

create index if not exists idx_ga4_sync_runs_status
  on data_pipeline.ga4_sync_runs (status);

create index if not exists idx_ga4_sync_runs_dataset
  on data_pipeline.ga4_sync_runs (dataset);

create index if not exists idx_ga4_sync_runs_property_dataset
  on data_pipeline.ga4_sync_runs (property_id, dataset, started_at desc);

create index if not exists idx_ga4_sync_errors_run_id
  on data_pipeline.ga4_sync_errors (sync_run_id);

create index if not exists idx_ga4_backfill_property_dataset_status
  on data_pipeline.ga4_backfill_jobs (property_id, dataset, status);

create index if not exists idx_ga4_backfill_status
  on data_pipeline.ga4_backfill_jobs (status);

-- ============================================================
-- RLS — service_role only (defense-in-depth)
-- ============================================================

alter table data_pipeline.ga4_properties enable row level security;
alter table data_pipeline.ga4_sync_runs enable row level security;
alter table data_pipeline.ga4_sync_errors enable row level security;
alter table data_pipeline.ga4_sync_state enable row level security;
alter table data_pipeline.ga4_sync_locks enable row level security;
alter table data_pipeline.ga4_backfill_jobs enable row level security;
alter table data_pipeline.ga4_daily enable row level security;
alter table data_pipeline.ga4_channel_daily enable row level security;
alter table data_pipeline.ga4_utm_daily enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'ga4_properties',
    'ga4_sync_runs',
    'ga4_sync_errors',
    'ga4_sync_state',
    'ga4_sync_locks',
    'ga4_backfill_jobs',
    'ga4_daily',
    'ga4_channel_daily',
    'ga4_utm_daily'
  ]
  loop
    execute format(
      'drop policy if exists %I on data_pipeline.%I',
      'Service role can do everything on ' || tbl,
      tbl
    );
    execute format(
      $policy$
      create policy %I
        on data_pipeline.%I
        for all
        using (current_setting('request.jwt.claim.role', true) = 'service_role')
        with check (current_setting('request.jwt.claim.role', true) = 'service_role')
      $policy$,
      'Service role can do everything on ' || tbl,
      tbl
    );
  end loop;
end;
$$;

revoke all on data_pipeline.ga4_properties from anon, authenticated;
revoke all on data_pipeline.ga4_sync_runs from anon, authenticated;
revoke all on data_pipeline.ga4_sync_errors from anon, authenticated;
revoke all on data_pipeline.ga4_sync_state from anon, authenticated;
revoke all on data_pipeline.ga4_sync_locks from anon, authenticated;
revoke all on data_pipeline.ga4_backfill_jobs from anon, authenticated;
revoke all on data_pipeline.ga4_daily from anon, authenticated;
revoke all on data_pipeline.ga4_channel_daily from anon, authenticated;
revoke all on data_pipeline.ga4_utm_daily from anon, authenticated;

grant all on data_pipeline.ga4_properties to service_role;
grant all on data_pipeline.ga4_sync_runs to service_role;
grant all on data_pipeline.ga4_sync_errors to service_role;
grant all on data_pipeline.ga4_sync_state to service_role;
grant all on data_pipeline.ga4_sync_locks to service_role;
grant all on data_pipeline.ga4_backfill_jobs to service_role;
grant all on data_pipeline.ga4_daily to service_role;
grant all on data_pipeline.ga4_channel_daily to service_role;
grant all on data_pipeline.ga4_utm_daily to service_role;

grant execute on function data_pipeline.try_acquire_ga4_sync_lock(text, text, text, integer) to service_role;
grant execute on function data_pipeline.release_ga4_sync_lock(text, text, uuid) to service_role;
