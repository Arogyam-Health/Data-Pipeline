export type ShiprocketStatusBucket =
  | "delivered"
  | "in_transit"
  | "out_for_delivery"
  | "rto"
  | "ndr"
  | "other";

export function classifyShiprocketStatus(
  shipmentStatus?: string | null,
  currentStatus?: string | null
): ShiprocketStatusBucket {
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
  payment_method?: string | null;
  payment_bucket?: string | null;
  order_total_num?: number | string | null;
  remittance_count?: number | null;
  remittance_match_status?: string | null;
  latest_crf_id?: string | null;
  latest_utr?: string | null;
  latest_remittance_amount?: number | string | null;
  latest_order_settlement_value?: number | string | null;
  shopify_order_identifier?: string | null;
  customer_phone_shopify?: string | null;
}

export interface ShiprocketOverview {
  totalOrders: number;
  delivered: number;
  inTransit: number;
  outForDelivery: number;
  rto: number;
  ndr: number;
  deliveryRate: number;
  codOrders: number;
  prepaidOrders: number;
  totalOrderValue: number;
  settledOrders: number;
  unmatchedRemittanceOrders: number;
  remittanceAmountOnLatestCrf: number;
  orderSettlementValue: number;
  distinctCrfs: number;
  distinctUtrs: number;
  shopifyMatchPct: number;
  phoneCoveragePct: number;
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
  let totalOrderValue = 0;
  let settledOrders = 0;
  let unmatchedRemittanceOrders = 0;
  let remittanceAmountOnLatestCrf = 0;
  let orderSettlementValue = 0;
  let shopifyMatched = 0;
  let phoneCoverage = 0;
  const crfs = new Set<string>();
  const utrs = new Set<string>();

  for (const row of rows) {
    const bucket =
      (row.status_bucket as ShiprocketStatusBucket | undefined) ||
      classifyShiprocketStatus(row.shipment_status, row.current_status);
    if (bucket === "delivered") delivered += 1;
    else if (bucket === "in_transit") inTransit += 1;
    else if (bucket === "out_for_delivery") outForDelivery += 1;
    else if (bucket === "rto") rto += 1;
    else if (bucket === "ndr") ndr += 1;

    const pay =
      row.payment_bucket === "COD" || row.payment_bucket === "Prepaid"
        ? row.payment_bucket
        : classifyPaymentBucket(row.payment_method);
    if (pay === "COD") codOrders += 1;
    if (pay === "Prepaid") prepaidOrders += 1;

    totalOrderValue += asNumber(row.order_total_num);
    if (row.remittance_match_status === "matched") {
      settledOrders += 1;
      remittanceAmountOnLatestCrf += asNumber(row.latest_remittance_amount);
      orderSettlementValue += asNumber(row.latest_order_settlement_value);
    } else if (row.remittance_match_status !== "ambiguous") {
      unmatchedRemittanceOrders += 1;
    }
    if (row.latest_crf_id) crfs.add(row.latest_crf_id);
    if (row.latest_utr) utrs.add(row.latest_utr);
    if (row.shopify_order_identifier) shopifyMatched += 1;
    if (row.customer_phone_shopify) phoneCoverage += 1;
  }

  return {
    totalOrders,
    delivered,
    inTransit,
    outForDelivery,
    rto,
    ndr,
    deliveryRate: totalOrders > 0 ? Math.round((delivered / totalOrders) * 1000) / 10 : 0,
    codOrders,
    prepaidOrders,
    totalOrderValue,
    settledOrders,
    unmatchedRemittanceOrders,
    remittanceAmountOnLatestCrf,
    orderSettlementValue,
    distinctCrfs: crfs.size,
    distinctUtrs: utrs.size,
    shopifyMatchPct: totalOrders > 0 ? Math.round((shopifyMatched / totalOrders) * 1000) / 10 : 0,
    phoneCoveragePct: totalOrders > 0 ? Math.round((phoneCoverage / totalOrders) * 1000) / 10 : 0,
  };
}
