# Customer Journey V1 correction

## Attribution model

Customer Journey has two independent dimensions:

- `channel_attribution`: `META`, `DIRECT`, `GOOGLE`, `KWIKENGAGE`, `OTHER`, or `UNKNOWN`.
- `meta_attribution`: `EXACT_AD`, `EXACT_ADSET`, `EXACT_CAMPAIGN`, `META_SOURCE_ONLY`, or `NO_META_MATCH`.

`DIRECT`, `GOOGLE`, `KWIKENGAGE`, and `OTHER` are known acquisition channels. They are not attribution failures. `NO_META_MATCH` only means that no deterministic Meta entity was resolved. Exact Meta IDs override weak source text, while `meta_hierarchy_conflict` preserves contradictory UTM evidence.

The additive migration `039_customer_journey_attribution_semantics.sql` provides v2 compatibility views. It must be applied through the normal Supabase deployment process; the current workspace has no database deployment credentials. Until then, the application normalizes the live legacy view into the canonical fields at the API boundary.

## Filter semantics

Date, channel, campaign, ad set, ad, Meta attribution, and payment define the acquisition cohort and drive acquisition KPIs and campaign performance. Shipment outcome, delivered/RTO/NDR, courier, remittance, and order/AWB/SR search are outcome filters and drive only outcome KPIs and the explorer. Campaign performance is explicitly based on the complete selected acquisition cohort.

## Revenue and ROAS

Shopify is the commerce source of truth. Delivered revenue is Shopify revenue for delivered orders; RTO and cancelled orders do not contribute. Meta, Shopify-attributed, and delivered ROAS each use Meta spend as the denominator and are not net profit: COGS, shipping, COD, gateway, and RTO cost inputs are not currently present in the canonical journey model.

## Current live audit snapshot (6 Sep 2026)

The live database contained 1,929 Shopify orders. Channel counts were META 1,322, DIRECT 501, GOOGLE 22, KWIKENGAGE 50, OTHER 14, UNKNOWN 20 (98.96% known channel). Meta states were EXACT_AD 1,150, EXACT_ADSET 174, EXACT_CAMPAIGN 0, META_SOURCE_ONLY 10, and NO_META_MATCH 595 (68.53% deterministic exact Meta entity coverage). There were 446 hierarchy conflicts.

The canonical journey view returned one row per Shopify order (1,929 rows and 1,929 distinct order IDs). Shiprocket matched 1,600 orders; 301 were not matched and 28 were ambiguous. Delivery outcomes included 1,030 delivered, 128 RTO, 55 NDR, 332 in transit, 55 cancelled, and 329 not shipped.

The remittance import contained one CRF and 48 AWB-level rows (46 distinct AWBs), all matched to Shiprocket but none to the current Shopify cohort. Therefore current delivered COD remittance is zero and delivered-not-remitted is 440; this is an imported-data coverage issue, not fabricated settlement data.

## Separate future connector

No canonical WATI/KwikEngage COD-confirmation event stream is currently available. Confirmed/cancelled/unconfirmed COD messaging analysis remains a separate connector and does not block the journey model.
