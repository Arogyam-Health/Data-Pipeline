-- 034_shopify_gokwik_analytics.sql
-- Expose GoKwik / marketing attribution fields stored as Shopify note_attributes
-- as typed analytics views + date-range functions for a dedicated GoKwik dashboard.
-- Portable: no project IDs, URLs, secrets.

create schema if not exists analytics;

-- Helper: pivot note_attributes for GoKwik marketing fields
-- Keys observed in Additional details: meta_fbc, meta_fbp, gokwik_cid, cart_token,
-- user_agent, full_url, customer_ip, deliver_order_count, Bank Offer Code,
-- gokwik_payment_id / GoKwik_Payment_ID, Payment_Provider_Name/ID, channel etc.
-- All lower() compared, spaces/normalized handled.

-- ============================================================
-- 1. Order-level GoKwik view (one row per order)
-- ============================================================
create or replace view analytics.shopify_gokwik_orders as
select
  o.shopify_order_id,
  o.order_name,
  o.order_number,
  o.created_at_shopify,
  o.updated_at_shopify,
  o.processed_at,
  o.financial_status,
  o.fulfillment_status,
  o.total_price,
  o.currency,
  o.note as notes_edd,
  o.landing_site,
  o.referring_site,
  o.source_name as channel_source_name,
  o.source_identifier,
  o.payment_gateway_names,
  c.display_name as customer_display_name,
  o.email,
  o.phone,
  sa.city as shipping_city,
  sa.province as shipping_province,
  -- UTMs (already in utm view, duplicated here for single-table convenience)
  max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_source') as utm_source,
  max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_medium') as utm_medium,
  max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_campaign') as utm_campaign,
  max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_content') as utm_content,
  max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_term') as utm_term,
  -- GoKwik / Meta attribution
  max(na.attribute_value) filter (where lower(na.attribute_name) = 'meta_fbc') as meta_fbc,
  max(na.attribute_value) filter (where lower(na.attribute_name) = 'meta_fbp') as meta_fbp,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('gokwik_cid','gokwik cid','gokwik_c_id')) as gokwik_cid,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('cart_token','cart token')) as cart_token,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('user_agent','user agent')) as user_agent,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('full_url','full url','landing_site','landing site')) as full_url,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('customer_ip','customer ip','client_ip','client ip')) as customer_ip,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('deliver_order_count','deliver order count')) as deliver_order_count,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('bank offer code','bank_offer_code','bankoffer')) as bank_offer_code,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('gokwik_payment_id','gokwik payment id','gokwikpaymentid','kwik_payment_id')) as gokwik_payment_id,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('payment_provider_name','payment provider name','payment_provider','provider_name')) as payment_provider_name_attr,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('payment_provider_payment_id','payment provider payment id','provider_payment_id')) as payment_provider_payment_id_attr,
  max(na.attribute_value) filter (where lower(na.attribute_name) in ('channel','channel information','channel_information')) as channel_information,
  -- most recent transaction for provider payment id fallback (payu etc)
  (select t.payment_id from data_pipeline.shopify_transactions t where t.shopify_order_id=o.shopify_order_id order by t.processed_at desc nulls last, t.created_at_shopify desc nulls last limit 1) as shopify_payment_id,
  (select t.gateway from data_pipeline.shopify_transactions t where t.shopify_order_id=o.shopify_order_id order by t.processed_at desc nulls last, t.created_at_shopify desc nulls last limit 1) as shopify_gateway
from data_pipeline.shopify_orders o
left join data_pipeline.shopify_customers c on c.customer_id=o.customer_id
left join data_pipeline.shopify_order_addresses sa on sa.shopify_order_id=o.shopify_order_id and sa.address_type='shipping'
left join data_pipeline.shopify_note_attributes na on na.shopify_order_id=o.shopify_order_id
group by
  o.shopify_order_id, o.order_name, o.order_number, o.created_at_shopify, o.updated_at_shopify, o.processed_at,
  o.financial_status, o.fulfillment_status, o.total_price, o.currency, o.note, o.landing_site, o.referring_site,
  o.source_name, o.source_identifier, o.payment_gateway_names, c.display_name, o.email, o.phone, sa.city, sa.province;

-- ============================================================
-- 2. Date-range function (reuses same pivot, filtered)
-- ============================================================
create or replace function analytics.shopify_gokwik_orders_for_range(p_from timestamptz, p_to timestamptz)
returns setof analytics.shopify_gokwik_orders
language sql
stable
as $$
  select * from analytics.shopify_gokwik_orders
  where created_at_shopify >= p_from and created_at_shopify <= p_to;
$$;

-- ============================================================
-- 3. KPI summary for GoKwik orders
-- ============================================================
create or replace view analytics.shopify_gokwik_kpis as
select
  count(*) as total_orders,
  count(*) filter (where gokwik_cid is not null) as gokwik_tagged_orders,
  count(*) filter (where meta_fbc is not null) as with_meta_fbc,
  count(*) filter (where meta_fbp is not null) as with_meta_fbp,
  count(*) filter (where customer_ip is not null) as with_customer_ip,
  count(*) filter (where lower(coalesce(channel_source_name,'')) like '%gokwik%' or lower(coalesce(channel_information,'')) like '%gokwik%') as channel_gokwik_orders,
  coalesce(sum(total_price) filter (where gokwik_cid is not null),0) as gokwik_order_value,
  (select count(distinct customer_ip) from analytics.shopify_gokwik_orders where customer_ip is not null) as unique_ips
from analytics.shopify_gokwik_orders;

create or replace function analytics.shopify_gokwik_kpis_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  total_orders bigint,
  gokwik_tagged_orders bigint,
  with_meta_fbc bigint,
  with_meta_fbp bigint,
  with_customer_ip bigint,
  channel_gokwik_orders bigint,
  gokwik_order_value numeric,
  unique_ips bigint
)
language sql
stable
as $$
  select
    count(*),
    count(*) filter (where gokwik_cid is not null),
    count(*) filter (where meta_fbc is not null),
    count(*) filter (where meta_fbp is not null),
    count(*) filter (where customer_ip is not null),
    count(*) filter (where lower(coalesce(channel_source_name,'')) like '%gokwik%' or lower(coalesce(channel_information,'')) like '%gokwik%'),
    coalesce(sum(total_price) filter (where gokwik_cid is not null),0),
    count(distinct customer_ip) filter (where customer_ip is not null)
  from analytics.shopify_gokwik_orders
  where created_at_shopify >= p_from and created_at_shopify <= p_to;
$$;

-- ============================================================
-- 4. Channel / payment_provider breakdown
-- ============================================================
create or replace view analytics.shopify_gokwik_channel_summary as
select
  coalesce(nullif(channel_information,''), coalesce(nullif(channel_source_name,''),'(none)')) as channel,
  count(*) as orders,
  coalesce(sum(total_price),0) as order_value
from analytics.shopify_gokwik_orders
group by coalesce(nullif(channel_information,''), coalesce(nullif(channel_source_name,''),'(none)'));

create or replace function analytics.shopify_gokwik_channel_summary_for_range(p_from timestamptz, p_to timestamptz)
returns table (channel text, orders bigint, order_value numeric)
language sql stable as $$
  select
    coalesce(nullif(channel_information,''), coalesce(nullif(channel_source_name,''),'(none)')) as channel,
    count(*) as orders,
    coalesce(sum(total_price),0) as order_value
  from analytics.shopify_gokwik_orders
  where created_at_shopify >= p_from and created_at_shopify <= p_to
  group by 1;
$$;

-- Grants
grant usage on schema analytics to service_role, authenticated;
grant select on analytics.shopify_gokwik_orders to service_role, authenticated;
grant select on analytics.shopify_gokwik_kpis to service_role, authenticated;
grant select on analytics.shopify_gokwik_channel_summary to service_role, authenticated;
grant execute on function analytics.shopify_gokwik_orders_for_range(timestamptz,timestamptz) to service_role, authenticated;
grant execute on function analytics.shopify_gokwik_kpis_for_range(timestamptz,timestamptz) to service_role, authenticated;
grant execute on function analytics.shopify_gokwik_channel_summary_for_range(timestamptz,timestamptz) to service_role, authenticated;

-- Helpful index for pivot performance
create index if not exists idx_shopify_note_attributes_order_name_lower
  on data_pipeline.shopify_note_attributes (shopify_order_id, lower(attribute_name));
