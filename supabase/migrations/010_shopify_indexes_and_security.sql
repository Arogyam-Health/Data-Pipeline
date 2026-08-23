-- 010_shopify_indexes_and_security.sql
-- Indexes, RLS, and grants for Shopify tables.
-- Portable: no project IDs, no URLs, no credentials.

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_shopify_orders_updated_at
  on data_pipeline.shopify_orders (updated_at_shopify);

create index if not exists idx_shopify_orders_created_at
  on data_pipeline.shopify_orders (created_at_shopify);

create index if not exists idx_shopify_orders_financial_status
  on data_pipeline.shopify_orders (financial_status);

create index if not exists idx_shopify_orders_fulfillment_status
  on data_pipeline.shopify_orders (fulfillment_status);

create index if not exists idx_shopify_orders_customer_id
  on data_pipeline.shopify_orders (customer_id);

create index if not exists idx_shopify_orders_cancelled_at
  on data_pipeline.shopify_orders (cancelled_at);

create index if not exists idx_shopify_order_items_order_id
  on data_pipeline.shopify_order_items (shopify_order_id);

create index if not exists idx_shopify_order_items_sku
  on data_pipeline.shopify_order_items (sku);

create index if not exists idx_shopify_order_items_product_id
  on data_pipeline.shopify_order_items (product_id);

create index if not exists idx_shopify_order_items_variant_id
  on data_pipeline.shopify_order_items (variant_id);

create index if not exists idx_shopify_note_attributes_order_id
  on data_pipeline.shopify_note_attributes (shopify_order_id);

create index if not exists idx_shopify_note_attributes_name
  on data_pipeline.shopify_note_attributes (attribute_name);

create index if not exists idx_shopify_note_attributes_name_value
  on data_pipeline.shopify_note_attributes (attribute_name, attribute_value);

create index if not exists idx_shopify_fulfillments_order_id
  on data_pipeline.shopify_fulfillments (shopify_order_id);

create index if not exists idx_shopify_refunds_order_id
  on data_pipeline.shopify_refunds (shopify_order_id);

create index if not exists idx_shopify_transactions_order_id
  on data_pipeline.shopify_transactions (shopify_order_id);

create index if not exists idx_shopify_sync_runs_started_at
  on data_pipeline.shopify_sync_runs (started_at);

create index if not exists idx_shopify_sync_runs_status
  on data_pipeline.shopify_sync_runs (status);

create index if not exists idx_shopify_sync_runs_mode
  on data_pipeline.shopify_sync_runs (mode);

create index if not exists idx_shopify_sync_errors_run_id
  on data_pipeline.shopify_sync_errors (sync_run_id);

create index if not exists idx_shopify_customers_email
  on data_pipeline.shopify_customers (email);

create index if not exists idx_shopify_discount_codes_order_id
  on data_pipeline.shopify_discount_codes (shopify_order_id);

-- ============================================================
-- RLS — service_role only (defense-in-depth)
-- ============================================================

alter table data_pipeline.shopify_sync_runs enable row level security;
alter table data_pipeline.shopify_sync_state enable row level security;
alter table data_pipeline.shopify_sync_locks enable row level security;
alter table data_pipeline.shopify_sync_errors enable row level security;
alter table data_pipeline.shopify_backfill_jobs enable row level security;
alter table data_pipeline.shopify_schema_drift enable row level security;
alter table data_pipeline.shopify_customers enable row level security;
alter table data_pipeline.shopify_customer_addresses enable row level security;
alter table data_pipeline.shopify_orders enable row level security;
alter table data_pipeline.shopify_order_addresses enable row level security;
alter table data_pipeline.shopify_order_items enable row level security;
alter table data_pipeline.shopify_line_item_properties enable row level security;
alter table data_pipeline.shopify_note_attributes enable row level security;
alter table data_pipeline.shopify_discount_codes enable row level security;
alter table data_pipeline.shopify_discount_applications enable row level security;
alter table data_pipeline.shopify_discount_allocations enable row level security;
alter table data_pipeline.shopify_fulfillments enable row level security;
alter table data_pipeline.shopify_fulfillment_items enable row level security;
alter table data_pipeline.shopify_shipping_lines enable row level security;
alter table data_pipeline.shopify_refunds enable row level security;
alter table data_pipeline.shopify_transactions enable row level security;
alter table data_pipeline.shopify_refund_line_items enable row level security;
alter table data_pipeline.shopify_order_adjustments enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'shopify_sync_runs',
    'shopify_sync_state',
    'shopify_sync_locks',
    'shopify_sync_errors',
    'shopify_backfill_jobs',
    'shopify_schema_drift',
    'shopify_customers',
    'shopify_customer_addresses',
    'shopify_orders',
    'shopify_order_addresses',
    'shopify_order_items',
    'shopify_line_item_properties',
    'shopify_note_attributes',
    'shopify_discount_codes',
    'shopify_discount_applications',
    'shopify_discount_allocations',
    'shopify_fulfillments',
    'shopify_fulfillment_items',
    'shopify_shipping_lines',
    'shopify_refunds',
    'shopify_transactions',
    'shopify_refund_line_items',
    'shopify_order_adjustments'
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

-- Canonical Shopify tables are not writable by anon or authenticated.
revoke all on data_pipeline.shopify_sync_runs from anon, authenticated;
revoke all on data_pipeline.shopify_sync_state from anon, authenticated;
revoke all on data_pipeline.shopify_sync_locks from anon, authenticated;
revoke all on data_pipeline.shopify_sync_errors from anon, authenticated;
revoke all on data_pipeline.shopify_backfill_jobs from anon, authenticated;
revoke all on data_pipeline.shopify_schema_drift from anon, authenticated;
revoke all on data_pipeline.shopify_customers from anon, authenticated;
revoke all on data_pipeline.shopify_customer_addresses from anon, authenticated;
revoke all on data_pipeline.shopify_orders from anon, authenticated;
revoke all on data_pipeline.shopify_order_addresses from anon, authenticated;
revoke all on data_pipeline.shopify_order_items from anon, authenticated;
revoke all on data_pipeline.shopify_line_item_properties from anon, authenticated;
revoke all on data_pipeline.shopify_note_attributes from anon, authenticated;
revoke all on data_pipeline.shopify_discount_codes from anon, authenticated;
revoke all on data_pipeline.shopify_discount_applications from anon, authenticated;
revoke all on data_pipeline.shopify_discount_allocations from anon, authenticated;
revoke all on data_pipeline.shopify_fulfillments from anon, authenticated;
revoke all on data_pipeline.shopify_fulfillment_items from anon, authenticated;
revoke all on data_pipeline.shopify_shipping_lines from anon, authenticated;
revoke all on data_pipeline.shopify_refunds from anon, authenticated;
revoke all on data_pipeline.shopify_transactions from anon, authenticated;
revoke all on data_pipeline.shopify_refund_line_items from anon, authenticated;
revoke all on data_pipeline.shopify_order_adjustments from anon, authenticated;

grant all on data_pipeline.shopify_sync_runs to service_role;
grant all on data_pipeline.shopify_sync_state to service_role;
grant all on data_pipeline.shopify_sync_locks to service_role;
grant all on data_pipeline.shopify_sync_errors to service_role;
grant all on data_pipeline.shopify_backfill_jobs to service_role;
grant all on data_pipeline.shopify_schema_drift to service_role;
grant all on data_pipeline.shopify_customers to service_role;
grant all on data_pipeline.shopify_customer_addresses to service_role;
grant all on data_pipeline.shopify_orders to service_role;
grant all on data_pipeline.shopify_order_addresses to service_role;
grant all on data_pipeline.shopify_order_items to service_role;
grant all on data_pipeline.shopify_line_item_properties to service_role;
grant all on data_pipeline.shopify_note_attributes to service_role;
grant all on data_pipeline.shopify_discount_codes to service_role;
grant all on data_pipeline.shopify_discount_applications to service_role;
grant all on data_pipeline.shopify_discount_allocations to service_role;
grant all on data_pipeline.shopify_fulfillments to service_role;
grant all on data_pipeline.shopify_fulfillment_items to service_role;
grant all on data_pipeline.shopify_shipping_lines to service_role;
grant all on data_pipeline.shopify_refunds to service_role;
grant all on data_pipeline.shopify_transactions to service_role;
grant all on data_pipeline.shopify_refund_line_items to service_role;
grant all on data_pipeline.shopify_order_adjustments to service_role;

grant execute on function data_pipeline.try_acquire_shopify_sync_lock(text, text, integer) to service_role;
grant execute on function data_pipeline.release_shopify_sync_lock(text, uuid) to service_role;
