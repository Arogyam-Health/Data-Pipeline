# Shopify Business Performance — Data Lineage, Metric Definitions and Join Proof

## Scope and evidence status

This document describes the local implementation of the separate Shopify Business
Performance view. It is intentionally Shopify-order-centric: it does not use Meta
attribution, Meta spend, Meta ROAS, or Meta campaign joins.

Read-only validation was run against the configured production Supabase data via
the local API for `2026-08-01` through `2026-09-12`. No write, sync, migration,
or production mutation was performed. Raw Shopify API payloads were not fetched
live; the raw-field excerpts below are the exact repository GraphQL selection and
normalized contract.

## 1. Architecture

```text
Shopify Admin GraphQL
  -> src/modules/shopify/normalizer.ts
  -> data_pipeline.shopify_orders / shopify_refunds
  -> data_pipeline.shopify_order_delivery_remittance (one row/order)
  -> data_pipeline.mart_order_journey_remittance (canonical Journey row/order)
  -> effective remittance membership + canonical delivery outcome
  -> /api/shopify/business-performance
  -> /dashboard/shopify/business
```

The implementation uses the existing Journey delivery classifier and
`shiprocket_effective_remittance_orders`. It does not rebuild shipment matching,
delivery classification, or remittance matching.

## 2. Source inventory

| Source | Used | Purpose |
|---|---:|---|
| Shopify Admin GraphQL | Yes, upstream | Order totals, statuses, gateways, refunds, first-visit UTM fields |
| `shopify_orders` | Yes, normalized | Gross/current totals, financial status, cancellation and order identity |
| `shopify_refunds` | Yes, normalized | Refund-object workflow evidence retained as raw source capability; not displayed as a Business Performance metric |
| `shopify_transactions` | Yes, normalized | Monetary refund evidence when `kind = REFUND`, `status = SUCCESS`, and `amount > 0` |
| `shopify_order_delivery_remittance` | Yes | Existing one-row-per-Shopify-order UTM and Shopify→Shiprocket source |
| `mart_order_journey_remittance` | Yes | Canonical Journey grain, delivery, payment, revenue, remittance |
| `shiprocket_effective_remittance_orders` | Indirectly | Already consumed by the Journey remittance view |
| Meta attribution/spend | No | Explicitly out of scope |
| Raw Shiprocket joins | No | Prevents forward/return and duplicate-AWB reclassification |

## 3. Raw field evidence

The exact GraphQL contract is in `src/modules/shopify/queries.ts` under
`ORDER_FIELDS`; normalization is in `src/modules/shopify/normalizer.ts`.

| Business field | GraphQL path / input | Normalizer | Stored field |
|---|---|---|---|
| Gross Revenue | `order.totalPriceSet.shopMoney.amount` | `moneyBagAmount(node.totalPriceSet)` | `shopify_orders.total_price`, then `ordered_revenue` |
| Current Revenue | `order.currentTotalPriceSet.shopMoney.amount` | `moneyBagAmount(node.currentTotalPriceSet)` | `shopify_orders.current_total_price`, then `current_revenue` |
| Paid | `order.displayFinancialStatus` | `emptyToNull(node.displayFinancialStatus)` | `shopify_orders.financial_status`, then Journey `financial_status` |
| Payment category | `order.paymentGatewayNames` | `classifyPaymentCategory` and Day-3 SQL payment logic | Journey `payment_type` |
| Cancellation | `order.cancelledAt`, `order.cancelReason` | `parseTimestamp`, `emptyToNull` | `shopify_orders.cancelled_at/cancel_reason`; Journey `is_cancelled` |
| Refund object | `order.refunds.nodes` including `refundLineItems` and `refundShippingLines` | `normalizeRefunds` | `shopify_refunds`, `shopify_refund_line_items`, `shopify_order_adjustments` |
| Monetary refund | `order.transactions.nodes` (`kind`, `status`, `amountSet`, `gateway`, `processedAt`, `parentTransaction`) | `normalizeTransactions` | `shopify_transactions` |
| Source | `order.customerJourneySummary.firstVisit.utmParameters.source` | normalized by Shopify order normalizer / Day-2 view | `utm_source_raw` |
| Medium | `...utmParameters.medium` | same | `utm_medium_raw` |
| Campaign | `...utmParameters.campaign` | same | `utm_campaign_raw` |
| Content | `...utmParameters.content` | same | `utm_content_raw` |
| Term | `...utmParameters.term` | same | `utm_term_raw` |

Representative redacted source-contract excerpt (field names only; no customer or
credential data):

```graphql
totalPriceSet { shopMoney { amount currencyCode } }
currentTotalPriceSet { shopMoney { amount currencyCode } }
displayFinancialStatus
cancelledAt
paymentGatewayNames
customerJourneySummary {
  firstVisit {
    utmParameters { source medium campaign content term }
  }
}
refunds(first: $nestedFirst) { nodes { id createdAt refundLineItems { nodes { quantity } } } }
transactions(first: $nestedFirst) { nodes { id amountSet { shopMoney { amount currencyCode } } kind status formattedGateway gateway processedAt parentTransaction { id } } }
```

## 4. Metric dictionary

The backend calculation is centralized in
`src/modules/shopify/business-performance.ts`. All calculations use one
`shopify_order_id` row from `mart_order_journey_remittance`.

| Metric | Definition/formula | Null/zero behavior |
|---|---|---|
| Gross Revenue | `SUM(ordered_revenue)`; original Shopify `total_price` | Numeric zero is retained |
| Current Revenue | `SUM(current_revenue)`; normalized `current_total_price` | Numeric zero is retained |
| Delivered Revenue | `SUM(current_revenue WHERE is_delivered = true)` | Uses canonical Journey delivery |
| Revenue Loss | Gross Revenue − Delivered Revenue | Can be negative only if source totals require it; not clamped |
| Revenue Survival % | Delivered Revenue / Gross Revenue × 100 | Null when gross is zero |
| Orders | `COUNT(DISTINCT shopify_order_id)`; query rejects duplicate Journey rows | Zero for empty cohort |
| Paid | `financial_status = 'paid'`, matching the existing Shopify KPI RPC | Other statuses, including `partially_paid`, are excluded |
| AOV | Gross Revenue / Orders | Null when orders are zero |
| Delivered AOV | Delivered Revenue / Delivered Orders | Null when delivered orders are zero |
| Ship Rate | `physically shipped orders / Orders × 100` | Canonical `is_shipped` requires matched Shiprocket physical lifecycle evidence; AWB assignment alone is excluded; null when orders are zero |
| Delivery Rate | `is_delivered orders / Orders × 100` | Null when orders are zero |
| RTO Rate | `is_rto orders / is_shipped orders × 100` | Null when shipped orders are zero |
| Open NDR Rate | `is_ndr orders / is_shipped orders × 100` | Currently unresolved NDR/undelivered state; delivered and RTO orders are excluded; null when shipped is zero |
| Cancel Rate | Shopify orders with non-null normalized `shopify_orders.cancelled_at` / Orders × 100 | Shopify cancellation evidence; separate from Journey shipment cancellation; null when orders are zero |

### Post-shipment outcome funnel

The post-shipment funnel is based only on rows where canonical Journey
`is_shipped = true`. Canonical `is_shipped` requires a matched Shiprocket
order plus physical lifecycle evidence: a recognized picked-up, shipped,
in-transit, out-for-delivery, delivered, RTO, NDR, or undelivered status/scan,
status ID 7, or a non-empty delivered date. AWB assignment, pickup scheduling,
and an `OUT FOR PICKUP` scan alone do not qualify. Each shipped order is
classified exactly once:

- `DELIVERED`: `is_delivered = true`.
- `RTO_NDR`: `is_rto = true OR is_ndr = true`.
- `ACTIVE`: neither delivered, RTO, nor open NDR, and the canonical
  `shiprocket_status_bucket` or raw status is one of picked up, shipped, in
  transit, or out for delivery.
- `UNCLASSIFIED`: shipped but not supported by one of the above states; these
  rows are surfaced explicitly and prevent a false reconciliation claim.

Active Shipment %, Delivered After Shipment %, and RTO + Open NDR % all use
shipped orders as their denominator. The final buckets are mutually exclusive;
historical `had_ndr` is not used. Payment and marketing-source breakdowns reuse
the same classifier and retain UNKNOWN/OTHER payment orders outside the COD /
PREPAID comparison.

`is_shipped`, `is_delivered`, `is_rto`, and `is_ndr` are consumed from the
existing canonical Journey source. `had_ndr` remains available as historical
evidence but is not used for Open NDR Rate. Shopify cancellation is sourced
from normalized `shopify_orders.cancelled_at`; Journey `is_cancelled` remains
the Shiprocket operational cancellation signal and is not used for this
Shopify Business Performance Cancel Rate.

Refund lineage remains documented as raw source capability, but no Refund Rate
is currently displayed in Shopify Business Performance. In the audited cohort,
183 refund objects exactly overlapped Shopify-cancelled orders, while only 2
positive successful `REFUND` transactions existed. Refund objects and
transactions remain available for future, separately approved metrics.

## 5. Join dictionary and grain proof

1. `mart_order_journey_remittance` → UTM view
   - Key: `shopify_order_id`
   - Expected cardinality: one-to-one because both are established order-level
     views.
   - Protection: the loader rejects duplicate IDs after the merge.

2. Journey remittance source → effective remittance
   - This dependency is already implemented by
     `mart_order_journey_remittance`, whose latest-remittance CTE reads
     `shiprocket_effective_remittance_orders`.
   - Historical raw canonical remittance rows do not become current evidence.

The validated API response proved the following checks:

```text
BASE_ROWS = 2395
BASE_DISTINCT_ORDERS = 2395
POST_JOURNEY_ROWS = 2395
POST_JOURNEY_DISTINCT_ORDERS = 2395
POST_REMITTANCE_ROWS = 2395
POST_REMITTANCE_DISTINCT_ORDERS = 2395
```

The loader fails if the primary Journey source has duplicate Shopify IDs.

## 6. Revenue waterfall lineage

| Stage | Source/formula |
|---|---|
| Gross | `SUM(ordered_revenue)` |
| Current | `SUM(current_revenue)` |
| Shipped | `SUM(current_revenue WHERE is_shipped)` |
| Delivered | `SUM(current_revenue WHERE is_delivered)` |
| Remitted | `SUM(remitted_amount WHERE payment_type='COD' AND remittance_status='REMITTED')` |

Remitted is not a total-business-revenue stage. It is COD settlement evidence;
prepaid orders do not enter Shiprocket COD remittance. The UI labels and tooltip
state that limitation rather than subtracting COD settlement from total delivered
revenue.

## 7. Payment classification

The view uses the existing Journey `payment_type` classifier. Its Shopify-side
inputs are `shopify_payment_gateway_names`; the established SQL recognizes
cash-on-delivery/cash/COD as COD and recognized online gateways as PREPAID. The
normalizer independently documents `COD`, `PREPAID`, `OTHER`, and `UNKNOWN`.

The visible comparison contains COD and PREPAID only. UNKNOWN/OTHER orders are
reported separately and are not silently merged into either group.

## 8. Marketing source lineage

The hierarchy is:

```text
Source > Medium > Campaign > Content > Term
```

It uses Shopify `customerJourneySummary.firstVisit.utmParameters` through the
existing normalized `utm_*_raw` fields. Missing or empty values are displayed and
grouped as `(not set)`. They are not treated as Meta.

## 9. Real reconciliation examples

Read-only redacted technical samples from the validation cohort:

| Shopify order key | Shopify total | Journey ordered | Shopify current | Journey current | Payment | Shipment state |
|---|---:|---:|---:|---:|---|---|
| `8727796646174` | 5940 | 5940 | 0 | 0 | COD | RTO |
| `8727828955422` | 10140 | 10140 | 0 | 0 | COD | RTO |
| `8727971660062` | 5940 | 5940 | 0 | 0 | COD | RTO |

Aggregate proof:

```text
SUM Shopify total_price       = 16,489,600
SUM Journey ordered_revenue   = 16,489,600
Difference                    = 0
SUM Shopify current_total     = 13,398,600
SUM Journey current_revenue   = 13,398,600
Difference                    = 0
```

The canonical Journey delivery fields were consumed without reclassification.
The physical-shipment audit found three AWB-only cancelled rows in the
2026-08-25 through 2026-08-31 cohort; the proposed follow-up migration
`053_physical_shipment_is_shipped.sql` changes only the canonical
`is_shipped` evidence rule and leaves delivery, RTO, NDR, and remittance
classification unchanged.
The cohort counts were shipped 2,085, delivered 1,767, RTO 235, and historical
NDR 394.

## 10. Grain validation

The read-only validation returned the five counts in Section 5 as 2,395 each.
Existing Shopify KPI reconciliation for the same window was exact:

| Metric | Existing Shopify analytics | Business Performance | Difference |
|---|---:|---:|---:|
| Orders | 2,395 | 2,395 | 0 |
| Gross Revenue | 16,489,600 | 16,489,600 | 0 |
| Paid | 1,830 | 1,830 | 0 |
| AOV | 6,885.01 | 6,885.01 | 0 |

The final Paid definition is `financial_status = PAID` only. The cohort contained
PAID 1,830, PARTIALLY_PAID 0, PENDING 107, REFUNDED 1, and VOIDED 457.

Payment parity audit: 2,395 rows were compared; 2,389 matched and 6 differed.
Those six were OTHER gateway rows classified as PREPAID by the existing Journey
SQL classifier. They are not merged into COD. UNKNOWN/OTHER payment orders are
reported separately from the visible COD/PREPAID comparison.

Refund source audit remains outside the displayed Business Performance metric
scope. Persisted refund objects, refund line items, adjustments, and
transactions are retained as Shopify source capabilities.

Revenue waterfall validation:

```text
Gross     = 16,489,600
Current   = 13,398,600
Shipped   = 13,166,660
Delivered = 12,236,300
Remitted  = 0
COD delivered revenue     = 4,923,540
PREPAID delivered revenue = 7,312,760
```

The zero Remitted value is correct for the current effective-remittance state.
UTM parity was confirmed from the existing Shopify delivery view; for example,
order `8727796646174` exposed `ig / Instagram_Feed / 120249703020700275 /
120249745727660275 / 120249724747030275`, and the Business Performance grouping
uses the same `utm_*_raw` values. Root Source groups partitioned the 2,395-order
cohort; drilling down preserves the same order grain.

## 11. Known limitations

- Raw Shopify API payload values were not fetched live; the repository GraphQL contract was used for raw-field proof.
- Missing UTM fields are grouped as `(not set)`.
- UNKNOWN/OTHER payment categories are excluded from the COD/PREPAID comparison.
- Remitted is COD-only settlement evidence, not a universal revenue stage.
- No Refund Rate is currently displayed; refund data remains available for
  future metric work after a separate business-definition decision.
- Current Revenue follows Shopify's persisted current-total field; this view does
  not independently recompute refund or edit arithmetic.
- Date filtering follows the existing Journey convention: Shopify order-created
  date, with the Journey SQL date basis and the supplied ISO range.

## 12. File map

| File | Role |
|---|---|
| `src/modules/shopify/queries.ts` | Shopify GraphQL source contract |
| `src/modules/shopify/normalizer.ts` | Raw Shopify normalization and payment/UTM extraction |
| `src/modules/shopify/business-performance.ts` | Canonical backend metrics and aggregation |
| `app/api/shopify/business-performance/route.ts` | Authenticated date/hierarchy API |
| `app/dashboard/shopify/business/page.tsx` | Separate constrained Shopify Business Performance UI |
| `app/dashboard/shopify/business/business.css` | Presentation, responsive table, and portal tooltip styling |
| `supabase/migrations/036_shopify_order_delivery_remittance.sql` | Shopify→Shiprocket order-level view |
| `supabase/migrations/037_canonical_order_journey.sql` | One-row-per-Shopify canonical Journey mart |
| `supabase/migrations/040_customer_journey_profitability_canonical_metrics.sql` | Current revenue derivation |
| `supabase/migrations/049_effective_remittance_membership.sql` | Active remittance membership view |
| `supabase/migrations/050_switch_journey_to_effective_remittance.sql` | Current Journey remittance source switch |
| `supabase/migrations/052_canonical_delivery_date_parity.sql` | Current canonical delivery/date semantics |
| `src/__tests__/shopify.test.ts` | Shopify normalization and business metric regression tests |

## PDF status

`docs/shopify-business-performance-data-lineage.pdf` was not generated because
this repository has no installed PDF renderer or PDF-generation dependency. The
Markdown source is complete; creating a fake or empty PDF would not meet the
lineage requirement.
