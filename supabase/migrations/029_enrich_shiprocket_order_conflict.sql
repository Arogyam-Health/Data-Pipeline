-- 029_enrich_shiprocket_order_conflict.sql
-- Fix ambiguous sr_order_id in enrich_shiprocket_order ON CONFLICT.
-- RETURNS TABLE(sr_order_id ...) creates a PL/pgSQL variable that clashes
-- with ON CONFLICT (sr_order_id). Use the table primary key instead.

create or replace function data_pipeline.enrich_shiprocket_order(p_sr_order_id text)
returns table (
  sr_order_id text,
  order_id_shopify_format text,
  shopify_order_identifier text,
  customer_name_shopify text,
  customer_phone_shopify text,
  coach text,
  matched boolean
)
language plpgsql
as $$
declare
  v_order_id text;
  v_format text;
  v_shopify_id text;
  v_name text;
  v_shipping_phone text;
  v_main_phone text;
  v_phone text;
  v_coach text;
begin
  select o.order_id into v_order_id
  from data_pipeline.shiprocket_orders o
  where o.sr_order_id = p_sr_order_id;

  if not found then
    return;
  end if;

  v_format := data_pipeline.extract_shopify_order_id_format(v_order_id);
  v_coach := case when v_order_id is not null and btrim(v_order_id) <> '' then 'Misba' else '' end;

  if v_format <> '' then
    select
      so.shopify_order_id,
      coalesce(nullif(c.display_name, ''), nullif(sa.name, ''), nullif(ba.name, ''), ''),
      sa.phone,
      so.phone
    into v_shopify_id, v_name, v_shipping_phone, v_main_phone
    from data_pipeline.shopify_orders so
    left join data_pipeline.shopify_customers c
      on c.customer_id = so.customer_id
    left join data_pipeline.shopify_order_addresses sa
      on sa.shopify_order_id = so.shopify_order_id and sa.address_type = 'shipping'
    left join data_pipeline.shopify_order_addresses ba
      on ba.shopify_order_id = so.shopify_order_id and ba.address_type = 'billing'
    where regexp_replace(coalesce(so.order_name, ''), '#', '', 'g') = v_format
       or coalesce(so.order_number, '') = v_format
    order by so.created_at_shopify desc nulls last
    limit 1;
  end if;

  v_phone := data_pipeline.normalize_shopify_legacy_phone(
    case
      when coalesce(v_shipping_phone, '') <> '' then v_shipping_phone
      else coalesce(v_main_phone, '')
    end
  );

  insert into data_pipeline.shiprocket_order_enrichment (
    sr_order_id,
    order_id,
    order_id_shopify_format,
    shopify_order_identifier,
    customer_name_shopify,
    customer_phone_shopify,
    coach,
    last_enriched_at
  ) values (
    p_sr_order_id,
    v_order_id,
    nullif(v_format, ''),
    v_shopify_id,
    nullif(v_name, ''),
    nullif(v_phone, ''),
    nullif(v_coach, ''),
    now()
  )
  on conflict on constraint shiprocket_order_enrichment_pkey do update set
    order_id = excluded.order_id,
    order_id_shopify_format = excluded.order_id_shopify_format,
    shopify_order_identifier = excluded.shopify_order_identifier,
    customer_name_shopify = excluded.customer_name_shopify,
    customer_phone_shopify = excluded.customer_phone_shopify,
    coach = excluded.coach,
    last_enriched_at = now();

  return query
  select
    p_sr_order_id,
    nullif(v_format, ''),
    v_shopify_id,
    nullif(v_name, ''),
    nullif(v_phone, ''),
    nullif(v_coach, ''),
    v_shopify_id is not null;
end;
$$;

grant execute on function data_pipeline.enrich_shiprocket_order(text) to service_role;
