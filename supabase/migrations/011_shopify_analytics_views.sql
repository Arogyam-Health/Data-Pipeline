-- 011_shopify_analytics_views.sql
-- Shopify analytics views for the Next.js + Recharts dashboard.
-- Does NOT alter existing analytics.shiprocket_* views.
-- Portable: no project IDs, no URLs, no credentials.

create schema if not exists analytics;

-- Payment category mapping (documented in SHOPIFY_SETUP.md):
--   COD      : cash_on_delivery / cash / cod gateway names
--   PREPAID  : shopify_payments, razorpay, payu, phonepe, stripe, paypal,
--              gokwik, simpl, lazy_pay, and similar card/UPI/wallet gateways
--   OTHER    : everything else / empty

-- ============================================================
-- 1. Order-level view
-- ============================================================
create or replace view analytics.shopify_orders as
select
  o.shopify_order_id,
  o.admin_graphql_api_id,
  o.order_name,
  o.order_number,
  o.confirmation_number,
  o.customer_id,
  c.display_name as customer_display_name,
  o.created_at_shopify,
  o.updated_at_shopify,
  o.processed_at,
  o.closed_at,
  o.cancelled_at,
  o.cancel_reason,
  o.confirmed,
  o.financial_status,
  o.fulfillment_status,
  o.currency,
  o.presentment_currency,
  o.subtotal_price,
  o.current_subtotal_price,
  o.total_price,
  o.current_total_price,
  o.total_discounts,
  o.current_total_discounts,
  o.total_tax,
  o.current_total_tax,
  o.total_line_items_price,
  o.total_outstanding,
  o.total_tip_received,
  o.total_shipping_price,
  o.total_weight,
  o.tax_exempt,
  o.taxes_included,
  o.test,
  o.note,
  o.source_name,
  o.source_identifier,
  o.landing_site,
  o.referring_site,
  o.payment_gateway_names,
  case
    when exists (
      select 1
      from unnest(coalesce(o.payment_gateway_names, array[]::text[])) g
      where lower(g) ~ '(^|[^a-z])(cash_on_delivery|cash on delivery|cod|cash)([^a-z]|$)'
    ) then 'COD'
    when exists (
      select 1
      from unnest(coalesce(o.payment_gateway_names, array[]::text[])) g
      where lower(g) ~ '(shopify_payments|bogus|razorpay|payu|phonepe|stripe|paypal|gokwik|simpl|lazypay|lazy_pay|upi|card|wallet)'
    ) then 'PREPAID'
    when o.payment_gateway_names is null or cardinality(o.payment_gateway_names) = 0 then 'UNKNOWN'
    else 'OTHER'
  end as payment_category,
  o.tags,
  o.staff_note,
  o.transactions_count,
  sa.city as shipping_city,
  sa.province as shipping_province,
  (
    select coalesce(sum(i.quantity), 0)
    from data_pipeline.shopify_order_items i
    where i.shopify_order_id = o.shopify_order_id
  ) as items,
  o.last_synced_at,
  o.created_at,
  o.updated_at
from data_pipeline.shopify_orders o
left join data_pipeline.shopify_customers c
  on c.customer_id = o.customer_id
left join data_pipeline.shopify_order_addresses sa
  on sa.shopify_order_id = o.shopify_order_id and sa.address_type = 'shipping';

-- ============================================================
-- 2. Line-level view (one row per line item)
--    Order totals are included for display only.
--    Product revenue MUST use line_revenue, never SUM(total_price).
-- ============================================================
create or replace view analytics.shopify_order_lines as
select
  i.business_key,
  i.shopify_line_item_id,
  i.line_index,
  o.shopify_order_id,
  o.order_name,
  o.order_number,
  o.created_at_shopify,
  o.updated_at_shopify,
  o.cancelled_at,
  o.cancel_reason,
  o.financial_status,
  o.fulfillment_status,
  o.currency,
  o.total_price as order_total,
  o.total_discounts as order_total_discounts,
  o.test as is_test_order,
  c.display_name as customer_display_name,
  c.number_of_orders as customer_number_of_orders,
  i.sku,
  i.product_id,
  i.variant_id,
  i.name as line_name,
  i.title as product_title,
  i.variant_title,
  i.vendor,
  i.quantity,
  i.current_quantity,
  i.price as item_price,
  i.total_discount as line_discount,
  (coalesce(i.price, 0) * coalesce(i.quantity, 0) - coalesce(i.total_discount, 0)) as line_revenue,
  i.fulfillment_status as line_fulfillment_status,
  sa.city as shipping_city,
  sa.province as shipping_province,
  sa.zip as shipping_zip,
  sa.country as shipping_country,
  ba.city as billing_city,
  ba.province as billing_province,
  dc.code as discount_code,
  case
    when exists (
      select 1
      from unnest(coalesce(o.payment_gateway_names, array[]::text[])) g
      where lower(g) ~ '(^|[^a-z])(cash_on_delivery|cash on delivery|cod|cash)([^a-z]|$)'
    ) then 'COD'
    when exists (
      select 1
      from unnest(coalesce(o.payment_gateway_names, array[]::text[])) g
      where lower(g) ~ '(shopify_payments|bogus|razorpay|payu|phonepe|stripe|paypal|gokwik|simpl|lazypay|lazy_pay|upi|card|wallet)'
    ) then 'PREPAID'
    when o.payment_gateway_names is null or cardinality(o.payment_gateway_names) = 0 then 'UNKNOWN'
    else 'OTHER'
  end as payment_category,
  utm.utm_source,
  utm.utm_medium,
  utm.utm_campaign,
  utm.utm_content,
  utm.utm_term
from data_pipeline.shopify_order_items i
join data_pipeline.shopify_orders o
  on o.shopify_order_id = i.shopify_order_id
left join data_pipeline.shopify_customers c
  on c.customer_id = o.customer_id
left join data_pipeline.shopify_order_addresses sa
  on sa.shopify_order_id = o.shopify_order_id and sa.address_type = 'shipping'
left join data_pipeline.shopify_order_addresses ba
  on ba.shopify_order_id = o.shopify_order_id and ba.address_type = 'billing'
left join lateral (
  select code
  from data_pipeline.shopify_discount_codes d
  where d.shopify_order_id = o.shopify_order_id
  order by d.position
  limit 1
) dc on true
left join lateral (
  select
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_source') as utm_source,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_medium') as utm_medium,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_campaign') as utm_campaign,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_content') as utm_content,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_term') as utm_term
  from data_pipeline.shopify_note_attributes na
  where na.shopify_order_id = o.shopify_order_id
) utm on true;

-- ============================================================
-- 3. Direct Shopify Link compatibility (no Raw Shopify JSON)
-- ============================================================
create or replace view analytics.shopify_direct_link as
select
  o.order_name as order_number,
  o.created_at_shopify as created_at,
  c.display_name as customer_name,
  o.total_price as total_price,
  sa.phone as shipping_phone,
  o.email as email,
  o.financial_status as financial_status,
  o.fulfillment_status as fulfillment_status,
  i.name as line_items,
  o.currency as currency,
  o.shopify_order_id as id,
  i.shopify_line_item_id as line_item_id,
  i.business_key,
  i.sku,
  i.quantity,
  i.price as item_price,
  sa.zip as shipping_zip,
  o.phone as phone,
  ba.city as billing_city,
  o.cancelled_at as cancelled_at,
  o.cancel_reason as cancel_reason,
  o.staff_note as staff_note,
  o.transactions_count as transactions_count,
  c.number_of_orders as number_of_orders,
  dc.code as discount_code,
  o.total_discounts as total_discounts,
  null::text as customer_last_order_discount_code
from data_pipeline.shopify_order_items i
join data_pipeline.shopify_orders o
  on o.shopify_order_id = i.shopify_order_id
left join data_pipeline.shopify_customers c
  on c.customer_id = o.customer_id
left join data_pipeline.shopify_order_addresses sa
  on sa.shopify_order_id = o.shopify_order_id and sa.address_type = 'shipping'
left join data_pipeline.shopify_order_addresses ba
  on ba.shopify_order_id = o.shopify_order_id and ba.address_type = 'billing'
left join lateral (
  select code
  from data_pipeline.shopify_discount_codes d
  where d.shopify_order_id = o.shopify_order_id
  order by d.position
  limit 1
) dc on true;

-- ============================================================
-- 4. KPI snapshot (one row). Not labeled as net revenue.
-- ============================================================
create or replace view analytics.shopify_kpis as
select
  (select count(*) from data_pipeline.shopify_orders) as total_orders,
  (select count(*) from data_pipeline.shopify_orders where coalesce(test, false) = false) as non_test_orders,
  (select count(*) from data_pipeline.shopify_orders where lower(coalesce(financial_status, '')) = 'paid') as paid_orders,
  (select count(*) from data_pipeline.shopify_orders where lower(coalesce(financial_status, '')) in ('pending', 'authorized')) as pending_payment_orders,
  (select count(*) from data_pipeline.shopify_orders where cancelled_at is not null) as cancelled_orders,
  (select count(*) from data_pipeline.shopify_orders where lower(coalesce(fulfillment_status, '')) = 'fulfilled') as fulfilled_orders,
  (select count(*) from data_pipeline.shopify_orders where lower(coalesce(fulfillment_status, '')) in ('unfulfilled', '') or fulfillment_status is null) as unfulfilled_orders,
  (select count(distinct customer_id) from data_pipeline.shopify_orders where customer_id is not null) as unique_customers,
  (select coalesce(sum(quantity), 0) from data_pipeline.shopify_order_items) as units_sold,
  (select coalesce(sum(total_price), 0) from data_pipeline.shopify_orders) as gross_order_value,
  (select coalesce(sum(total_price), 0) from data_pipeline.shopify_orders where lower(coalesce(financial_status, '')) = 'paid') as paid_order_value,
  (select round(avg(total_price), 2) from data_pipeline.shopify_orders) as average_order_value,
  (select coalesce(sum(total_discounts), 0) from data_pipeline.shopify_orders) as total_discounts;

-- ============================================================
-- 5. Daily sales (order-level, no line-item duplication)
-- ============================================================
create or replace view analytics.shopify_daily_sales as
with order_days as (
  select
    date_trunc('day', created_at_shopify)::date as date,
    count(*) as orders,
    count(*) filter (where lower(coalesce(financial_status, '')) = 'paid') as paid_orders,
    count(*) filter (where cancelled_at is not null) as cancelled_orders,
    coalesce(sum(total_price), 0) as gross_order_value,
    coalesce(sum(total_price) filter (where lower(coalesce(financial_status, '')) = 'paid'), 0) as paid_order_value,
    coalesce(sum(total_discounts), 0) as discounts,
    round(avg(total_price), 2) as average_order_value
  from data_pipeline.shopify_orders
  group by date_trunc('day', created_at_shopify)::date
),
item_days as (
  select
    date_trunc('day', o.created_at_shopify)::date as date,
    coalesce(sum(i.quantity), 0) as units_sold
  from data_pipeline.shopify_order_items i
  join data_pipeline.shopify_orders o
    on o.shopify_order_id = i.shopify_order_id
  group by date_trunc('day', o.created_at_shopify)::date
)
select
  od.date,
  od.orders,
  od.paid_orders,
  od.cancelled_orders,
  coalesce(id.units_sold, 0) as units_sold,
  od.gross_order_value,
  od.paid_order_value,
  od.discounts,
  od.average_order_value
from order_days od
left join item_days id on id.date = od.date;

-- ============================================================
-- 6. Financial status
-- ============================================================
create or replace view analytics.shopify_financial_status_summary as
select
  coalesce(nullif(financial_status, ''), 'unknown') as financial_status,
  count(*) as order_count,
  coalesce(sum(total_price), 0) as order_value
from data_pipeline.shopify_orders
group by coalesce(nullif(financial_status, ''), 'unknown');

-- ============================================================
-- 7. Fulfillment status
-- ============================================================
create or replace view analytics.shopify_fulfillment_status_summary as
select
  coalesce(nullif(fulfillment_status, ''), 'unknown') as fulfillment_status,
  count(*) as order_count,
  coalesce(sum(total_price), 0) as order_value
from data_pipeline.shopify_orders
group by coalesce(nullif(fulfillment_status, ''), 'unknown');

-- ============================================================
-- 8. Product performance (item revenue, NOT repeated order total)
-- ============================================================
create or replace view analytics.shopify_product_performance as
select
  coalesce(nullif(i.sku, ''), '(no sku)') as sku,
  i.title as product,
  i.variant_title as variant,
  i.product_id,
  i.variant_id,
  count(distinct i.shopify_order_id) as orders_containing_product,
  coalesce(sum(i.quantity), 0) as units,
  coalesce(sum(coalesce(i.price, 0) * coalesce(i.quantity, 0) - coalesce(i.total_discount, 0)), 0) as item_revenue,
  round(avg(i.price), 2) as average_item_price
from data_pipeline.shopify_order_items i
group by
  coalesce(nullif(i.sku, ''), '(no sku)'),
  i.title,
  i.variant_title,
  i.product_id,
  i.variant_id;

-- ============================================================
-- 9. Payment method
-- ============================================================
create or replace view analytics.shopify_payment_method_summary as
select
  coalesce(nullif(gateway, ''), 'unknown') as payment_gateway,
  payment_category,
  count(*) as order_count,
  coalesce(sum(total_price), 0) as order_value
from (
  select
    o.shopify_order_id,
    o.total_price,
    coalesce(o.payment_gateway_names[1], '') as gateway,
    case
      when exists (
        select 1
        from unnest(coalesce(o.payment_gateway_names, array[]::text[])) g
        where lower(g) ~ '(^|[^a-z])(cash_on_delivery|cash on delivery|cod|cash)([^a-z]|$)'
      ) then 'COD'
      when exists (
        select 1
        from unnest(coalesce(o.payment_gateway_names, array[]::text[])) g
        where lower(g) ~ '(shopify_payments|bogus|razorpay|payu|phonepe|stripe|paypal|gokwik|simpl|lazypay|lazy_pay|upi|card|wallet)'
      ) then 'PREPAID'
      when o.payment_gateway_names is null or cardinality(o.payment_gateway_names) = 0 then 'UNKNOWN'
      else 'OTHER'
    end as payment_category
  from data_pipeline.shopify_orders o
) p
group by coalesce(nullif(gateway, ''), 'unknown'), payment_category;

-- ============================================================
-- 10. Discount performance
-- ============================================================
create or replace view analytics.shopify_discount_performance as
select
  coalesce(nullif(d.code, ''), '(no code)') as discount_code,
  count(distinct o.shopify_order_id) as orders,
  coalesce(sum(o.total_price), 0) as gross_value,
  coalesce(sum(o.total_discounts), 0) as discount_amount,
  coalesce(sum(o.total_price) filter (where lower(coalesce(o.financial_status, '')) = 'paid'), 0) as paid_value
from data_pipeline.shopify_discount_codes d
join data_pipeline.shopify_orders o
  on o.shopify_order_id = d.shopify_order_id
group by coalesce(nullif(d.code, ''), '(no code)');

-- ============================================================
-- 11. UTM performance (order-level via note attributes)
-- ============================================================
create or replace view analytics.shopify_utm_performance as
with order_utm as (
  select
    o.shopify_order_id,
    o.financial_status,
    o.total_price,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_source') as utm_source,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_medium') as utm_medium,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_campaign') as utm_campaign,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_content') as utm_content,
    max(na.attribute_value) filter (where lower(na.attribute_name) = 'utm_term') as utm_term
  from data_pipeline.shopify_orders o
  left join data_pipeline.shopify_note_attributes na
    on na.shopify_order_id = o.shopify_order_id
  group by o.shopify_order_id, o.financial_status, o.total_price
),
order_metrics as (
  select
    coalesce(nullif(utm_source, ''), '(none)') as utm_source,
    coalesce(nullif(utm_medium, ''), '(none)') as utm_medium,
    coalesce(nullif(utm_campaign, ''), '(none)') as utm_campaign,
    coalesce(nullif(utm_content, ''), '(none)') as utm_content,
    coalesce(nullif(utm_term, ''), '(none)') as utm_term,
    count(*) as orders,
    count(*) filter (where lower(coalesce(financial_status, '')) = 'paid') as paid_orders,
    coalesce(sum(total_price), 0) as order_value
  from order_utm
  group by 1, 2, 3, 4, 5
),
unit_metrics as (
  select
    coalesce(nullif(ou.utm_source, ''), '(none)') as utm_source,
    coalesce(nullif(ou.utm_medium, ''), '(none)') as utm_medium,
    coalesce(nullif(ou.utm_campaign, ''), '(none)') as utm_campaign,
    coalesce(nullif(ou.utm_content, ''), '(none)') as utm_content,
    coalesce(nullif(ou.utm_term, ''), '(none)') as utm_term,
    coalesce(sum(i.quantity), 0) as units
  from order_utm ou
  left join data_pipeline.shopify_order_items i
    on i.shopify_order_id = ou.shopify_order_id
  group by 1, 2, 3, 4, 5
)
select
  om.utm_source,
  om.utm_medium,
  om.utm_campaign,
  om.utm_content,
  om.utm_term,
  om.orders,
  om.paid_orders,
  om.order_value,
  coalesce(um.units, 0) as units
from order_metrics om
left join unit_metrics um
  on um.utm_source = om.utm_source
 and um.utm_medium = om.utm_medium
 and um.utm_campaign = om.utm_campaign
 and um.utm_content = om.utm_content
 and um.utm_term = om.utm_term;

-- ============================================================
-- 12. Geography (shipping address)
-- ============================================================
create or replace view analytics.shopify_geo_summary as
select
  coalesce(nullif(sa.province, ''), 'Unknown') as province,
  coalesce(nullif(sa.city, ''), 'Unknown') as city,
  count(*) as order_count,
  coalesce(sum(o.total_price) filter (where lower(coalesce(o.financial_status, '')) = 'paid'), 0) as paid_order_value
from data_pipeline.shopify_orders o
left join data_pipeline.shopify_order_addresses sa
  on sa.shopify_order_id = o.shopify_order_id and sa.address_type = 'shipping'
group by
  coalesce(nullif(sa.province, ''), 'Unknown'),
  coalesce(nullif(sa.city, ''), 'Unknown');

-- ============================================================
-- 13. Cancellations
-- ============================================================
create or replace view analytics.shopify_cancellation_summary as
select
  coalesce(nullif(cancel_reason, ''), 'Unknown') as cancel_reason,
  count(*) as count,
  coalesce(sum(total_price), 0) as value
from data_pipeline.shopify_orders
where cancelled_at is not null
group by coalesce(nullif(cancel_reason, ''), 'Unknown');

-- ============================================================
-- 14. Customer summary
-- ============================================================
create or replace view analytics.shopify_customer_summary as
select
  (select count(*) from data_pipeline.shopify_customers) as total_customers,
  (
    select count(*)
    from data_pipeline.shopify_customers c
    where c.created_at_shopify >= now() - interval '30 days'
  ) as new_customers_30d,
  (
    select count(*)
    from data_pipeline.shopify_customers c
    where coalesce(c.number_of_orders, 0) >= 2
  ) as repeat_customers,
  (
    select round(avg(number_of_orders), 2)
    from data_pipeline.shopify_customers
    where number_of_orders is not null
  ) as average_orders_per_customer;

-- ============================================================
-- 15. Recent orders (masked PII is applied in the API layer)
-- ============================================================
create or replace view analytics.shopify_recent_orders as
select
  o.shopify_order_id,
  o.order_name,
  o.created_at_shopify,
  c.display_name as customer_display_name,
  o.email,
  o.phone,
  o.financial_status,
  o.fulfillment_status,
  o.total_price as order_value,
  o.currency,
  (
    select coalesce(sum(i.quantity), 0)
    from data_pipeline.shopify_order_items i
    where i.shopify_order_id = o.shopify_order_id
  ) as items,
  sa.city,
  coalesce(o.payment_gateway_names[1], '') as payment_method,
  o.cancelled_at,
  o.test
from data_pipeline.shopify_orders o
left join data_pipeline.shopify_customers c
  on c.customer_id = o.customer_id
left join data_pipeline.shopify_order_addresses sa
  on sa.shopify_order_id = o.shopify_order_id and sa.address_type = 'shipping'
order by o.created_at_shopify desc
limit 50;

-- ============================================================
-- 16. Sync health
-- ============================================================
create or replace view analytics.shopify_sync_health as
select
  s.shop_domain,
  s.last_successful_sync_at,
  s.last_attempted_sync_at,
  s.last_backfill_completed_at,
  s.granted_scopes,
  s.api_version,
  s.accessible_history_days,
  s.history_warning,
  r.status as last_status,
  r.mode as last_mode,
  r.orders_fetched as last_orders_fetched,
  r.retry_count as last_retry_count,
  r.last_error_code,
  r.last_error_message,
  extract(epoch from (r.finished_at - r.started_at)) as last_duration_seconds,
  (
    select count(*)
    from data_pipeline.shopify_sync_runs recent
    where recent.shop_domain = s.shop_domain
      and recent.status in ('failed', 'partial')
      and recent.started_at >= now() - interval '24 hours'
  ) as recent_failures_24h
from data_pipeline.shopify_sync_state s
left join lateral (
  select *
  from data_pipeline.shopify_sync_runs run
  where run.shop_domain = s.shop_domain
  order by run.started_at desc
  limit 1
) r on true;

-- ============================================================
-- Grants (minimum read for the Next.js dashboard / service_role)
-- ============================================================
grant usage on schema analytics to service_role;
grant usage on schema analytics to authenticated;

grant select on analytics.shopify_orders to service_role, authenticated;
grant select on analytics.shopify_order_lines to service_role, authenticated;
grant select on analytics.shopify_direct_link to service_role, authenticated;
grant select on analytics.shopify_kpis to service_role, authenticated;
grant select on analytics.shopify_daily_sales to service_role, authenticated;
grant select on analytics.shopify_financial_status_summary to service_role, authenticated;
grant select on analytics.shopify_fulfillment_status_summary to service_role, authenticated;
grant select on analytics.shopify_product_performance to service_role, authenticated;
grant select on analytics.shopify_payment_method_summary to service_role, authenticated;
grant select on analytics.shopify_discount_performance to service_role, authenticated;
grant select on analytics.shopify_utm_performance to service_role, authenticated;
grant select on analytics.shopify_geo_summary to service_role, authenticated;
grant select on analytics.shopify_cancellation_summary to service_role, authenticated;
grant select on analytics.shopify_customer_summary to service_role, authenticated;
grant select on analytics.shopify_recent_orders to service_role, authenticated;
grant select on analytics.shopify_sync_health to service_role, authenticated;
