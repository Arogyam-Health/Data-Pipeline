-- 021_ga4_dashboard_functions.sql
-- Date-range GA4 analytics functions. Aggregation stays in PostgreSQL.
-- Does not alter Shopify, Shiprocket, or Meta functions.
-- Portable: no project IDs, URLs, or secrets.
-- Engagement/bounce rates are derived from SUM(engaged_sessions)/SUM(sessions).
-- Never AVG(engagement_rate) or AVG(bounce_rate).

create or replace function analytics.ga4_overview_range(p_from date, p_to date)
returns table (
  sessions numeric,
  engaged_sessions numeric,
  engagement_rate numeric,
  bounce_rate numeric,
  users numeric,
  new_users numeric,
  views numeric,
  add_to_carts numeric,
  items_added_to_cart numeric,
  begin_checkout numeric,
  purchases numeric,
  revenue numeric
)
language sql
stable
as $$
  select
    coalesce(sum(d.sessions), 0),
    coalesce(sum(d.engaged_sessions), 0),
    case
      when coalesce(sum(d.sessions), 0) > 0
      then sum(d.engaged_sessions)::numeric / sum(d.sessions)
      else null
    end,
    case
      when coalesce(sum(d.sessions), 0) > 0
      then 1 - (sum(d.engaged_sessions)::numeric / sum(d.sessions))
      else null
    end,
    coalesce(sum(d.users), 0),
    coalesce(sum(d.new_users), 0),
    coalesce(sum(d.views), 0),
    coalesce(sum(d.add_to_carts), 0),
    coalesce(sum(d.items_added_to_cart), 0),
    coalesce(sum(d.begin_checkout), 0),
    coalesce(sum(d.purchases), 0),
    coalesce(sum(d.revenue), 0)
  from data_pipeline.ga4_daily d
  where d.date >= p_from
    and d.date <= p_to;
$$;

create or replace function analytics.ga4_daily_range(p_from date, p_to date)
returns table (
  date date,
  sessions numeric,
  users numeric,
  purchases numeric,
  revenue numeric,
  views numeric,
  engaged_sessions numeric
)
language sql
stable
as $$
  select
    d.date,
    coalesce(sum(d.sessions), 0),
    coalesce(sum(d.users), 0),
    coalesce(sum(d.purchases), 0),
    coalesce(sum(d.revenue), 0),
    coalesce(sum(d.views), 0),
    coalesce(sum(d.engaged_sessions), 0)
  from data_pipeline.ga4_daily d
  where d.date >= p_from
    and d.date <= p_to
  group by d.date
  order by d.date;
$$;

create or replace function analytics.ga4_funnel_range(p_from date, p_to date)
returns table (
  sessions numeric,
  engaged_sessions numeric,
  views numeric,
  add_to_carts numeric,
  begin_checkout numeric,
  purchases numeric,
  revenue numeric,
  engagement_rate numeric,
  atc_per_session numeric,
  checkout_per_atc numeric,
  purchase_per_checkout numeric,
  purchase_per_session numeric,
  revenue_per_session numeric,
  avg_revenue_per_purchase numeric
)
language sql
stable
as $$
  select
    coalesce(sum(d.sessions), 0),
    coalesce(sum(d.engaged_sessions), 0),
    coalesce(sum(d.views), 0),
    coalesce(sum(d.add_to_carts), 0),
    coalesce(sum(d.begin_checkout), 0),
    coalesce(sum(d.purchases), 0),
    coalesce(sum(d.revenue), 0),
    case
      when coalesce(sum(d.sessions), 0) > 0
      then sum(d.engaged_sessions)::numeric / sum(d.sessions)
      else null
    end,
    case
      when coalesce(sum(d.sessions), 0) > 0
      then sum(d.add_to_carts)::numeric / sum(d.sessions)
      else null
    end,
    case
      when coalesce(sum(d.add_to_carts), 0) > 0
      then sum(d.begin_checkout)::numeric / sum(d.add_to_carts)
      else null
    end,
    case
      when coalesce(sum(d.begin_checkout), 0) > 0
      then sum(d.purchases) / sum(d.begin_checkout)
      else null
    end,
    case
      when coalesce(sum(d.sessions), 0) > 0
      then sum(d.purchases) / sum(d.sessions)
      else null
    end,
    case
      when coalesce(sum(d.sessions), 0) > 0
      then sum(d.revenue) / sum(d.sessions)
      else null
    end,
    case
      when coalesce(sum(d.purchases), 0) > 0
      then sum(d.revenue) / sum(d.purchases)
      else null
    end
  from data_pipeline.ga4_daily d
  where d.date >= p_from
    and d.date <= p_to;
$$;

create or replace function analytics.ga4_channel_performance_range(
  p_from date,
  p_to date,
  p_channel text default null,
  p_sort text default 'revenue',
  p_dir text default 'desc',
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  channel text,
  sessions numeric,
  engaged_sessions numeric,
  engagement_rate numeric,
  users numeric,
  new_users numeric,
  views numeric,
  add_to_carts numeric,
  items_added_to_cart numeric,
  begin_checkout numeric,
  purchases numeric,
  revenue numeric,
  purchase_conversion_rate numeric,
  revenue_per_session numeric,
  revenue_per_user numeric
)
language sql
stable
as $$
  with aggregated as (
    select
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
    where d.date >= p_from
      and d.date <= p_to
      and (p_channel is null or p_channel = '' or d.channel = p_channel)
    group by d.channel
  )
  select *
  from aggregated
  order by
    case when p_dir = 'asc' then
      case p_sort
        when 'sessions' then sessions
        when 'users' then users
        when 'purchases' then purchases
        when 'conversion' then purchase_conversion_rate
        else revenue
      end
    end asc nulls last,
    case when p_dir <> 'asc' then
      case p_sort
        when 'sessions' then sessions
        when 'users' then users
        when 'purchases' then purchases
        when 'conversion' then purchase_conversion_rate
        else revenue
      end
    end desc nulls last,
    channel asc
  limit greatest(1, least(coalesce(p_limit, 100), 200))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function analytics.ga4_channel_performance_count(
  p_from date,
  p_to date,
  p_channel text default null
)
returns bigint
language sql
stable
as $$
  select count(*)::bigint
  from (
    select d.channel
    from data_pipeline.ga4_channel_daily d
    where d.date >= p_from
      and d.date <= p_to
      and (p_channel is null or p_channel = '' or d.channel = p_channel)
    group by d.channel
  ) grouped;
$$;

create or replace function analytics.ga4_utm_performance_range(
  p_from date,
  p_to date,
  p_source text default null,
  p_campaign text default null,
  p_medium text default null,
  p_content text default null,
  p_sort text default 'revenue',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  utm_source text,
  utm_campaign text,
  utm_medium text,
  utm_content text,
  sessions numeric,
  engaged_sessions numeric,
  users numeric,
  new_users numeric,
  views numeric,
  add_to_carts numeric,
  begin_checkout numeric,
  purchases numeric,
  revenue numeric,
  purchase_conversion_rate numeric,
  revenue_per_session numeric
)
language sql
stable
as $$
  with aggregated as (
    select
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
    where d.date >= p_from
      and d.date <= p_to
      and (p_source is null or p_source = '' or d.utm_source = p_source)
      and (p_campaign is null or p_campaign = '' or d.utm_campaign = p_campaign)
      and (p_medium is null or p_medium = '' or d.utm_medium = p_medium)
      and (p_content is null or p_content = '' or d.utm_content = p_content)
    group by d.utm_source, d.utm_campaign, d.utm_medium, d.utm_content
  )
  select *
  from aggregated
  order by
    case when p_dir = 'asc' then
      case p_sort
        when 'sessions' then sessions
        when 'users' then users
        when 'purchases' then purchases
        when 'conversion' then purchase_conversion_rate
        else revenue
      end
    end asc nulls last,
    case when p_dir <> 'asc' then
      case p_sort
        when 'sessions' then sessions
        when 'users' then users
        when 'purchases' then purchases
        when 'conversion' then purchase_conversion_rate
        else revenue
      end
    end desc nulls last,
    utm_source, utm_campaign, utm_medium, utm_content
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function analytics.ga4_utm_performance_count(
  p_from date,
  p_to date,
  p_source text default null,
  p_campaign text default null,
  p_medium text default null,
  p_content text default null
)
returns bigint
language sql
stable
as $$
  select count(*)::bigint
  from (
    select 1
    from data_pipeline.ga4_utm_daily d
    where d.date >= p_from
      and d.date <= p_to
      and (p_source is null or p_source = '' or d.utm_source = p_source)
      and (p_campaign is null or p_campaign = '' or d.utm_campaign = p_campaign)
      and (p_medium is null or p_medium = '' or d.utm_medium = p_medium)
      and (p_content is null or p_content = '' or d.utm_content = p_content)
    group by d.utm_source, d.utm_campaign, d.utm_medium, d.utm_content
  ) grouped;
$$;

create or replace function analytics.ga4_utm_filter_options(p_from date, p_to date)
returns table (
  kind text,
  value text
)
language sql
stable
as $$
  select distinct 'source'::text, d.utm_source
  from data_pipeline.ga4_utm_daily d
  where d.date >= p_from and d.date <= p_to
  union all
  select distinct 'campaign', d.utm_campaign
  from data_pipeline.ga4_utm_daily d
  where d.date >= p_from and d.date <= p_to
  union all
  select distinct 'medium', d.utm_medium
  from data_pipeline.ga4_utm_daily d
  where d.date >= p_from and d.date <= p_to
  union all
  select distinct 'content', d.utm_content
  from data_pipeline.ga4_utm_daily d
  where d.date >= p_from and d.date <= p_to;
$$;

create or replace function analytics.ga4_channel_filter_options(p_from date, p_to date)
returns table (channel text)
language sql
stable
as $$
  select distinct d.channel
  from data_pipeline.ga4_channel_daily d
  where d.date >= p_from and d.date <= p_to
  order by 1;
$$;

grant execute on function analytics.ga4_overview_range(date, date) to service_role;
grant execute on function analytics.ga4_daily_range(date, date) to service_role;
grant execute on function analytics.ga4_funnel_range(date, date) to service_role;
grant execute on function analytics.ga4_channel_performance_range(date, date, text, text, text, integer, integer) to service_role;
grant execute on function analytics.ga4_channel_performance_count(date, date, text) to service_role;
grant execute on function analytics.ga4_utm_performance_range(date, date, text, text, text, text, text, text, integer, integer) to service_role;
grant execute on function analytics.ga4_utm_performance_count(date, date, text, text, text, text) to service_role;
grant execute on function analytics.ga4_utm_filter_options(date, date) to service_role;
grant execute on function analytics.ga4_channel_filter_options(date, date) to service_role;
