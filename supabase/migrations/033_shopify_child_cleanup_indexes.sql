-- Speed up Shopify child-table lookups and stale-row cleanup during sync persistence.

create index if not exists idx_shopify_line_item_properties_business_key
  on data_pipeline.shopify_line_item_properties (business_key);

create index if not exists idx_shopify_discount_allocations_order_item_key
  on data_pipeline.shopify_discount_allocations (order_item_business_key);

create index if not exists idx_shopify_discount_applications_order_id
  on data_pipeline.shopify_discount_applications (shopify_order_id);

create index if not exists idx_shopify_fulfillment_items_fulfillment_id
  on data_pipeline.shopify_fulfillment_items (shopify_fulfillment_id);

create index if not exists idx_shopify_shipping_lines_order_id
  on data_pipeline.shopify_shipping_lines (shopify_order_id);

create index if not exists idx_shopify_refund_line_items_refund_id
  on data_pipeline.shopify_refund_line_items (shopify_refund_id);

create index if not exists idx_shopify_refund_line_items_order_id
  on data_pipeline.shopify_refund_line_items (shopify_order_id);

create index if not exists idx_shopify_order_adjustments_refund_id
  on data_pipeline.shopify_order_adjustments (shopify_refund_id);

create index if not exists idx_shopify_order_adjustments_order_id
  on data_pipeline.shopify_order_adjustments (shopify_order_id);
