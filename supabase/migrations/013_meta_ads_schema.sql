-- 013_meta_ads_schema.sql
-- Isolated Meta Ads canonical tables under data_pipeline.
-- Portable: no project IDs, no URLs, no credentials, no access tokens.
-- Does not alter Shiprocket or Shopify tables.

-- ============================================================
-- Sync metadata
-- ============================================================

create table if not exists data_pipeline.meta_sync_state (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null unique,
  last_successful_today_sync_at timestamptz,
  last_successful_recent_repair_at timestamptz,
  last_backfill_completed_at timestamptz,
  last_attempted_sync_at timestamptz,
  account_timezone text,
  account_currency text,
  api_version text,
  last_warning text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  mode text not null
    check (mode in (
      'test',
      'today',
      'recent_repair',
      'backfill',
      'repair',
      'metadata',
      'breakdown'
    )),
  status text not null
    check (status in ('running', 'success', 'partial', 'failed')),
  requested_from date,
  requested_to date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_fetched integer not null default 0,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  actions_upserted integer not null default 0,
  action_values_upserted integer not null default 0,
  api_requests integer not null default 0,
  pages_fetched integer not null default 0,
  retry_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  last_warning text,
  created_at timestamptz not null default now()
);

create table if not exists data_pipeline.meta_sync_locks (
  ad_account_id text primary key,
  lock_token uuid not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  mode text
);

create table if not exists data_pipeline.meta_sync_errors (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null
    references data_pipeline.meta_sync_runs(id) on delete cascade,
  entity_type text,
  entity_id text,
  operation text,
  error_code text,
  error_message text,
  retryable boolean not null default false,
  attempt integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists data_pipeline.meta_backfill_jobs (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  requested_from date not null,
  requested_to date not null,
  chunk_days integer not null,
  next_chunk_start date,
  status text not null
    check (status in ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Account + dimensions
-- ============================================================

create table if not exists data_pipeline.meta_ad_accounts (
  ad_account_id text primary key,
  account_name text,
  currency text,
  timezone_name text,
  timezone_offset_hours numeric,
  account_status text,
  business_name text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.meta_campaigns (
  campaign_id text primary key,
  ad_account_id text not null
    references data_pipeline.meta_ad_accounts(ad_account_id),
  name text,
  objective text,
  status text,
  effective_status text,
  buying_type text,
  special_ad_categories text[],
  start_time timestamptz,
  stop_time timestamptz,
  created_time timestamptz,
  updated_time timestamptz,
  daily_budget numeric,
  lifetime_budget numeric,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.meta_adsets (
  adset_id text primary key,
  campaign_id text not null
    references data_pipeline.meta_campaigns(campaign_id),
  ad_account_id text not null,
  name text,
  status text,
  effective_status text,
  optimization_goal text,
  billing_event text,
  bid_strategy text,
  daily_budget numeric,
  lifetime_budget numeric,
  start_time timestamptz,
  end_time timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.meta_creatives (
  creative_id text primary key,
  ad_account_id text not null,
  name text,
  title text,
  body text,
  call_to_action_type text,
  thumbnail_url text,
  image_url text,
  video_id text,
  instagram_actor_id text,
  page_id text,
  destination_url text,
  url_tags text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.meta_ads (
  ad_id text primary key,
  adset_id text not null
    references data_pipeline.meta_adsets(adset_id),
  campaign_id text not null,
  ad_account_id text not null,
  name text,
  status text,
  effective_status text,
  creative_id text
    references data_pipeline.meta_creatives(creative_id),
  created_time timestamptz,
  updated_time timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Core fact — one ad on one date (plus ad account)
-- Performance ingestion does not require completed metadata sync.
-- Facts have no FK to dimensions so Insights can persist first.
-- ============================================================

create table if not exists data_pipeline.meta_ads_daily (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  date date not null,
  campaign_id text not null,
  campaign_name text,
  adset_id text not null,
  adset_name text,
  ad_id text not null,
  ad_name text,
  objective text,
  spend numeric(16, 4),
  impressions bigint,
  reach bigint,
  frequency numeric,
  clicks bigint,
  inline_link_clicks bigint,
  inline_link_click_ctr numeric,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  cost_per_inline_link_click numeric,
  landing_page_views numeric,
  adds_to_cart numeric,
  checkouts_initiated numeric,
  checkouts_initiated_value numeric,
  purchases numeric,
  purchase_value numeric,
  website_purchases numeric,
  messaging_conversations_started numeric,
  registrations_completed numeric,
  purchase_roas numeric,
  website_purchase_roas numeric,
  instant_experience_view_percentage numeric,
  video_avg_play_time numeric,
  video_plays_25 numeric,
  video_plays_50 numeric,
  video_plays_75 numeric,
  video_plays_95 numeric,
  video_plays_100 numeric,
  video_plays numeric,
  thruplays numeric,
  cost_per_thruplay numeric,
  unique_clicks bigint,
  unique_ctr numeric,
  cost_per_unique_click numeric,
  outbound_clicks numeric,
  outbound_clicks_ctr numeric,
  unique_outbound_clicks numeric,
  unique_outbound_clicks_ctr numeric,
  quality_ranking text,
  engagement_rate_ranking text,
  conversion_rate_ranking text,
  post_engagement numeric,
  page_engagement numeric,
  last_synced_at timestamptz,
  last_sync_run_id uuid
    references data_pipeline.meta_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_account_id, date, campaign_id, adset_id, ad_id)
);

create table if not exists data_pipeline.meta_ads_actions_daily (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  date date not null,
  campaign_id text not null,
  adset_id text not null,
  ad_id text not null,
  action_type text not null,
  value numeric,
  last_synced_at timestamptz,
  sync_run_id uuid
    references data_pipeline.meta_sync_runs(id),
  created_at timestamptz not null default now(),
  unique (ad_account_id, date, campaign_id, adset_id, ad_id, action_type)
);

create table if not exists data_pipeline.meta_ads_action_values_daily (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  date date not null,
  campaign_id text not null,
  adset_id text not null,
  ad_id text not null,
  action_type text not null,
  conversion_value numeric,
  last_synced_at timestamptz,
  sync_run_id uuid
    references data_pipeline.meta_sync_runs(id),
  created_at timestamptz not null default now(),
  unique (ad_account_id, date, campaign_id, adset_id, ad_id, action_type)
);

-- ============================================================
-- Optional breakdown facts (different grains from meta_ads_daily)
-- ============================================================

create table if not exists data_pipeline.meta_ads_placement_daily (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  date date not null,
  campaign_id text not null,
  adset_id text not null,
  ad_id text not null,
  publisher_platform text not null,
  platform_position text not null,
  spend numeric(16, 4),
  impressions bigint,
  reach bigint,
  clicks bigint,
  link_clicks bigint,
  purchases numeric,
  purchase_value numeric,
  last_synced_at timestamptz,
  last_sync_run_id uuid
    references data_pipeline.meta_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    ad_account_id,
    date,
    campaign_id,
    adset_id,
    ad_id,
    publisher_platform,
    platform_position
  )
);

create table if not exists data_pipeline.meta_ads_device_daily (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  date date not null,
  campaign_id text not null,
  adset_id text not null,
  ad_id text not null,
  impression_device text not null,
  spend numeric(16, 4),
  impressions bigint,
  clicks bigint,
  link_clicks bigint,
  purchases numeric,
  purchase_value numeric,
  last_synced_at timestamptz,
  last_sync_run_id uuid
    references data_pipeline.meta_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    ad_account_id,
    date,
    campaign_id,
    adset_id,
    ad_id,
    impression_device
  )
);

create table if not exists data_pipeline.meta_ads_demographic_daily (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  date date not null,
  campaign_id text not null,
  adset_id text not null,
  ad_id text not null,
  age text not null,
  gender text not null,
  spend numeric(16, 4),
  impressions bigint,
  clicks bigint,
  link_clicks bigint,
  purchases numeric,
  purchase_value numeric,
  last_synced_at timestamptz,
  last_sync_run_id uuid
    references data_pipeline.meta_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    ad_account_id,
    date,
    campaign_id,
    adset_id,
    ad_id,
    age,
    gender
  )
);

create table if not exists data_pipeline.meta_ads_geo_daily (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  date date not null,
  campaign_id text not null,
  adset_id text not null,
  ad_id text not null,
  country text not null,
  region text,
  spend numeric(16, 4),
  impressions bigint,
  clicks bigint,
  link_clicks bigint,
  purchases numeric,
  purchase_value numeric,
  last_synced_at timestamptz,
  last_sync_run_id uuid
    references data_pipeline.meta_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    ad_account_id,
    date,
    campaign_id,
    adset_id,
    ad_id,
    country,
    region
  )
);

-- ============================================================
-- Sync lock helpers (row-based; safe with connection pooling)
-- Isolated from Shopify lock functions.
-- ============================================================

create or replace function data_pipeline.try_acquire_meta_sync_lock(
  p_ad_account_id text,
  p_mode text default 'today',
  p_ttl_seconds integer default 900
) returns uuid
language plpgsql
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  delete from data_pipeline.meta_sync_locks
  where ad_account_id = p_ad_account_id
    and expires_at < now();

  insert into data_pipeline.meta_sync_locks (
    ad_account_id, lock_token, locked_at, expires_at, mode
  ) values (
    p_ad_account_id, v_token, now(), now() + make_interval(secs => p_ttl_seconds), p_mode
  );

  return v_token;
exception
  when unique_violation then
    return null;
end;
$$;

create or replace function data_pipeline.release_meta_sync_lock(
  p_ad_account_id text,
  p_lock_token uuid
) returns boolean
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from data_pipeline.meta_sync_locks
  where ad_account_id = p_ad_account_id
    and lock_token = p_lock_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
