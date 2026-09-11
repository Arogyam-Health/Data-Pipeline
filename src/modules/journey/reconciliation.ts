import { resolveCanonicalDeliveryState, type CanonicalDeliveryState } from "@/modules/shiprocket/status";

export type RemittanceReconciliationReason =
  | "OK_DELIVERED_COD_REMITTED"
  | "DELIVERY_STATUS_CONFLICT_RESOLVED_BY_SCAN"
  | "NO_SHOPIFY_MATCH"
  | "NON_COD_REMITTANCE"
  | "PAYMENT_UNKNOWN"
  | "OUTSIDE_CUSTOMER_JOURNEY_COHORT"
  | "JOURNEY_ROW_MISSING"
  | "REMITTANCE_FOUND_NOT_DELIVERED"
  | "REMITTANCE_UNMATCHED"
  | "REMITTANCE_AMBIGUOUS"
  | "MISSING_UTR"
  | "MISSING_REMITTANCE_DATE";

export interface RemittanceSourceRow {
  crf_id?: unknown; awb?: unknown; order_id?: unknown; matched_sr_order_id?: unknown;
  match_status?: unknown; match_method?: unknown; match_reason_code?: unknown;
  remittance_date?: unknown; utr?: unknown; order_value?: unknown; total_adjusted_amt?: unknown;
}

export interface ReconciliationShipment extends Record<string, unknown> {
  sr_order_id?: unknown; shipment_status?: unknown; current_status?: unknown;
  shipment_status_id?: unknown; current_status_id?: unknown; delivered_date?: unknown;
  status_bucket?: unknown; awb?: unknown; payment_bucket?: unknown; payment_method?: unknown;
  scans?: Array<Record<string, unknown>>;
}

export interface ReconciliationJourneyRow extends Record<string, unknown> {
  shopify_order_id?: unknown; created_at_shopify?: unknown; order_date?: unknown;
  shiprocket_sr_order_id?: unknown; payment_type?: unknown; is_cod?: unknown;
  is_delivered?: unknown; delivery_outcome?: unknown; remittance_status?: unknown;
}
export interface ReconciliationShopifySource extends Record<string, unknown> {
  shopify_order_id?: unknown; order_number?: unknown; order_name?: unknown;
  created_at_shopify?: unknown; payment_gateway_names?: unknown;
}

export interface RemittanceReconciliationRow {
  source: RemittanceSourceRow;
  shipment: ReconciliationShipment | null;
  journey: ReconciliationJourneyRow | null;
  shopify: ReconciliationShopifySource | null;
  delivery: CanonicalDeliveryState | null;
  /** Shopify enrichment says this shipment maps to a Shopify order. */
  hasShopifyMatch: boolean;
  paymentType: "COD" | "PREPAID" | "UNKNOWN";
  insideJourneyCohort: boolean;
  includedInJourney: boolean;
  finalReason: RemittanceReconciliationReason;
}

function text(value: unknown): string { return String(value ?? "").trim(); }
function isCod(row: ReconciliationJourneyRow | null, shopify: ReconciliationShopifySource | null, shipment: ReconciliationShipment | null): boolean {
  if (String(row?.payment_type || "").toUpperCase() === "COD" || row?.is_cod === true || text(row?.is_cod).toLowerCase() === "true") return true;
  if (/cash.?on.?delivery|cod/i.test(text(shopify?.payment_gateway_names))) return true;
  return String(shipment?.payment_bucket || "").toUpperCase() === "COD" || /cod|cash/i.test(text(shipment?.payment_method));
}
function paymentType(row: ReconciliationJourneyRow | null, shopify: ReconciliationShopifySource | null, shipment: ReconciliationShipment | null): "COD" | "PREPAID" | "UNKNOWN" {
  if (isCod(row, shopify, shipment)) return "COD";
  if (String(row?.payment_type || "").toUpperCase() === "PREPAID" || String(shipment?.payment_bucket || "").toUpperCase() === "PREPAID") return "PREPAID";
  if (/(prepaid|razorpay|stripe|online|upi|card|netbanking)/i.test(text(shopify?.payment_gateway_names))) return "PREPAID";
  return "UNKNOWN";
}
function inCohort(row: ReconciliationJourneyRow | null, shopify: ReconciliationShopifySource | null, from?: string, to?: string): boolean {
  const day = text(row?.order_date || row?.created_at_shopify || shopify?.created_at_shopify).slice(0, 10);
  return Boolean(day) && (!from || day >= from) && (!to || day <= to);
}

export function reconcileRemittanceRows(
  sourceRows: RemittanceSourceRow[],
  shipments: Map<string, ReconciliationShipment>,
  journeyRows: Map<string, ReconciliationJourneyRow>,
  shopifyRows: Map<string, ReconciliationShopifySource> = new Map(),
  cohort?: { from?: string; to?: string },
): RemittanceReconciliationRow[] {
  return sourceRows.map((source) => {
    const matchStatus = text(source.match_status).toLowerCase();
    const srId = text(source.matched_sr_order_id);
    const shipment = srId ? shipments.get(srId) || null : null;
    const journey = srId ? journeyRows.get(srId) || null : null;
    const shopify = text(shipment?.shopify_order_identifier) ? shopifyRows.get(text(shipment?.shopify_order_identifier)) || null : null;
    // Keep Shopify enrichment and Journey-mart linkage as separate facts. A
    // shipment can have a valid Shopify order while its one-row Journey mart
    // link is missing (which is a Journey-row problem, not a Shopify-match
    // problem).
    const hasShopifyMatch = Boolean(
      shipment && shipment.shopify_matched !== false &&
      (text(shipment.shopify_order_identifier) || text(shipment.order_id_shopify_format)),
    );
    const delivery = shipment ? resolveCanonicalDeliveryState({
      statusBucket: shipment.status_bucket, shipmentStatus: shipment.shipment_status,
      currentStatus: shipment.current_status, shipmentStatusId: shipment.shipment_status_id,
      currentStatusId: shipment.current_status_id, deliveredDate: text(shipment.delivered_date) || null,
      awb: shipment.awb, scans: shipment.scans || [],
    }) : null;
    const type = paymentType(journey, shopify, shipment);
    const inside = inCohort(journey, shopify, cohort?.from, cohort?.to);
    const hasDate = Boolean(text(source.remittance_date));
    const hasUtr = Boolean(text(source.utr));
    let finalReason: RemittanceReconciliationReason;
    if (matchStatus === "unmatched") finalReason = "REMITTANCE_UNMATCHED";
    else if (matchStatus === "ambiguous") finalReason = "REMITTANCE_AMBIGUOUS";
    else if (!hasShopifyMatch) finalReason = "NO_SHOPIFY_MATCH";
    else if (!journey) finalReason = "JOURNEY_ROW_MISSING";
    else if (!inside) finalReason = "OUTSIDE_CUSTOMER_JOURNEY_COHORT";
    else if (type === "UNKNOWN") finalReason = "PAYMENT_UNKNOWN";
    else if (type !== "COD") finalReason = "NON_COD_REMITTANCE";
    else if (!delivery?.isDelivered) finalReason = "REMITTANCE_FOUND_NOT_DELIVERED";
    else if (!hasUtr) finalReason = "MISSING_UTR";
    else if (!hasDate) finalReason = "MISSING_REMITTANCE_DATE";
    else if (delivery.statusConflict) finalReason = "DELIVERY_STATUS_CONFLICT_RESOLVED_BY_SCAN";
    else finalReason = "OK_DELIVERED_COD_REMITTED";
    return { source, shipment, journey, shopify, delivery, hasShopifyMatch, paymentType: type, insideJourneyCohort: inside, includedInJourney: finalReason === "OK_DELIVERED_COD_REMITTED" || finalReason === "DELIVERY_STATUS_CONFLICT_RESOLVED_BY_SCAN", finalReason };
  });
}

export function summarizeRemittanceReconciliation(rows: RemittanceReconciliationRow[]) {
  const count = (predicate: (row: RemittanceReconciliationRow) => boolean) => rows.filter(predicate).length;
  return {
    sourceRows: rows.length,
    shiprocketMatched: count((row) => text(row.source.match_status).toLowerCase() === "matched"),
    canonicalDelivered: count((row) => Boolean(row.delivery?.isDelivered)),
    cod: count((row) => row.paymentType === "COD"),
    prepaid: count((row) => row.paymentType === "PREPAID"),
    unknown: count((row) => row.paymentType === "UNKNOWN"),
    shopifyMatched: count((row) => row.hasShopifyMatch),
    noShopifyMatch: count((row) => !row.hasShopifyMatch),
    journeyRowsExist: count((row) => Boolean(row.journey)),
    journeyRowsMissing: count((row) => !row.journey && row.hasShopifyMatch),
    insideJourneyCohort: count((row) => row.insideJourneyCohort),
    outsideJourneyCohort: count((row) => Boolean(row.journey) && !row.insideJourneyCohort),
    finalDeliveredCodRemitted: count((row) => row.includedInJourney),
    needsReview: count((row) => !row.includedInJourney),
    reasons: rows.reduce<Record<string, number>>((result, row) => { result[row.finalReason] = (result[row.finalReason] || 0) + 1; return result; }, {}),
  };
}
