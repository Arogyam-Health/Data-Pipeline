# Day 5 — Customer Journey & Profitability

**Status:** Implemented and runtime-verified against the configured Supabase project on 2026-09-06.  
**Route:** `/dashboard/journey`  
**Migration:** `supabase/migrations/038_customer_journey_profitability.sql`  
**Validation:** `docs/sql/day5_customer_journey_profitability_validation.sql`

## Business flow

The dashboard starts from **all Shopify orders**, not only Meta-attributed or shipped orders:

`Meta campaign → ad set → ad → UTM evidence → Shopify order → Shiprocket → delivery outcome → CRF/UTR`

Missing steps are explicit (`NO_META_MATCH` for Meta entity attribution, `UNKNOWN` for genuinely missing channel evidence, `NOT MATCHED`, `NOT AVAILABLE`, or `DELIVERED_NOT_REMITTED`). Raw shipment scans are fetched only for an opened order and never joined into the canonical order-grain mart. See `docs/CUSTOMER_JOURNEY_V1_CORRECTION.md` for the corrected channel-vs-Meta model.

## Data contracts

- `analytics.mart_order_journey`: Day 4 canonical mart, exactly one row per Shopify order.
- `analytics.order_journey_explorer`: adds UTM evidence, creative, conflict explanation, Shopify current/net value, refunds, cancellation, completeness, and remittance delay.
- `analytics.mart_meta_commerce_daily`: daily campaign/adset/ad mart. Meta facts and order journeys are aggregated independently before their join.
- `analytics.journey_data_freshness`: last successful timestamp for Meta, Shopify, Shiprocket, and remittance.

The APIs deliberately query the already-applied Day 4 source views and can run before migration 038 is deployed. Migration 038 provides the same reusable database-facing business contract for BI tools.

## Attribution definitions

- `EXACT_AD`: `Shopify utm_content = Meta ad_id`; adset and campaign are resolved from the Meta ad.
- `EXACT_ADSET`: no exact ad; `Shopify utm_term = Meta adset_id`; campaign is resolved from the ad set.
- `EXACT_CAMPAIGN`: no lower-level match; `Shopify utm_campaign = Meta campaign_id`.
- `META_SOURCE_ONLY`: verified Meta-like `utm_source`, without an exact hierarchy match.
- `NO_META_MATCH`: no deterministic Meta hierarchy/entity attribution. The order remains visible; it may still have a known non-Meta channel such as DIRECT or GOOGLE.
- `hierarchy_conflict`: a lower-level exact match exists, but supplied higher-level UTM IDs disagree. The exact lower-level result is retained and the conflict is shown.

## Revenue and ROAS

- **Shopify attributed revenue:** Shopify order/current revenue for exact Meta-attributed orders.
- **Delivered revenue:** Shopify revenue only where Shiprocket says `DELIVERED`. RTO and cancelled orders contribute zero.
- **Meta reported ROAS:** Meta purchase value / Meta spend.
- **Shopify attributed ROAS:** attributed Shopify revenue / Meta spend.
- **Delivered ROAS:** attributed delivered Shopify revenue / Meta spend.

Shiprocket `order_total` and `payment_method` are not commerce truth. The journey uses Shopify value and payment gateway/category.

## Runtime proof (2026-08-01 through 2026-09-06)

- 1,903 Shopify order journeys
- 1,309 exact Meta hierarchy-attributed orders
- 1,137 exact-ad orders
- 1,589 Shopify → Shiprocket matches
- 1,028 delivered orders
- 120 RTO and 55 NDR
- ₹1,511,433.97 Meta spend
- ₹8,909,300 attributed Shopify revenue
- ₹4,572,460 delivered revenue
- Meta reported ROAS 6.73
- Shopify attributed ROAS 5.89
- Delivered ROAS 3.03

These values are live snapshots and must be recalculated; they are not fixtures or hardcoded dashboard values.

## Remittance finding

The database contains one actual CRF and 48 stored AWB rows (46 distinct AWBs). All 48 rows currently match 44 Shiprocket orders, but those 44 Shiprocket orders have no Shopify enrichment link and their normalized order references have zero overlap with the currently synced Shopify order population. Therefore current canonical results legitimately show:

- delivered COD: 440
- delivered COD with linked remittance: 0
- delivered COD without linked remittance: 440

The remittance file covers deliveries dated 2026-08-11/12 and an AWB remittance date of 2026-08-21. To produce an end-to-end CRF/UTR journey, the corresponding Shopify order history/mapping must be present. No CRF/UTR was fabricated.

The table contains four legacy duplicates relative to the latest 44-row workbook, created while identifier normalization was being corrected across earlier imports. Current imports are idempotent on `(crf_id, awb, order_id)`; the legacy rows do not link to current Shopify journeys and do not affect current delivered-remittance KPIs. They should be reviewed before any cleanup rather than deleted automatically.

## APIs and privacy

- `GET /api/journey/orders`: server-side filters, pagination, search, and summary.
- `GET /api/journey/orders/:shopifyOrderId`: safe order detail and source-backed timeline.
- `GET /api/journey/profitability`: campaign/adset/ad aggregation and ROAS.
- `GET /api/journey/freshness`: source timestamps.

The explorer exposes only Shopify customer ID as an optional safe identifier. It does not select or return customer phone, email, address, IP, raw payment IDs, or Shiprocket raw payload.

## COD messaging connector

The repository has Pabbly/WATI delivery forwarding, but no canonical COD confirmation dataset with `confirmed`, `cancelled`, and `unconfirmed` states. COD messaging confirmation integration remains a separate next connector and does not block Day 1–5.
