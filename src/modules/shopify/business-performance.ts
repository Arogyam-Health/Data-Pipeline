import { getSupabaseClient } from "@/lib/supabase/admin";

export type BusinessPerformanceLevel = "source" | "medium" | "campaign" | "content" | "term";

export type BusinessOrder = {
  shopify_order_id: string;
  created_at_shopify: string | null;
  ordered_revenue: number | null;
  current_revenue: number | null;
  financial_status: string | null;
  cancelled_at?: string | null;
  payment_type: string | null;
  is_shipped: boolean | null;
  is_delivered: boolean | null;
  is_rto: boolean | null;
  is_ndr: boolean | null;
  had_ndr: boolean | null;
  is_cancelled: boolean | null;
  remittance_status: string | null;
  remitted_amount: number | null;
  utm_source_raw: string | null;
  utm_medium_raw: string | null;
  utm_campaign_raw: string | null;
  utm_content_raw: string | null;
  utm_term_raw: string | null;
  has_remittance_match: boolean | null;
};

export type BusinessMetrics = {
  grossRevenue: number;
  currentRevenue: number;
  deliveredRevenue: number;
  revenueLoss: number;
  revenueSurvivalPct: number | null;
  orders: number;
  paid: number;
  aov: number | null;
  deliveredOrders: number;
  deliveredAov: number | null;
  shipped: number;
  delivered: number;
  rto: number;
  ndr: number;
  cancelled: number;
  shipRate: number | null;
  deliveryRate: number | null;
  rtoRate: number | null;
  ndrRate: number | null;
  cancelRate: number | null;
  gross: number;
  current: number;
  shippedRevenue: number;
  remitted: number;
  remittedIsCodSettlement: true;
}

export type BusinessPerformanceResponse = {
  range: { from: string; to: string };
  grain: "ONE_ROW_PER_SHOPIFY_ORDER";
  baseRows: number;
  distinctOrders: number;
  postJourneyRows: number;
  postJourneyDistinctOrders: number;
  postRemittanceRows: number;
  postRemittanceDistinctOrders: number;
  unknownPaymentOrders: number;
  metrics: BusinessMetrics;
  payment: Record<"COD" | "PREPAID", BusinessMetrics>;
  marketing: Array<{ key: string; label: string; metrics: BusinessMetrics }>;
  level: BusinessPerformanceLevel;
  parents: Record<string, string>;
};

const JOURNEY_FIELDS = [
  "shopify_order_id", "created_at_shopify", "ordered_revenue", "current_revenue",
  "financial_status", "payment_type", "is_shipped", "is_delivered", "is_rto", "is_ndr",
  "had_ndr", "is_cancelled", "remittance_status", "remitted_amount", "has_remittance_match",
].join(",");
const UTM_FIELDS = "shopify_order_id,utm_source_raw,utm_medium_raw,utm_campaign_raw,utm_content_raw,utm_term_raw";
const PAGE_SIZE = 1000;

function finite(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator * 100 : null;
}

function text(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function paymentBucket(row: BusinessOrder): "COD" | "PREPAID" | "UNKNOWN" {
  if (row.payment_type === "COD") return "COD";
  if (row.payment_type === "PREPAID") return "PREPAID";
  return "UNKNOWN";
}

export function calculateBusinessMetrics(rows: BusinessOrder[]): BusinessMetrics {
  const orders = rows.length;
  const grossRevenue = rows.reduce((sum, row) => sum + finite(row.ordered_revenue), 0);
  const currentRevenue = rows.reduce((sum, row) => sum + finite(row.current_revenue), 0);
  const deliveredRows = rows.filter((row) => row.is_delivered === true);
  const deliveredRevenue = deliveredRows.reduce((sum, row) => sum + finite(row.current_revenue), 0);
  const shipped = rows.filter((row) => row.is_shipped === true).length;
  const rto = rows.filter((row) => row.is_rto === true).length;
  const ndr = rows.filter((row) => row.is_ndr === true).length;
  const cancelled = rows.filter((row) => row.cancelled_at != null).length;
  const paid = rows.filter((row) => String(row.financial_status ?? "").toLowerCase() === "paid").length;
  return {
    grossRevenue,
    currentRevenue,
    deliveredRevenue,
    revenueLoss: grossRevenue - deliveredRevenue,
    revenueSurvivalPct: ratio(deliveredRevenue, grossRevenue),
    orders,
    paid,
    aov: orders > 0 ? grossRevenue / orders : null,
    deliveredOrders: deliveredRows.length,
    deliveredAov: deliveredRows.length > 0 ? deliveredRevenue / deliveredRows.length : null,
    shipped,
    delivered: deliveredRows.length,
    rto,
    ndr,
    cancelled,
    shipRate: ratio(shipped, orders),
    deliveryRate: ratio(deliveredRows.length, orders),
    rtoRate: ratio(rto, shipped),
    ndrRate: ratio(ndr, shipped),
    cancelRate: ratio(cancelled, orders),
    gross: grossRevenue,
    current: currentRevenue,
    shippedRevenue: rows.filter((row) => row.is_shipped === true).reduce((sum, row) => sum + finite(row.current_revenue), 0),
    remitted: rows.filter((row) => row.payment_type === "COD" && row.remittance_status === "REMITTED")
      .reduce((sum, row) => sum + finite(row.remitted_amount), 0),
    remittedIsCodSettlement: true,
  };
}

async function fetchPages<T>(table: string, fields: string, dateField: string, from: string, to: string): Promise<T[]> {
  const client = getSupabaseClient();
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.from(table).select(fields)
      .gte(dateField, dateField === "order_date" ? from.slice(0, 10) : from)
      .lte(dateField, dateField === "order_date" ? to.slice(0, 10) : to)
      .order("shopify_order_id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Shopify business performance query failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function keyFor(row: BusinessOrder, level: BusinessPerformanceLevel): string {
  const values = {
    source: row.utm_source_raw,
    medium: row.utm_medium_raw,
    campaign: row.utm_campaign_raw,
    content: row.utm_content_raw,
    term: row.utm_term_raw,
  };
  return text(values[level]) ?? "(not set)";
}

function matchesParents(row: BusinessOrder, parents: Record<string, string>): boolean {
  return Object.entries(parents).every(([level, value]) => keyFor(row, level as BusinessPerformanceLevel) === value);
}

export async function loadShopifyBusinessPerformance(input: {
  from: string;
  to: string;
  level?: BusinessPerformanceLevel;
  parents?: Record<string, string>;
}): Promise<BusinessPerformanceResponse> {
  const [journeyRows, utmRows] = await Promise.all([
    fetchPages<BusinessOrder>("mart_order_journey_remittance", JOURNEY_FIELDS, "order_date", input.from, input.to),
    fetchPages<Pick<BusinessOrder, "shopify_order_id" | "utm_source_raw" | "utm_medium_raw" | "utm_campaign_raw" | "utm_content_raw" | "utm_term_raw">>("shopify_order_delivery_remittance", UTM_FIELDS, "created_at_shopify", input.from, input.to),
  ]);
  const utmByOrder = new Map(utmRows.map((row) => [String(row.shopify_order_id), row]));
  const client = getSupabaseClient();
  const cancellationByOrder = new Map<string, string | null>();
  const journeyIds = journeyRows.map((row) => row.shopify_order_id);
  for (let offset = 0; offset < journeyIds.length; offset += 500) {
    const { data, error } = await client.from("shopify_orders").select("shopify_order_id,cancelled_at").in("shopify_order_id", journeyIds.slice(offset, offset + 500));
    if (error) throw new Error(`Shopify cancellation evidence query failed: ${error.message}`);
    for (const row of data ?? []) cancellationByOrder.set(String(row.shopify_order_id), row.cancelled_at ?? null);
  }
  const rows = journeyRows.map((row) => ({ ...row, cancelled_at: cancellationByOrder.get(row.shopify_order_id) ?? null, ...(utmByOrder.get(row.shopify_order_id) ?? {}) }));
  const distinctIds = new Set(rows.map((row) => row.shopify_order_id));
  if (rows.length !== distinctIds.size) throw new Error("Shopify business performance grain violation");
  const metrics = calculateBusinessMetrics(rows);
  const payment = {
    COD: calculateBusinessMetrics(rows.filter((row) => paymentBucket(row) === "COD")),
    PREPAID: calculateBusinessMetrics(rows.filter((row) => paymentBucket(row) === "PREPAID")),
  };
  const level = input.level ?? "source";
  const parents = input.parents ?? {};
  const marketingRows = rows.filter((row) => matchesParents(row, parents));
  const groups = new Map<string, BusinessOrder[]>();
  for (const row of marketingRows) {
    const key = keyFor(row, level);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const marketing = [...groups.entries()].map(([key, group]) => ({ key, label: key, metrics: calculateBusinessMetrics(group) }))
    .sort((a, b) => b.metrics.grossRevenue - a.metrics.grossRevenue);
  return {
    range: { from: input.from, to: input.to }, grain: "ONE_ROW_PER_SHOPIFY_ORDER",
    baseRows: rows.length, distinctOrders: distinctIds.size, postJourneyRows: rows.length,
    postJourneyDistinctOrders: distinctIds.size, postRemittanceRows: rows.length,
    postRemittanceDistinctOrders: distinctIds.size,
    unknownPaymentOrders: rows.filter((row) => paymentBucket(row) === "UNKNOWN").length,
    metrics, payment, marketing, level, parents,
  };
}
