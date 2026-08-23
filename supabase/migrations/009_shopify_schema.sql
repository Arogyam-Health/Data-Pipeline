-- 009_shopify_schema.sql
-- Isolated Shopify canonical tables under data_pipeline.
-- Portable: no project IDs, no URLs, no credentials, no secrets.

-- ============================================================
-- Sync metadata
-- ============================================================

create table if not exists data_pipeline.shopify_sync_runs (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null,
  mode text not null
    check (mode in ('test', 'backfill', 'incremental', 'repair')),
  status text not null
    check (status in ('running', 'success', 'partial', 'failed')),
  requested_from timestamptz,
  requested_to timestamptz,
  actual_from timestamptz,
  actual_to timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  orders_fetched integer not null default 0,
  orders_inserted integer not null default 0,
  orders_updated integer not null default 0,
  items_upserted integer not null default 0,
  customers_upserted integer not null default 0,
  refunds_upserted integer not null default 0,
  fulfillments_upserted integer not null default 0,
  pages_fetched integer not null default 0,
  api_requests integer not null default 0,
  retry_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  history_warning text,
  created_at timestamptz not null default now()
);

create table if not exists data_pipeline.shopify_sync_state (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null unique,
  last_successful_sync_at timestamptz,
  last_attempted_sync_at timestamptz,
  last_backfill_completed_at timestamptz,
  last_backfill_start_at timestamptz,
  granted_scopes text[],
  api_version text,
  accessible_history_days integer,
  history_warning text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.shopify_sync_locks (
  shop_domain text primary key,
  lock_token uuid not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  mode text
);

create table if not exists data_pipeline.shopify_sync_errors (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null
    references data_pipeline.shopify_sync_runs(id) on delete cascade,
  shopify_order_id text,
  entity_type text,
  operation text,
  error_code text,
  error_message text,
  retryable boolean not null default false,
  attempt integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists data_pipeline.shopify_backfill_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null,
  requested_days integer not null,
  chunk_days integer not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  next_chunk_start timestamptz,
  status text not null
    check (status in ('pending', 'running', 'paused', 'completed', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  history_warning text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.shopify_schema_drift (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  field_path text not null,
  observed_type text not null,
  api_version text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count bigint not null default 1,
  unique (entity_type, field_path, api_version)
);

-- ============================================================
-- Customers
-- ============================================================

create table if not exists data_pipeline.shopify_customers (
  customer_id text primary key,
  admin_graphql_api_id text,
  first_name text,
  last_name text,
  display_name text,
  email text,
  phone text,
  created_at_shopify timestamptz,
  updated_at_shopify timestamptz,
  state text,
  verified_email boolean,
  currency text,
  tax_exempt boolean,
  tags text[],
  number_of_orders integer,
  email_marketing_state text,
  email_marketing_opt_in_level text,
  email_marketing_consent_updated_at timestamptz,
  sms_marketing_state text,
  sms_marketing_opt_in_level text,
  sms_marketing_consent_updated_at timestamptz,
  sms_marketing_consent_collected_from text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.shopify_customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_address_id text,
  customer_id text not null
    references data_pipeline.shopify_customers(customer_id) on delete cascade,
  is_default boolean not null default false,
  first_name text,
  last_name text,
  name text,
  company text,
  address1 text,
  address2 text,
  city text,
  province text,
  province_code text,
  country text,
  country_code text,
  zip text,
  phone text,
  latitude numeric,
  longitude numeric,
  address_key text not null,
  unique (customer_id, address_key)
);

-- ============================================================
-- Orders
-- ============================================================

create table if not exists data_pipeline.shopify_orders (
  shopify_order_id text primary key,
  admin_graphql_api_id text,
  app_id text,
  order_name text,
  order_number text,
  confirmation_number text,
  customer_id text
    references data_pipeline.shopify_customers(customer_id) on delete set null,
  created_at_shopify timestamptz,
  updated_at_shopify timestamptz,
  processed_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  confirmed boolean,
  email text,
  contact_email text,
  phone text,
  buyer_accepts_marketing boolean,
  currency text,
  presentment_currency text,
  financial_status text,
  fulfillment_status text,
  subtotal_price numeric(14, 2),
  current_subtotal_price numeric(14, 2),
  total_price numeric(14, 2),
  current_total_price numeric(14, 2),
  total_discounts numeric(14, 2),
  current_total_discounts numeric(14, 2),
  total_tax numeric(14, 2),
  current_total_tax numeric(14, 2),
  total_line_items_price numeric(14, 2),
  total_outstanding numeric(14, 2),
  total_tip_received numeric(14, 2),
  total_shipping_price numeric(14, 2),
  total_weight bigint,
  tax_exempt boolean,
  taxes_included boolean,
  duties_included boolean,
  estimated_taxes boolean,
  test boolean,
  note text,
  landing_site text,
  landing_site_ref text,
  referring_site text,
  source_name text,
  source_identifier text,
  source_url text,
  location_id text,
  merchant_business_entity_id text,
  merchant_of_record_app_id text,
  payment_gateway_names text[],
  tags text[],
  staff_note text,
  transactions_count integer,
  last_synced_at timestamptz not null default now(),
  last_sync_run_id uuid
    references data_pipeline.shopify_sync_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.shopify_order_addresses (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  address_type text not null check (address_type in ('shipping', 'billing')),
  first_name text,
  last_name text,
  name text,
  company text,
  address1 text,
  address2 text,
  city text,
  province text,
  province_code text,
  country text,
  country_code text,
  zip text,
  phone text,
  latitude numeric,
  longitude numeric,
  unique (shopify_order_id, address_type)
);

create table if not exists data_pipeline.shopify_order_items (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  shopify_line_item_id text,
  business_key text not null unique,
  line_index integer not null,
  product_id text,
  variant_id text,
  sku text,
  name text,
  title text,
  variant_title text,
  vendor text,
  quantity integer,
  current_quantity integer,
  fulfillable_quantity integer,
  price numeric(14, 2),
  total_discount numeric(14, 2),
  grams integer,
  product_exists boolean,
  requires_shipping boolean,
  taxable boolean,
  gift_card boolean,
  fulfillment_service text,
  fulfillment_status text,
  variant_inventory_management text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.shopify_line_item_properties (
  id uuid primary key default gen_random_uuid(),
  business_key text not null
    references data_pipeline.shopify_order_items(business_key) on delete cascade,
  position integer not null,
  property_name text,
  property_value text,
  unique (business_key, position)
);

create table if not exists data_pipeline.shopify_note_attributes (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  position integer not null,
  attribute_name text,
  attribute_value text,
  unique (shopify_order_id, position)
);

create table if not exists data_pipeline.shopify_discount_codes (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  position integer not null,
  code text,
  amount numeric(14, 2),
  discount_type text,
  unique (shopify_order_id, position)
);

create table if not exists data_pipeline.shopify_discount_applications (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  application_index integer not null,
  target_type text,
  application_type text,
  value numeric(14, 4),
  value_type text,
  allocation_method text,
  target_selection text,
  title text,
  description text,
  unique (shopify_order_id, application_index)
);

create table if not exists data_pipeline.shopify_discount_allocations (
  id uuid primary key default gen_random_uuid(),
  order_item_business_key text not null
    references data_pipeline.shopify_order_items(business_key) on delete cascade,
  discount_application_index integer not null,
  amount numeric(14, 2),
  unique (order_item_business_key, discount_application_index)
);

create table if not exists data_pipeline.shopify_fulfillments (
  shopify_fulfillment_id text primary key,
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  admin_graphql_api_id text,
  created_at_shopify timestamptz,
  updated_at_shopify timestamptz,
  location_id text,
  name text,
  service text,
  shipment_status text,
  status text,
  tracking_company text,
  tracking_number text,
  tracking_url text,
  tracking_numbers text[],
  tracking_urls text[],
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.shopify_fulfillment_items (
  id uuid primary key default gen_random_uuid(),
  shopify_fulfillment_id text not null
    references data_pipeline.shopify_fulfillments(shopify_fulfillment_id) on delete cascade,
  order_item_business_key text
    references data_pipeline.shopify_order_items(business_key) on delete set null,
  shopify_line_item_id text,
  quantity integer,
  unique (shopify_fulfillment_id, shopify_line_item_id)
);

create table if not exists data_pipeline.shopify_shipping_lines (
  shopify_shipping_line_id text primary key,
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  carrier_identifier text,
  code text,
  title text,
  price numeric(14, 2),
  discounted_price numeric(14, 2),
  is_removed boolean,
  phone text,
  source text
);

create table if not exists data_pipeline.shopify_refunds (
  shopify_refund_id text primary key,
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  created_at_shopify timestamptz,
  processed_at timestamptz,
  note text,
  restock boolean,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_pipeline.shopify_transactions (
  shopify_transaction_id text primary key,
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  shopify_refund_id text
    references data_pipeline.shopify_refunds(shopify_refund_id) on delete set null,
  parent_id text,
  amount numeric(14, 2),
  currency text,
  authorization_code text,
  gateway text,
  kind text,
  status text,
  message text,
  error_code text,
  payment_id text,
  source_name text,
  created_at_shopify timestamptz,
  processed_at timestamptz,
  test boolean
);

create table if not exists data_pipeline.shopify_refund_line_items (
  shopify_refund_line_item_id text primary key,
  shopify_refund_id text not null
    references data_pipeline.shopify_refunds(shopify_refund_id) on delete cascade,
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  shopify_line_item_id text,
  location_id text,
  quantity integer,
  restock_type text,
  subtotal numeric(14, 2),
  total_tax numeric(14, 2)
);

create table if not exists data_pipeline.shopify_order_adjustments (
  shopify_adjustment_id text primary key,
  shopify_refund_id text
    references data_pipeline.shopify_refunds(shopify_refund_id) on delete cascade,
  shopify_order_id text not null
    references data_pipeline.shopify_orders(shopify_order_id) on delete cascade,
  amount numeric(14, 2),
  tax_amount numeric(14, 2),
  kind text,
  reason text
);

-- ============================================================
-- updated_at triggers (reuse existing helper)
-- ============================================================

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'shopify_sync_state',
    'shopify_backfill_jobs',
    'shopify_customers',
    'shopify_orders',
    'shopify_order_items',
    'shopify_fulfillments',
    'shopify_refunds'
  ]
  loop
    if not exists (
      select 1 from pg_trigger
      where tgname = 'trg_' || tbl || '_updated_at'
    ) then
      execute format(
        'create trigger trg_%I_updated_at
           before update on data_pipeline.%I
           for each row
           execute function data_pipeline.set_updated_at()',
        tbl, tbl
      );
    end if;
  end loop;
end;
$$;

-- ============================================================
-- Sync lock helpers (row-based; safe with connection pooling)
-- ============================================================

create or replace function data_pipeline.try_acquire_shopify_sync_lock(
  p_shop_domain text,
  p_mode text default 'incremental',
  p_ttl_seconds integer default 900
) returns uuid
language plpgsql
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  delete from data_pipeline.shopify_sync_locks
  where shop_domain = p_shop_domain
    and expires_at < now();

  insert into data_pipeline.shopify_sync_locks (
    shop_domain, lock_token, locked_at, expires_at, mode
  ) values (
    p_shop_domain, v_token, now(), now() + make_interval(secs => p_ttl_seconds), p_mode
  );

  return v_token;
exception
  when unique_violation then
    return null;
end;
$$;

create or replace function data_pipeline.release_shopify_sync_lock(
  p_shop_domain text,
  p_lock_token uuid
) returns boolean
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from data_pipeline.shopify_sync_locks
  where shop_domain = p_shop_domain
    and lock_token = p_lock_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
