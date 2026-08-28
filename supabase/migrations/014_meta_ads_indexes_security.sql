-- 014_meta_ads_indexes_security.sql
-- Indexes, RLS, and grants for Meta Ads tables.
-- Portable: no project IDs, no URLs, no credentials.
-- Does not weaken Shiprocket or Shopify RLS.

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_meta_ads_daily_date
  on data_pipeline.meta_ads_daily (date);

create index if not exists idx_meta_ads_daily_account_date
  on data_pipeline.meta_ads_daily (ad_account_id, date);

create index if not exists idx_meta_ads_daily_campaign_date
  on data_pipeline.meta_ads_daily (campaign_id, date);

create index if not exists idx_meta_ads_daily_adset_date
  on data_pipeline.meta_ads_daily (adset_id, date);

create index if not exists idx_meta_ads_daily_ad_date
  on data_pipeline.meta_ads_daily (ad_id, date);

create index if not exists idx_meta_ads_daily_objective
  on data_pipeline.meta_ads_daily (objective);

create index if not exists idx_meta_ads_daily_last_synced
  on data_pipeline.meta_ads_daily (last_synced_at);

create index if not exists idx_meta_actions_ad_date
  on data_pipeline.meta_ads_actions_daily (ad_id, date);

create index if not exists idx_meta_actions_type_date
  on data_pipeline.meta_ads_actions_daily (action_type, date);

create index if not exists idx_meta_actions_type_campaign_date
  on data_pipeline.meta_ads_actions_daily (action_type, campaign_id, date);

create index if not exists idx_meta_action_values_type_date
  on data_pipeline.meta_ads_action_values_daily (action_type, date);

create index if not exists idx_meta_action_values_ad_date
  on data_pipeline.meta_ads_action_values_daily (ad_id, date);

create index if not exists idx_meta_campaigns_account
  on data_pipeline.meta_campaigns (ad_account_id);

create index if not exists idx_meta_campaigns_status
  on data_pipeline.meta_campaigns (effective_status);

create index if not exists idx_meta_adsets_campaign
  on data_pipeline.meta_adsets (campaign_id);

create index if not exists idx_meta_adsets_account
  on data_pipeline.meta_adsets (ad_account_id);

create index if not exists idx_meta_adsets_status
  on data_pipeline.meta_adsets (effective_status);

create index if not exists idx_meta_ads_adset
  on data_pipeline.meta_ads (adset_id);

create index if not exists idx_meta_ads_campaign
  on data_pipeline.meta_ads (campaign_id);

create index if not exists idx_meta_ads_creative
  on data_pipeline.meta_ads (creative_id);

create index if not exists idx_meta_ads_status
  on data_pipeline.meta_ads (effective_status);

create index if not exists idx_meta_creatives_account
  on data_pipeline.meta_creatives (ad_account_id);

create index if not exists idx_meta_placement_date
  on data_pipeline.meta_ads_placement_daily (date, publisher_platform, platform_position);

create index if not exists idx_meta_device_date
  on data_pipeline.meta_ads_device_daily (date, impression_device);

create index if not exists idx_meta_demographic_date
  on data_pipeline.meta_ads_demographic_daily (date, age, gender);

create index if not exists idx_meta_geo_date
  on data_pipeline.meta_ads_geo_daily (date, country);

create index if not exists idx_meta_sync_runs_started_at
  on data_pipeline.meta_sync_runs (started_at);

create index if not exists idx_meta_sync_runs_status
  on data_pipeline.meta_sync_runs (status);

create index if not exists idx_meta_sync_runs_mode
  on data_pipeline.meta_sync_runs (mode);

create index if not exists idx_meta_sync_errors_run_id
  on data_pipeline.meta_sync_errors (sync_run_id);

create index if not exists idx_meta_backfill_account_status
  on data_pipeline.meta_backfill_jobs (ad_account_id, status);

-- ============================================================
-- RLS — service_role only (defense-in-depth)
-- ============================================================

alter table data_pipeline.meta_sync_state enable row level security;
alter table data_pipeline.meta_sync_runs enable row level security;
alter table data_pipeline.meta_sync_locks enable row level security;
alter table data_pipeline.meta_sync_errors enable row level security;
alter table data_pipeline.meta_backfill_jobs enable row level security;
alter table data_pipeline.meta_ad_accounts enable row level security;
alter table data_pipeline.meta_campaigns enable row level security;
alter table data_pipeline.meta_adsets enable row level security;
alter table data_pipeline.meta_ads enable row level security;
alter table data_pipeline.meta_creatives enable row level security;
alter table data_pipeline.meta_ads_daily enable row level security;
alter table data_pipeline.meta_ads_actions_daily enable row level security;
alter table data_pipeline.meta_ads_action_values_daily enable row level security;
alter table data_pipeline.meta_ads_placement_daily enable row level security;
alter table data_pipeline.meta_ads_device_daily enable row level security;
alter table data_pipeline.meta_ads_demographic_daily enable row level security;
alter table data_pipeline.meta_ads_geo_daily enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'meta_sync_state',
    'meta_sync_runs',
    'meta_sync_locks',
    'meta_sync_errors',
    'meta_backfill_jobs',
    'meta_ad_accounts',
    'meta_campaigns',
    'meta_adsets',
    'meta_ads',
    'meta_creatives',
    'meta_ads_daily',
    'meta_ads_actions_daily',
    'meta_ads_action_values_daily',
    'meta_ads_placement_daily',
    'meta_ads_device_daily',
    'meta_ads_demographic_daily',
    'meta_ads_geo_daily'
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

revoke all on data_pipeline.meta_sync_state from anon, authenticated;
revoke all on data_pipeline.meta_sync_runs from anon, authenticated;
revoke all on data_pipeline.meta_sync_locks from anon, authenticated;
revoke all on data_pipeline.meta_sync_errors from anon, authenticated;
revoke all on data_pipeline.meta_backfill_jobs from anon, authenticated;
revoke all on data_pipeline.meta_ad_accounts from anon, authenticated;
revoke all on data_pipeline.meta_campaigns from anon, authenticated;
revoke all on data_pipeline.meta_adsets from anon, authenticated;
revoke all on data_pipeline.meta_ads from anon, authenticated;
revoke all on data_pipeline.meta_creatives from anon, authenticated;
revoke all on data_pipeline.meta_ads_daily from anon, authenticated;
revoke all on data_pipeline.meta_ads_actions_daily from anon, authenticated;
revoke all on data_pipeline.meta_ads_action_values_daily from anon, authenticated;
revoke all on data_pipeline.meta_ads_placement_daily from anon, authenticated;
revoke all on data_pipeline.meta_ads_device_daily from anon, authenticated;
revoke all on data_pipeline.meta_ads_demographic_daily from anon, authenticated;
revoke all on data_pipeline.meta_ads_geo_daily from anon, authenticated;

grant all on data_pipeline.meta_sync_state to service_role;
grant all on data_pipeline.meta_sync_runs to service_role;
grant all on data_pipeline.meta_sync_locks to service_role;
grant all on data_pipeline.meta_sync_errors to service_role;
grant all on data_pipeline.meta_backfill_jobs to service_role;
grant all on data_pipeline.meta_ad_accounts to service_role;
grant all on data_pipeline.meta_campaigns to service_role;
grant all on data_pipeline.meta_adsets to service_role;
grant all on data_pipeline.meta_ads to service_role;
grant all on data_pipeline.meta_creatives to service_role;
grant all on data_pipeline.meta_ads_daily to service_role;
grant all on data_pipeline.meta_ads_actions_daily to service_role;
grant all on data_pipeline.meta_ads_action_values_daily to service_role;
grant all on data_pipeline.meta_ads_placement_daily to service_role;
grant all on data_pipeline.meta_ads_device_daily to service_role;
grant all on data_pipeline.meta_ads_demographic_daily to service_role;
grant all on data_pipeline.meta_ads_geo_daily to service_role;

grant execute on function data_pipeline.try_acquire_meta_sync_lock(text, text, integer) to service_role;
grant execute on function data_pipeline.release_meta_sync_lock(text, uuid) to service_role;
