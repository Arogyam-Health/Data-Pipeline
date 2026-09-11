export type ShiprocketStatusBucket =
  | "delivered"
  | "in_transit"
  | "out_for_delivery"
  | "rto"
  | "ndr"
  | "other";

export type CanonicalDeliveryOutcome = "DELIVERED" | "RTO" | "NDR_OPEN" | "IN_TRANSIT" | "CANCELLED" | "UNKNOWN";

export interface DeliveryStateInput {
  statusBucket?: unknown;
  shipmentStatus?: unknown;
  currentStatus?: unknown;
  shipmentStatusId?: unknown;
  currentStatusId?: unknown;
  orderStatus?: unknown;
  deliveredDate?: string | null;
  awb?: unknown;
  scans?: Array<Record<string, unknown>>;
}

/** Shared shipment-direction rule used when choosing a primary Shopify shipment. */
export function isReturnShipment(input: {
  isReturn?: unknown;
  orderId?: unknown;
  returnAwbCode?: unknown;
  shipmentStatus?: unknown;
  currentStatus?: unknown;
}): boolean {
  return input.isReturn === true
    || normalized(input.isReturn) === "TRUE"
    || /^R_/i.test(String(input.orderId ?? "").trim())
    ;
}

export interface CanonicalDeliveryState {
  outcome: CanonicalDeliveryOutcome;
  isDelivered: boolean;
  isRto: boolean;
  isNdr: boolean;
  deliveredDate: string | null;
  source: "STATUS" | "DELIVERED_DATE" | "SCAN_TIMELINE" | "UNKNOWN";
  statusConflict: boolean;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function isRtoText(value: unknown): boolean {
  return normalized(value).includes("RTO") || normalized(value).includes("RETURN TO");
}

function isForwardDeliveryScan(scan: Record<string, unknown>): boolean {
  const text = [scan.status, scan.sr_status_label, scan.activity, scan.sr_status].map(normalized).join(" ");
  if (isRtoText(text) || text.includes("RETURN")) return false;
  return normalized(scan.sr_status) === "7"
    || normalized(scan.sr_status_label) === "DELIVERED"
    || text.includes("000-T-DL")
    || text.includes("SHIPMENT DELIVERED");
}

function isRtoScan(scan: Record<string, unknown>): boolean {
  return isRtoText([scan.status, scan.sr_status_label, scan.activity].map(normalized).join(" "));
}

function latestScan(scans: Array<Record<string, unknown>>): Record<string, unknown> | null {
  return [...scans].sort((left, right) =>
    String(left.scan_date ?? left.date ?? "").localeCompare(String(right.scan_date ?? right.date ?? ""))
      || Number(left.scan_index ?? 0) - Number(right.scan_index ?? 0)
  ).at(-1) || null;
}

/** One delivery interpretation shared by operational, remittance, and Journey code. */
export function resolveCanonicalDeliveryState(input: DeliveryStateInput): CanonicalDeliveryState {
  const shipment = normalized(input.shipmentStatus);
  const current = normalized(input.currentStatus);
  const scans = input.scans || [];
  const latest = latestScan(scans);
  if (shipment.includes("CANCEL") || current.includes("CANCELED") || normalized(input.orderStatus) === "NEW") {
    return { outcome: "CANCELLED", isDelivered: false, isRto: false, isNdr: false, deliveredDate: null, source: "STATUS", statusConflict: false };
  }
  const rto = isRtoText(shipment) || isRtoText(current);
  if (rto || (latest && isRtoScan(latest))) return { outcome: "RTO", isDelivered: false, isRto: true, isNdr: false, deliveredDate: null, source: "STATUS", statusConflict: false };

  if (shipment === "DELIVERED" || current === "DELIVERED" || normalized(input.shipmentStatusId) === "7" || normalized(input.currentStatusId) === "7") {
    return { outcome: "DELIVERED", isDelivered: true, isRto: false, isNdr: false, deliveredDate: input.deliveredDate || null, source: "STATUS", statusConflict: false };
  }
  if (input.deliveredDate) {
    return { outcome: "DELIVERED", isDelivered: true, isRto: false, isNdr: false, deliveredDate: input.deliveredDate, source: "DELIVERED_DATE", statusConflict: false };
  }
  const deliveryScan = scans.find(isForwardDeliveryScan);
  if (deliveryScan) {
    return { outcome: "DELIVERED", isDelivered: true, isRto: false, isNdr: false, deliveredDate: String(deliveryScan.scan_date || deliveryScan.date || "") || null, source: "SCAN_TIMELINE", statusConflict: true };
  }
  const bucket = normalized(input.statusBucket);
  if (bucket === "DELIVERED") return { outcome: "DELIVERED", isDelivered: true, isRto: false, isNdr: false, deliveredDate: null, source: "STATUS", statusConflict: false };
  if (bucket === "RTO") return { outcome: "RTO", isDelivered: false, isRto: true, isNdr: false, deliveredDate: null, source: "STATUS", statusConflict: false };
  if (bucket === "NDR") return { outcome: "NDR_OPEN", isDelivered: false, isRto: false, isNdr: true, deliveredDate: null, source: "STATUS", statusConflict: false };
  const ndr = shipment === "UNDELIVERED" || current === "UNDELIVERED" || shipment.includes("NDR") || current.includes("NDR");
  if (ndr) return { outcome: "NDR_OPEN", isDelivered: false, isRto: false, isNdr: true, deliveredDate: null, source: "STATUS", statusConflict: false };
  if (shipment.includes("TRANSIT") || current.includes("TRANSIT") || input.awb) {
    return { outcome: "IN_TRANSIT", isDelivered: false, isRto: false, isNdr: false, deliveredDate: null, source: "STATUS", statusConflict: false };
  }
  return { outcome: "UNKNOWN", isDelivered: false, isRto: false, isNdr: false, deliveredDate: null, source: "UNKNOWN", statusConflict: false };
}

export function classifyShiprocketStatus(
  shipmentStatus?: string | null,
  currentStatus?: string | null
): ShiprocketStatusBucket {
  const resolved = resolveCanonicalDeliveryState({ shipmentStatus, currentStatus });
  if (resolved.outcome === "DELIVERED") return "delivered";
  if (resolved.outcome === "RTO") return "rto";
  if (resolved.outcome === "NDR_OPEN") return "ndr";
  const text = `${shipmentStatus ?? ""} ${currentStatus ?? ""}`.toUpperCase();
  if (text.includes("RTO")) return "rto";
  if (text.includes("NDR")) return "ndr";
  if (text.includes("OUT FOR DELIVERY")) return "out_for_delivery";
  if (text.includes("DELIVERED")) return "delivered";
  if (text.includes("TRANSIT")) return "in_transit";
  return "other";
}

export function classifyPaymentBucket(paymentMethod?: string | null): "COD" | "Prepaid" | "" {
  const value = String(paymentMethod ?? "").trim();
  if (!value) return "";
  if (value.toUpperCase().includes("COD")) return "COD";
  return "Prepaid";
}

export interface OverviewRowInput {
  sr_order_id?: string | null;
  status_bucket?: string | null;
  shipment_status?: string | null;
  current_status?: string | null;
  shipment_status_id?: string | number | null;
  current_status_id?: string | number | null;
  delivered_date?: string | null;
  awb?: string | null;
  scans0_status?: string | null;
  scans0_sr_status_label?: string | null;
  scans0_sr_status?: string | number | null;
  scans0_date?: string | null;
  scans0_activity?: string | null;
  scans1_status?: string | null;
  scans1_sr_status_label?: string | null;
  scans1_sr_status?: string | number | null;
  scans1_date?: string | null;
  scans1_activity?: string | null;
  payment_method?: string | null;
  payment_bucket?: string | null;
  order_total_num?: number | string | null;
  shopify_current_total_price?: number | string | null;
  shopify_payment_category?: string | null;
  remittance_count?: number | null;
  remittance_match_status?: string | null;
  latest_crf_id?: string | null;
  latest_utr?: string | null;
  latest_remittance_amount?: number | string | null;
  latest_order_settlement_value?: number | string | null;
  shopify_order_identifier?: string | null;
  customer_phone_shopify?: string | null;
  pabbly_status?: string | null;
  pabbly_attempt_count?: number | null;
  pabbly_sent_at?: string | null;
  pabbly_delivery_count?: number | null;
  pabbly_sent_count?: number | null;
  pabbly_failed_count?: number | null;
}

export interface ShiprocketOverview {
  totalOrders: number;
  delivered: number;
  inTransit: number;
  outForDelivery: number;
  rto: number;
  ndr: number;
  deliveryRate: number;
  codOrders: number | null;
  prepaidOrders: number | null;
  totalOrderValue: number | null;
  commercialDataAvailable: boolean;
  commercialSource: "SHIPROCKET" | "SHOPIFY_ENRICHED" | "NOT_AVAILABLE";
  settledOrders: number;
  unmatchedRemittanceOrders: number;
  remittanceAmountOnLatestCrf: number;
  orderSettlementValue: number;
  settlementAmountAvailable: boolean;
  distinctCrfs: number;
  distinctUtrs: number;
  remittanceDataAvailable: boolean;
  remittanceStatus: "NO_REMITTANCE_DATA" | "PARTIAL_REMITTANCE_DATA" | "RECONCILIATION_AVAILABLE";
  remittanceRowsTotal: number;
  remittanceMatched: number;
  remittanceUnmatched: number;
  remittanceAmbiguous: number;
  remittanceMatchRate: number | null;
  deliveredCodSettlementCoverage: number | null;
  deliveredCodOrders: number;
  deliveredRemittedOrders: number;
  deliveredNotRemittedOrders: number;
  remittedNotDeliveredOrders: number;
  deliveredOrdersWithRemittance: number;
  deliveredOrdersWithoutRemittance: number;
  paymentUnknownOrders: number;
  shopifyMatchPct: number;
  phoneCoveragePct: number;
  pabblySent: number;
  pabblyFailed: number;
  pabblyPending: number;
  pabblyRetrying: number;
  pabblyTotalDeliveries: number;
}

function asNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function computeOverviewFromRows(rows: OverviewRowInput[]): ShiprocketOverview {
  const totalOrders = rows.length;
  let delivered = 0;
  let inTransit = 0;
  let outForDelivery = 0;
  let rto = 0;
  let ndr = 0;
  let codOrders = 0;
  let prepaidOrders = 0;
  let commercialRows = 0;
  let shopifyCommercialRows = 0;
  let shiprocketCommercialRows = 0;
  let totalOrderValue = 0;
  let matchedRemittanceRows = 0;
  let unmatchedRemittanceOrders = 0;
  let remittanceAmountOnLatestCrf = 0;
  let orderSettlementValue = 0;
  let shopifyMatched = 0;
  let phoneCoverage = 0;
  let pabblySent = 0;
  let pabblyFailed = 0;
  let pabblyPending = 0;
  let pabblyRetrying = 0;
  const crfs = new Set<string>();
  const utrs = new Set<string>();
  let deliveredCodOrders = 0;
  let deliveredRemittedOrders = 0;
  let remittedNotDeliveredOrders = 0;
  let deliveredOrdersWithRemittance = 0;
  let deliveredOrdersWithoutRemittance = 0;
  let paymentUnknownOrders = 0;

  for (const row of rows) {
  const state = resolveCanonicalDeliveryState({
    statusBucket: row.status_bucket,
      shipmentStatus: row.shipment_status, currentStatus: row.current_status,
      shipmentStatusId: row.shipment_status_id, currentStatusId: row.current_status_id,
      deliveredDate: row.delivered_date, awb: row.awb,
      scans: [
        { status: row.scans0_status, sr_status_label: row.scans0_sr_status_label, sr_status: row.scans0_sr_status, scan_date: row.scans0_date, activity: row.scans0_activity },
        { status: row.scans1_status, sr_status_label: row.scans1_sr_status_label, sr_status: row.scans1_sr_status, scan_date: row.scans1_date, activity: row.scans1_activity },
      ],
    });
    const bucket: ShiprocketStatusBucket = state.outcome === "DELIVERED" ? "delivered" : state.outcome === "RTO" ? "rto" : state.outcome === "NDR_OPEN" ? "ndr" : state.outcome === "IN_TRANSIT" ? "in_transit" : (row.status_bucket as ShiprocketStatusBucket | undefined) || "other";
    if (bucket === "delivered") delivered += 1;
    else if (bucket === "in_transit") inTransit += 1;
    else if (bucket === "out_for_delivery") outForDelivery += 1;
    else if (bucket === "rto") rto += 1;
    else if (bucket === "ndr") ndr += 1;

    const shiprocketPay =
      row.payment_bucket === "COD" || row.payment_bucket === "Prepaid"
        ? row.payment_bucket
        : classifyPaymentBucket(row.payment_method);
    const pay = row.shopify_payment_category
      ? (row.shopify_payment_category === "COD" ? "COD" : row.shopify_payment_category === "PREPAID" ? "Prepaid" : "")
      : shiprocketPay;
    if (pay === "COD") codOrders += 1;
    if (pay === "Prepaid") prepaidOrders += 1;
    if (!pay) paymentUnknownOrders += 1;

    const hasShiprocketValue = row.order_total_num != null && row.order_total_num !== "" && Number.isFinite(Number(row.order_total_num));
    const hasShopifyValue = !hasShiprocketValue && row.shopify_current_total_price != null && row.shopify_current_total_price !== "" && Number.isFinite(Number(row.shopify_current_total_price));
    if (hasShiprocketValue || hasShopifyValue) {
      commercialRows += 1;
      if (hasShiprocketValue) shiprocketCommercialRows += 1;
      if (hasShopifyValue) shopifyCommercialRows += 1;
      totalOrderValue += asNumber(hasShiprocketValue ? row.order_total_num : row.shopify_current_total_price);
    }
    if (row.remittance_match_status === "matched") {
      matchedRemittanceRows += 1;
      remittanceAmountOnLatestCrf += asNumber(row.latest_remittance_amount);
      orderSettlementValue += asNumber(row.latest_order_settlement_value);
    } else if (row.remittance_match_status || Number(row.remittance_count || 0) > 0) {
      unmatchedRemittanceOrders += 1;
    }
    const isDelivered = bucket === "delivered";
    const isRemitted = row.remittance_match_status === "matched";
    if (isDelivered && isRemitted) deliveredOrdersWithRemittance += 1;
    if (isDelivered && !isRemitted) deliveredOrdersWithoutRemittance += 1;
    if (isDelivered && pay === "COD") {
      deliveredCodOrders += 1;
      if (isRemitted) deliveredRemittedOrders += 1;
    }
    if (row.remittance_match_status === "matched" && !isDelivered) remittedNotDeliveredOrders += 1;
    if (row.latest_crf_id) crfs.add(row.latest_crf_id);
    if (row.latest_utr) utrs.add(row.latest_utr);
    if (row.shopify_order_identifier) shopifyMatched += 1;
    if (row.customer_phone_shopify) phoneCoverage += 1;

    // Pabbly status counting (from order explorer's latest delivery record)
    const pabbly = String(row.pabbly_status ?? "").toLowerCase();
    if (pabbly === "sent") pabblySent += 1;
    else if (pabbly === "failed") pabblyFailed += 1;
    else if (pabbly === "pending" || pabbly === "processing") pabblyPending += 1;
    else if (pabbly === "retrying") pabblyRetrying += 1;
  }

  const pabblyTotalDeliveries = pabblySent + pabblyFailed + pabblyPending + pabblyRetrying;

  return {
    totalOrders,
    delivered,
    inTransit,
    outForDelivery,
    rto,
    ndr,
    deliveryRate: totalOrders > 0 ? Math.round((delivered / totalOrders) * 1000) / 10 : 0,
    settledOrders: deliveredRemittedOrders,
    unmatchedRemittanceOrders,
    remittanceAmountOnLatestCrf,
    orderSettlementValue,
    settlementAmountAvailable: rows.some((row) => row.remittance_match_status === "matched" && ((row.latest_remittance_amount != null && row.latest_remittance_amount !== "") || (row.latest_order_settlement_value != null && row.latest_order_settlement_value !== ""))),
    distinctCrfs: crfs.size,
    distinctUtrs: utrs.size,
    remittanceDataAvailable: crfs.size > 0 || utrs.size > 0 || matchedRemittanceRows > 0,
    remittanceStatus: crfs.size > 0 || utrs.size > 0 || matchedRemittanceRows > 0
      ? (matchedRemittanceRows > 0 && unmatchedRemittanceOrders > 0 ? "PARTIAL_REMITTANCE_DATA" : "RECONCILIATION_AVAILABLE")
      : "NO_REMITTANCE_DATA",
    remittanceRowsTotal: matchedRemittanceRows + unmatchedRemittanceOrders,
    remittanceUnmatched: unmatchedRemittanceOrders,
    remittanceAmbiguous: 0,
    remittanceMatchRate: matchedRemittanceRows + unmatchedRemittanceOrders > 0 ? Math.round((matchedRemittanceRows / (matchedRemittanceRows + unmatchedRemittanceOrders)) * 1000) / 10 : null,
    deliveredCodSettlementCoverage: deliveredCodOrders > 0 ? Math.round((deliveredRemittedOrders / deliveredCodOrders) * 1000) / 10 : null,
    deliveredCodOrders,
    deliveredRemittedOrders,
    deliveredNotRemittedOrders: Math.max(0, deliveredCodOrders - deliveredRemittedOrders),
    remittedNotDeliveredOrders,
    deliveredOrdersWithRemittance,
    deliveredOrdersWithoutRemittance,
    paymentUnknownOrders,
    remittanceMatched: matchedRemittanceRows,
    commercialDataAvailable: commercialRows > 0,
    commercialSource: commercialRows === 0 ? "NOT_AVAILABLE" : shopifyCommercialRows > 0 ? "SHOPIFY_ENRICHED" : shiprocketCommercialRows > 0 ? "SHIPROCKET" : "NOT_AVAILABLE",
    codOrders: commercialRows > 0 ? codOrders : null,
    prepaidOrders: commercialRows > 0 ? prepaidOrders : null,
    totalOrderValue: commercialRows > 0 ? totalOrderValue : null,
    shopifyMatchPct: totalOrders > 0 ? Math.round((shopifyMatched / totalOrders) * 1000) / 10 : 0,
    phoneCoveragePct: totalOrders > 0 ? Math.round((phoneCoverage / totalOrders) * 1000) / 10 : 0,
    pabblySent,
    pabblyFailed,
    pabblyPending,
    pabblyRetrying,
    pabblyTotalDeliveries,
  };
}
