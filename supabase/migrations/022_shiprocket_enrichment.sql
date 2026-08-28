-- 022_shiprocket_enrichment.sql
-- Additive Shiprocket enrichment + extra webhook fields + scan history.
-- Does not rename/drop existing shiprocket_orders columns.
-- Does not alter Shopify / Meta / GA4 tables.

-- ============================================================
-- Extra source fields on current-state orders (nullable)
-- ============================================================

alter table data_pipeline.shiprocket_orders
  add column if not exists return_awb_code text,
  add column if not exists awb_assigned_date text,
  add column if not exists pickup_scheduled_date text,
  add column if not exists pickup_exception_reason text,
  add column if not exists undelivered_reason text,
  add column if not exists undelivered_reason_code text,
  add column if not exists pick_exception_reason_code text,
  add column if not exists delivery_attempt_count text,
  add column if not exists pickup_attempt_count text,
  add column if not exists qc_image text,
  add column if not exists qc_failure_reason text,
  add column if not exists pod_status text,
  add column if not exists pod text,
  add column if not exists shipping_method text,
  add column if not exists last_local_api_sync_at timestamptz;

-- ============================================================
-- Shopify-derived enrichment (separate from webhook customer fields)
-- ============================================================

create table if not exists data_pipeline.shiprocket_order_enrichment (
  sr_order_id text primary key
    references data_pipeline.shiprocket_orders(sr_order_id) on delete cascade,
  order_id text,
  order_id_shopify_format text,
  shopify_order_identifier text,
  customer_name_shopify text,
  customer_phone_shopify text,
  coach text,
  last_enriched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_shiprocket_order_enrichment_updated_at'
  ) then
    create trigger trg_shiprocket_order_enrichment_updated_at
      before update on data_pipeline.shiprocket_order_enrichment
      for each row
      execute function data_pipeline.set_updated_at();
  end if;
end;
$$;

-- ============================================================
-- Full scan history (legacy sheet only exposes scans[0] and scans[1])
-- ============================================================

create table if not exists data_pipeline.shiprocket_scans (
  id uuid primary key default gen_random_uuid(),
  sr_order_id text not null
    references data_pipeline.shiprocket_orders(sr_order_id) on delete cascade,
  awb text,
  scan_index integer not null,
  scan_date text,
  status text,
  sr_status text,
  sr_status_label text,
  activity text,
  location text,
  latitude text,
  longitude text,
  created_at timestamptz not null default now(),
  unique (sr_order_id, scan_index)
);

-- ============================================================
-- Deterministic Shopify enrichment (reusable by worker / API / backfill)
-- ============================================================

create or replace function data_pipeline.extract_shopify_order_id_format(p_order_id text)
returns text
language sql
immutable
as $$
  select case
    when p_order_id is null or btrim(p_order_id) = '' then ''
    else coalesce(substring(p_order_id from '\d{8}'), '')
  end;
$$;

create or replace function data_pipeline.normalize_shopify_legacy_phone(p_raw text)
returns text
language sql
immutable
as $$
  select case
    when p_raw is null or btrim(p_raw) = '' then ''
    else '91' || right(regexp_replace(p_raw, '\D', '', 'g'), 10)
  end;
$$;

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
  on conflict (sr_order_id) do update set
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

grant execute on function data_pipeline.extract_shopify_order_id_format(text) to service_role;
grant execute on function data_pipeline.normalize_shopify_legacy_phone(text) to service_role;
grant execute on function data_pipeline.enrich_shiprocket_order(text) to service_role;
