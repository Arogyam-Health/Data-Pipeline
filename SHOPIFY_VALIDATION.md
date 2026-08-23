# Shopify Validation (Sheet vs Supabase)

Use this procedure to compare the legacy **Direct Shopify Link** Google Sheet with `analytics.shopify_order_lines`.

Do **not** connect this app to Google Sheets unless that is explicitly configured later. Comparison is manual.

## When to compare

1. Data Pipeline incremental or test sync has finished successfully.
2. The Apps Script incremental sync has also finished.
3. Pick a sample date range that both systems have fully covered.

Because the two pipelines poll independently, a live “right now” comparison will disagree on the newest minutes.

## Queries

### Supabase

```sql
-- Unique orders
select count(distinct shopify_order_id)
from analytics.shopify_order_lines
where created_at_shopify >= '<FROM>'
  and created_at_shopify <  '<TO>';

-- Line-item rows
select count(*)
from analytics.shopify_order_lines
where created_at_shopify >= '<FROM>'
  and created_at_shopify <  '<TO>';

-- Order values and statuses
select
  shopify_order_id,
  order_name,
  financial_status,
  fulfillment_status,
  order_total,
  sku,
  shopify_line_item_id,
  quantity,
  shipping_city,
  utm_source,
  utm_campaign
from analytics.shopify_order_lines
where created_at_shopify >= '<FROM>'
  and created_at_shopify <  '<TO>'
order by shopify_order_id, line_index;
```

Compatibility columns (no Raw JSON):

```sql
select *
from analytics.shopify_direct_link
where created_at >= '<FROM>'
  and created_at <  '<TO>';
```

### Google Sheet

From **Direct Shopify Link**, filter the same Created At window and compare:

- unique Order Id / Order Number
- row count (one row per line item)
- Total Price
- Financial Status / Fulfillment Status
- Cancelled At / Cancel Reason
- Discount Code / Total Discounts
- SKU / line item identity
- quantities
- UTM note attributes (if present as columns or inside the unused raw JSON)
- shipping/billing city

Ignore **Raw Shopify JSON**. That column is intentionally absent in Supabase.

## Acceptance tolerance

| Check | Tolerance |
|-------|-----------|
| Unique orders | exact |
| Line-item rows | exact |
| Order IDs | exact |
| SKU / line item IDs | exact |
| Statuses | exact, allowing GraphQL enum case (`PAID` vs `paid`) |
| Money | difference = 0 except documented timing |
| Cancellations | exact for the closed window |
| UTMs / cities | exact when both systems have the order |

Known acceptable differences:

- GraphQL status enums are uppercase (`PAID`); the sheet may store REST-style lowercase (`paid`)
- Newest orders near the sync boundary
- `customer_last_order_discount_code` is NULL in Supabase
- Staff note only when GraphQL `cancellation.staffNote` is present
- Raw JSON column exists only in the sheet

## Double-counting check

Order revenue must come from `analytics.shopify_orders` (or `order_total` used once per `shopify_order_id`).

Product revenue must come from `line_revenue` / `analytics.shopify_product_performance`.

Never `SUM(order_total)` over `analytics.shopify_order_lines`.
