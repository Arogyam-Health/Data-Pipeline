-- 020_ga4_analytics.sql
-- GA4 analytics views for the Next.js dashboard and Metabase.
-- Does NOT alter existing analytics.shiprocket_*, shopify_*, or meta_* views.
-- Portable: no project IDs, no URLs, no credentials.

create schema if not exists analytics;

-- Canonical daily grain
create or replace view analytics.ga4_daily as
select
  d.property_id,
  d.date,
  d.sessions,
  d.engaged_sessions,
  case
    when coalesce(d.sessions, 0) > 0
    then d.engaged_sessions::numeric / d.sessions
    else null
  end as engagement_rate,
  case
    when coalesce(d.sessions, 0) > 0
    then 1 - (d.engaged_sessions::numeric / d.sessions)
    else null
  end as bounce_rate,
  d.users,
  d.new_users,
  d.views,
  d.add_to_carts,
  d.items_added_to_cart,
  d.begin_checkout,
  d.purchases,
  d.revenue,
  p.reporting_timezone,
  p.currency_code,
  d.last_synced_at
from data_pipeline.ga4_daily d
left join data_pipeline.ga4_properties p
  on p.property_id = d.property_id;

create or replace view analytics.ga4_channel_daily as
select
  d.property_id,
  d.date,
  d.channel,
  d.sessions,
  d.engaged_sessions,
  case
    when coalesce(d.sessions, 0) > 0
    then d.engaged_sessions::numeric / d.sessions
    else null
  end as engagement_rate,
  case
    when coalesce(d.sessions, 0) > 0
    then 1 - (d.engaged_sessions::numeric / d.sessions)
    else null
  end as bounce_rate,
  d.users,
  d.new_users,
  d.views,
  d.add_to_carts,
  d.items_added_to_cart,
  d.begin_checkout,
  d.purchases,
  d.revenue,
  case
    when coalesce(d.sessions, 0) > 0
    then d.purchases / d.sessions
    else null
  end as purchase_conversion_rate,
  case
    when coalesce(d.sessions, 0) > 0
    then d.revenue / d.sessions
    else null
  end as revenue_per_session,
  case
    when coalesce(d.users, 0) > 0
    then d.revenue / d.users
    else null
  end as revenue_per_user,
  p.reporting_timezone,
  p.currency_code,
  d.last_synced_at
from data_pipeline.ga4_channel_daily d
left join data_pipeline.ga4_properties p
  on p.property_id = d.property_id;

create or replace view analytics.ga4_utm_daily as
select
  d.property_id,
  d.date,
  d.utm_key,
  d.utm_source,
  d.utm_campaign,
  d.utm_medium,
  d.utm_content,
  d.sessions,
  d.engaged_sessions,
  case
    when coalesce(d.sessions, 0) > 0
    then d.engaged_sessions::numeric / d.sessions
    else null
  end as engagement_rate,
  case
    when coalesce(d.sessions, 0) > 0
    then 1 - (d.engaged_sessions::numeric / d.sessions)
    else null
  end as bounce_rate,
  d.users,
  d.new_users,
  d.views,
  d.add_to_carts,
  d.items_added_to_cart,
  d.begin_checkout,
  d.purchases,
  d.revenue,
  case
    when coalesce(d.sessions, 0) > 0
    then d.purchases / d.sessions
    else null
  end as purchase_conversion_rate,
  case
    when coalesce(d.sessions, 0) > 0
    then d.revenue / d.sessions
    else null
  end as revenue_per_session,
  p.reporting_timezone,
  p.currency_code,
  d.last_synced_at
from data_pipeline.ga4_utm_daily d
left join data_pipeline.ga4_properties p
  on p.property_id = d.property_id;

-- Aggregated overview (never AVG of stored rates)
create or replace view analytics.ga4_overview as
select
  d.property_id,
  coalesce(sum(d.sessions), 0) as sessions,
  coalesce(sum(d.engaged_sessions), 0) as engaged_sessions,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.engaged_sessions)::numeric / sum(d.sessions)
    else null
  end as engagement_rate,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then 1 - (sum(d.engaged_sessions)::numeric / sum(d.sessions))
    else null
  end as bounce_rate,
  coalesce(sum(d.users), 0) as users,
  coalesce(sum(d.new_users), 0) as new_users,
  coalesce(sum(d.views), 0) as views,
  coalesce(sum(d.add_to_carts), 0) as add_to_carts,
  coalesce(sum(d.items_added_to_cart), 0) as items_added_to_cart,
  coalesce(sum(d.begin_checkout), 0) as begin_checkout,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.revenue), 0) as revenue
from data_pipeline.ga4_daily d
group by d.property_id;

create or replace view analytics.ga4_channel_performance as
select
  d.property_id,
  d.channel,
  coalesce(sum(d.sessions), 0) as sessions,
  coalesce(sum(d.engaged_sessions), 0) as engaged_sessions,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.engaged_sessions)::numeric / sum(d.sessions)
    else null
  end as engagement_rate,
  coalesce(sum(d.users), 0) as users,
  coalesce(sum(d.new_users), 0) as new_users,
  coalesce(sum(d.views), 0) as views,
  coalesce(sum(d.add_to_carts), 0) as add_to_carts,
  coalesce(sum(d.items_added_to_cart), 0) as items_added_to_cart,
  coalesce(sum(d.begin_checkout), 0) as begin_checkout,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.revenue), 0) as revenue,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.purchases) / sum(d.sessions)
    else null
  end as purchase_conversion_rate,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.revenue) / sum(d.sessions)
    else null
  end as revenue_per_session,
  case
    when coalesce(sum(d.users), 0) > 0
    then sum(d.revenue) / sum(d.users)
    else null
  end as revenue_per_user
from data_pipeline.ga4_channel_daily d
group by d.property_id, d.channel;

create or replace view analytics.ga4_utm_performance as
select
  d.property_id,
  d.utm_source,
  d.utm_campaign,
  d.utm_medium,
  d.utm_content,
  coalesce(sum(d.sessions), 0) as sessions,
  coalesce(sum(d.engaged_sessions), 0) as engaged_sessions,
  coalesce(sum(d.users), 0) as users,
  coalesce(sum(d.new_users), 0) as new_users,
  coalesce(sum(d.views), 0) as views,
  coalesce(sum(d.add_to_carts), 0) as add_to_carts,
  coalesce(sum(d.begin_checkout), 0) as begin_checkout,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.revenue), 0) as revenue,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.purchases) / sum(d.sessions)
    else null
  end as purchase_conversion_rate,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.revenue) / sum(d.sessions)
    else null
  end as revenue_per_session
from data_pipeline.ga4_utm_daily d
group by d.property_id, d.utm_source, d.utm_campaign, d.utm_medium, d.utm_content;

create or replace view analytics.ga4_funnel as
select
  d.property_id,
  coalesce(sum(d.sessions), 0) as sessions,
  coalesce(sum(d.engaged_sessions), 0) as engaged_sessions,
  coalesce(sum(d.views), 0) as views,
  coalesce(sum(d.add_to_carts), 0) as add_to_carts,
  coalesce(sum(d.begin_checkout), 0) as begin_checkout,
  coalesce(sum(d.purchases), 0) as purchases,
  coalesce(sum(d.revenue), 0) as revenue,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.engaged_sessions)::numeric / sum(d.sessions)
    else null
  end as engagement_rate,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.add_to_carts)::numeric / sum(d.sessions)
    else null
  end as atc_per_session,
  case
    when coalesce(sum(d.add_to_carts), 0) > 0
    then sum(d.begin_checkout)::numeric / sum(d.add_to_carts)
    else null
  end as checkout_per_atc,
  case
    when coalesce(sum(d.begin_checkout), 0) > 0
    then sum(d.purchases) / sum(d.begin_checkout)
    else null
  end as purchase_per_checkout,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.purchases) / sum(d.sessions)
    else null
  end as purchase_per_session,
  case
    when coalesce(sum(d.sessions), 0) > 0
    then sum(d.revenue) / sum(d.sessions)
    else null
  end as revenue_per_session,
  case
    when coalesce(sum(d.purchases), 0) > 0
    then sum(d.revenue) / sum(d.purchases)
    else null
  end as avg_revenue_per_purchase
from data_pipeline.ga4_daily d
group by d.property_id;

create or replace view analytics.ga4_sync_health as
select
  s.property_id,
  s.dataset,
  s.last_successful_sync_at,
  s.last_successful_from,
  s.last_successful_to,
  s.last_backfill_completed_at,
  r.status as last_status,
  r.mode as last_mode,
  r.base_rows_fetched as last_base_rows_fetched,
  r.ecommerce_rows_fetched as last_ecommerce_rows_fetched,
  r.rows_upserted as last_rows_upserted,
  r.api_requests as last_api_requests,
  r.pages_fetched as last_pages_fetched,
  r.retry_count as last_retry_count,
  r.last_error_code,
  r.last_error_message,
  extract(epoch from (r.finished_at - r.started_at)) as last_duration_seconds,
  b.status as backfill_status,
  b.next_chunk_start as backfill_next_chunk_start,
  b.requested_from as backfill_requested_from,
  b.requested_to as backfill_requested_to
from data_pipeline.ga4_sync_state s
left join lateral (
  select *
  from data_pipeline.ga4_sync_runs run
  where run.property_id = s.property_id
    and run.dataset = s.dataset
  order by run.started_at desc
  limit 1
) r on true
left join lateral (
  select *
  from data_pipeline.ga4_backfill_jobs job
  where job.property_id = s.property_id
    and job.dataset = s.dataset
  order by job.updated_at desc
  limit 1
) b on true;

-- Legacy Google Sheet column parity (validation / comparison only).
create or replace view analytics.ga4_daily_sheet_parity as
select
  d.date as "Date",
  d.sessions as "Sessions",
  d.engaged_sessions as "Engaged Sessions",
  case
    when coalesce(d.sessions, 0) > 0
    then d.engaged_sessions::numeric / d.sessions
    else null
  end as "Engagement Rate",
  case
    when coalesce(d.sessions, 0) > 0
    then 1 - (d.engaged_sessions::numeric / d.sessions)
    else null
  end as "Bounce Rate",
  d.users as "Users",
  d.new_users as "New Users",
  d.views as "Views",
  d.add_to_carts as "Add To Cart",
  d.items_added_to_cart as "Items Added To Cart",
  d.begin_checkout as "Begin Checkout",
  d.purchases as "Purchases",
  d.revenue as "Revenue"
from data_pipeline.ga4_daily d;

create or replace view analytics.ga4_channel_sheet_parity as
select
  d.date as "Date",
  d.channel as "Channel",
  d.sessions as "Sessions",
  d.engaged_sessions as "Engaged Sessions",
  case
    when coalesce(d.sessions, 0) > 0
    then d.engaged_sessions::numeric / d.sessions
    else null
  end as "Engagement Rate",
  case
    when coalesce(d.sessions, 0) > 0
    then 1 - (d.engaged_sessions::numeric / d.sessions)
    else null
  end as "Bounce Rate",
  d.users as "Users",
  d.new_users as "New Users",
  d.views as "Views",
  d.add_to_carts as "Add To Cart",
  d.items_added_to_cart as "Items Added To Cart",
  d.begin_checkout as "Begin Checkout",
  d.purchases as "Purchases",
  d.revenue as "Revenue"
from data_pipeline.ga4_channel_daily d;

create or replace view analytics.ga4_utm_sheet_parity as
select
  d.date as "Date",
  d.utm_key as "UTM Key",
  d.utm_source as "UTM Source",
  d.utm_campaign as "UTM Campaign",
  d.utm_medium as "UTM Medium",
  d.utm_content as "UTM Content",
  d.sessions as "Sessions",
  d.engaged_sessions as "Engaged Sessions",
  case
    when coalesce(d.sessions, 0) > 0
    then d.engaged_sessions::numeric / d.sessions
    else null
  end as "Engagement Rate",
  case
    when coalesce(d.sessions, 0) > 0
    then 1 - (d.engaged_sessions::numeric / d.sessions)
    else null
  end as "Bounce Rate",
  d.users as "Users",
  d.new_users as "New Users",
  d.views as "Views",
  d.add_to_carts as "Add To Cart",
  d.items_added_to_cart as "Items Added To Cart",
  d.begin_checkout as "Begin Checkout",
  d.purchases as "Purchases",
  d.revenue as "Revenue"
from data_pipeline.ga4_utm_daily d;

grant usage on schema analytics to service_role;
grant usage on schema analytics to authenticated;

grant select on analytics.ga4_daily to service_role, authenticated;
grant select on analytics.ga4_channel_daily to service_role, authenticated;
grant select on analytics.ga4_utm_daily to service_role, authenticated;
grant select on analytics.ga4_overview to service_role, authenticated;
grant select on analytics.ga4_channel_performance to service_role, authenticated;
grant select on analytics.ga4_utm_performance to service_role, authenticated;
grant select on analytics.ga4_funnel to service_role, authenticated;
grant select on analytics.ga4_sync_health to service_role, authenticated;
grant select on analytics.ga4_daily_sheet_parity to service_role, authenticated;
grant select on analytics.ga4_channel_sheet_parity to service_role, authenticated;
grant select on analytics.ga4_utm_sheet_parity to service_role, authenticated;
