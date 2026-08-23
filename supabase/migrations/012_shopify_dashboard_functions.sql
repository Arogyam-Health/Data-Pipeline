-- 012_shopify_dashboard_functions.sql
-- Date-range analytics functions that reuse the same formulas as
-- analytics.shopify_* views. No project IDs, URLs, or secrets.

-- Order-level KPIs for a created_at window. Revenue is never taken from line items.
create or replace function analytics.shopify_kpis_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  total_orders bigint,
  paid_orders bigint,
  cancelled_orders bigint,
  fulfilled_orders bigint,
  units_sold numeric,
  unique_customers bigint,
  gross_order_value numeric,
  paid_order_value numeric,
  average_order_value numeric,
  total_discounts numeric
)
language sql
stable
as $$
  with orders as (
    select *
    from data_pipeline.shopify_orders
    where created_at_shopify >= p_from
      and created_at_shopify <= p_to
  )
  select
    (select count(*) from orders),
    (select count(*) from orders where lower(coalesce(financial_status, '')) = 'paid'),
    (select count(*) from orders where cancelled_at is not null),
    (select count(*) from orders where lower(coalesce(fulfillment_status, '')) = 'fulfilled'),
    (
      select coalesce(sum(i.quantity), 0)
      from data_pipeline.shopify_order_items i
      join orders o on o.shopify_order_id = i.shopify_order_id
    ),
    (select count(distinct customer_id) from orders where customer_id is not null),
    (select coalesce(sum(total_price), 0) from orders),
    (select coalesce(sum(total_price), 0) from orders where lower(coalesce(financial_status, '')) = 'paid'),
    (select round(avg(total_price), 2) from orders),
    (select coalesce(sum(total_discounts), 0) from orders);
$$;

create or replace function analytics.shopify_financial_status_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  financial_status text,
  order_count bigint,
  order_value numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(financial_status, ''), 'unknown') as financial_status,
    count(*) as order_count,
    coalesce(sum(total_price), 0) as order_value
  from data_pipeline.shopify_orders
  where created_at_shopify >= p_from
    and created_at_shopify <= p_to
  group by coalesce(nullif(financial_status, ''), 'unknown');
$$;

create or replace function analytics.shopify_fulfillment_status_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  fulfillment_status text,
  order_count bigint,
  order_value numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(fulfillment_status, ''), 'unknown') as fulfillment_status,
    count(*) as order_count,
    coalesce(sum(total_price), 0) as order_value
  from data_pipeline.shopify_orders
  where created_at_shopify >= p_from
    and created_at_shopify <= p_to
  group by coalesce(nullif(fulfillment_status, ''), 'unknown');
$$;

create or replace function analytics.shopify_product_performance_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  sku text,
  product text,
  variant text,
  orders_containing_product bigint,
  units numeric,
  item_revenue numeric,
  average_item_price numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(i.sku, ''), '(no sku)') as sku,
    i.title as product,
    i.variant_title as variant,
    count(distinct i.shopify_order_id) as orders_containing_product,
    coalesce(sum(i.quantity), 0) as units,
    coalesce(sum(coalesce(i.price, 0) * coalesce(i.quantity, 0) - coalesce(i.total_discount, 0)), 0) as item_revenue,
    round(avg(i.price), 2) as average_item_price
  from data_pipeline.shopify_order_items i
  join data_pipeline.shopify_orders o
    on o.shopify_order_id = i.shopify_order_id
  where o.created_at_shopify >= p_from
    and o.created_at_shopify <= p_to
  group by
    coalesce(nullif(i.sku, ''), '(no sku)'),
    i.title,
    i.variant_title
  order by item_revenue desc;
$$;

create or replace function analytics.shopify_payment_method_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  payment_gateway text,
  payment_category text,
  order_count bigint,
  order_value numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(gateway, ''), 'unknown') as payment_gateway,
    payment_category,
    count(*) as order_count,
    coalesce(sum(total_price), 0) as order_value
  from (
    select
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
    where o.created_at_shopify >= p_from
      and o.created_at_shopify <= p_to
  ) p
  group by coalesce(nullif(gateway, ''), 'unknown'), payment_category;
$$;

create or replace function analytics.shopify_discount_performance_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  discount_code text,
  orders bigint,
  gross_value numeric,
  discount_amount numeric,
  paid_value numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(d.code, ''), '(no code)') as discount_code,
    count(distinct o.shopify_order_id) as orders,
    coalesce(sum(o.total_price), 0) as gross_value,
    coalesce(sum(o.total_discounts), 0) as discount_amount,
    coalesce(sum(o.total_price) filter (where lower(coalesce(o.financial_status, '')) = 'paid'), 0) as paid_value
  from data_pipeline.shopify_discount_codes d
  join data_pipeline.shopify_orders o
    on o.shopify_order_id = d.shopify_order_id
  where o.created_at_shopify >= p_from
    and o.created_at_shopify <= p_to
  group by coalesce(nullif(d.code, ''), '(no code)');
$$;

create or replace function analytics.shopify_utm_performance_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  orders bigint,
  paid_orders bigint,
  order_value numeric,
  units numeric
)
language sql
stable
as $$
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
    where o.created_at_shopify >= p_from
      and o.created_at_shopify <= p_to
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
$$;

create or replace function analytics.shopify_geo_summary_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  province text,
  city text,
  order_count bigint,
  paid_order_value numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(sa.province, ''), 'Unknown') as province,
    coalesce(nullif(sa.city, ''), 'Unknown') as city,
    count(*) as order_count,
    coalesce(sum(o.total_price) filter (where lower(coalesce(o.financial_status, '')) = 'paid'), 0) as paid_order_value
  from data_pipeline.shopify_orders o
  left join data_pipeline.shopify_order_addresses sa
    on sa.shopify_order_id = o.shopify_order_id and sa.address_type = 'shipping'
  where o.created_at_shopify >= p_from
    and o.created_at_shopify <= p_to
  group by
    coalesce(nullif(sa.province, ''), 'Unknown'),
    coalesce(nullif(sa.city, ''), 'Unknown');
$$;

create or replace function analytics.shopify_cancellation_summary_for_range(p_from timestamptz, p_to timestamptz)
returns table (
  cancel_reason text,
  count bigint,
  value numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(cancel_reason, ''), 'Unknown') as cancel_reason,
    count(*) as count,
    coalesce(sum(total_price), 0) as value
  from data_pipeline.shopify_orders
  where cancelled_at is not null
    and created_at_shopify >= p_from
    and created_at_shopify <= p_to
  group by coalesce(nullif(cancel_reason, ''), 'Unknown');
$$;

grant execute on function analytics.shopify_kpis_for_range(timestamptz, timestamptz) to service_role;
grant execute on function analytics.shopify_financial_status_for_range(timestamptz, timestamptz) to service_role;
grant execute on function analytics.shopify_fulfillment_status_for_range(timestamptz, timestamptz) to service_role;
grant execute on function analytics.shopify_product_performance_for_range(timestamptz, timestamptz) to service_role;
grant execute on function analytics.shopify_payment_method_for_range(timestamptz, timestamptz) to service_role;
grant execute on function analytics.shopify_discount_performance_for_range(timestamptz, timestamptz) to service_role;
grant execute on function analytics.shopify_utm_performance_for_range(timestamptz, timestamptz) to service_role;
grant execute on function analytics.shopify_geo_summary_for_range(timestamptz, timestamptz) to service_role;
grant execute on function analytics.shopify_cancellation_summary_for_range(timestamptz, timestamptz) to service_role;
