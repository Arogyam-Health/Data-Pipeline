import { getSupabaseClient } from "@/lib/supabase/admin";
import {
  compileFilters,
  GLOBAL_SEARCH_COLUMNS,
  type CompiledClause,
  type FilterOperator,
  type ShiprocketFilterRequest,
} from "./filters";
import { buildLegacyPabblyPayload, LEGACY_PABBLY_HEADERS } from "./legacy";
import { SHIPROCKET_EXPLORER_COLUMNS } from "./explorer-contract";
import { classifyShiprocketStatus, computeOverviewFromRows, type OverviewRowInput, type ShiprocketOverview } from "./status";
import type { ShiprocketExplorerRow } from "./types";

const LIST_COLUMNS = SHIPROCKET_EXPLORER_COLUMNS.join(",");

function canonicalDelivered(row: Record<string, unknown>): boolean {
  return (row.status_bucket ? row.status_bucket : classifyShiprocketStatus(String(row.shipment_status || ""), String(row.current_status || ""))) === "delivered";
}

export function reconciliationStatus(row: Record<string, unknown>): string {
  const remitted = row.remittance_match_status === "matched";
  const payment = String(row.payment_bucket || "").toUpperCase();
  if (payment === "PREPAID") return "NOT_APPLICABLE_PREPAID";
  if (!payment && !String(row.payment_method || "").trim()) return remitted ? "UNKNOWN_PAYMENT" : "PENDING";
  const cod = payment === "COD" || /cod/i.test(String(row.payment_method || ""));
  if (!cod) return remitted ? "UNKNOWN_PAYMENT" : "NOT_APPLICABLE_PREPAID";
  if (canonicalDelivered(row)) return remitted ? "DELIVERED_REMITTED" : "DELIVERED_NOT_REMITTED";
  return remitted ? "REMITTED_NOT_DELIVERED" : "PENDING";
}

const OVERVIEW_COLUMNS = [
  "sr_order_id",
  "status_bucket",
  "shipment_status",
  "current_status",
  "payment_method",
  "payment_bucket",
  "order_total_num",
  "remittance_match_status",
  "latest_crf_id",
  "latest_utr",
  "latest_remittance_amount",
  "latest_order_settlement_value",
  "shopify_order_identifier",
  "customer_phone_shopify",
  "pabbly_status",
  "pabbly_attempt_count",
  "pabbly_sent_at",
  "pabbly_delivery_count",
  "pabbly_sent_count",
  "pabbly_failed_count",
].join(",");

function requestDateRange(request: ShiprocketFilterRequest): [string | null, string | null] {
  for (const filter of request.filters || []) {
    if (!("field" in filter)) continue;
    if (filter.field !== "last_webhook_sync_at" && filter.field !== "awb_assigned_date" && filter.field !== "order_date") continue;
    if (filter.operator === "between" && Array.isArray(filter.value)) return [String(filter.value[0] || "").slice(0, 10) || null, String(filter.value[1] || "").slice(0, 10) || null];
    if (["on", "after", "before", "gte", "lte"].includes(filter.operator)) {
      const day = String(filter.value || "").slice(0, 10);
      return filter.operator === "after" || filter.operator === "gte" ? [day, null] : [null, day];
    }
  }
  return [null, null];
}

async function scopedRemittanceStats(request: ShiprocketFilterRequest, srOrderIds: string[]) {
  const supabase = getSupabaseClient();
  const rows = await loadScopedRemittanceRows(request, srOrderIds);
  const matched = rows.filter((row) => row.match_status === "matched").length;
  const unmatched = rows.filter((row) => row.match_status !== "matched").length;
  const crfs = new Set(rows.map((row) => row.crf_id).filter(Boolean));
  const utrs = new Set(rows.map((row) => row.utr).filter(Boolean));
  let settlementValue = rows.filter((row) => row.match_status === "matched").reduce((sum, row) => sum + Number(row.total_adjusted_amt || 0), 0);
  let settlementAmountAvailable = rows.some((row) => row.match_status === "matched" && row.total_adjusted_amt != null && row.total_adjusted_amt !== "");
  if (settlementValue === 0) {
    const crfIds = [...new Set(rows.map((row) => row.crf_id).filter(Boolean))];
    if (crfIds.length) {
      const { data: parents } = await supabase.from("shiprocket_remittances").select("crf_id,remittance_amount").in("crf_id", crfIds);
      settlementValue = (parents || []).reduce((sum, row) => sum + Number(row.remittance_amount || 0), 0);
      settlementAmountAvailable = settlementAmountAvailable || (parents || []).some((row) => row.remittance_amount != null && row.remittance_amount !== "");
    }
  }
  return {
    available: rows.length > 0,
    status: rows.length === 0 ? "NO_REMITTANCE_DATA" : matched > 0 && unmatched > 0 ? "PARTIAL_REMITTANCE_DATA" : "RECONCILIATION_AVAILABLE",
    rowsTotal: rows.length, matched, unmatched,
    matchRate: rows.length ? Math.round((matched / rows.length) * 1000) / 10 : null,
    crfCount: crfs.size, utrCount: utrs.size,
    settlementValue,
    settlementAmountAvailable,
    matchedSrIds: new Set(rows.filter((row) => row.match_status === "matched" && row.matched_sr_order_id).map((row) => String(row.matched_sr_order_id).trim())),
  };
}

async function loadScopedRemittanceRows(request: ShiprocketFilterRequest, srOrderIds: string[]) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("shiprocket_remittance_orders")
    .select("id,crf_id,utr,awb,order_id,remittance_date,total_adjusted_amt,match_status,matched_sr_order_id")
    .limit(20000);
  if (error) throw new Error(`Remittance scope query failed: ${error.message}`);
  const canonicalId = (value: unknown) => String(value ?? "").trim();
  const selected = new Set(srOrderIds.map(canonicalId).filter(Boolean));
  const [from, to] = requestDateRange(request);
  const inDate = (value: unknown) => {
    if (!from && !to) return true;
    if (!value) return false;
    const day = String(value).slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  };
  return (data || []).filter((row) => {
    // Matched rows follow the operational Shiprocket cohort. This preserves
    // remittance received after the order/delivery date and NULL source dates.
    if (row.matched_sr_order_id && selected.has(canonicalId(row.matched_sr_order_id))) return true;
    // Unmatched source rows have no order to join; date-scope them when a
    // dashboard date is selected so they remain visible as exceptions.
    return !row.matched_sr_order_id && inDate(row.remittance_date);
  });
}

async function filteredShiprocketIds(request: ShiprocketFilterRequest): Promise<string[]> {
  const supabase = getSupabaseClient();
  const ids: string[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    let query = supabase.from("shiprocket_order_explorer").select("sr_order_id").range(offset, offset + 999);
    // Keep the generated Supabase builder from expanding recursively here.
    query = applyAllClauses(query as any, request) as any;
    const { data, error } = await query;
    if (error) throw new Error(`Shiprocket cohort query failed: ${error.message}`);
    ids.push(...(data || []).map((row) => String(row.sr_order_id)).filter(Boolean));
    if (!data || data.length < 1000) break;
  }
  return ids;
}

type FilterBuilder = {
  eq: (col: string, val: unknown) => FilterBuilder;
  neq: (col: string, val: unknown) => FilterBuilder;
  ilike: (col: string, val: string) => FilterBuilder;
  not: (col: string, op: string, val: unknown) => FilterBuilder;
  in: (col: string, val: unknown[]) => FilterBuilder;
  or: (expr: string) => FilterBuilder;
  is: (col: string, val: null) => FilterBuilder;
  gt: (col: string, val: unknown) => FilterBuilder;
  gte: (col: string, val: unknown) => FilterBuilder;
  lt: (col: string, val: unknown) => FilterBuilder;
  lte: (col: string, val: unknown) => FilterBuilder;
  filter: (col: string, op: string, val: unknown) => FilterBuilder;
};

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function applyClause<T extends FilterBuilder>(query: T, clause: CompiledClause): T {
  const col = clause.column;
  const op = clause.operator;
  const value = clause.value;

  switch (op) {
    case "eq":
      return query.eq(col, value) as T;
    case "neq":
      return query.neq(col, value) as T;
    case "contains":
      return query.ilike(col, `%${escapeIlike(String(value ?? ""))}%`) as T;
    case "not_contains":
      return query.not(col, "ilike", `%${escapeIlike(String(value ?? ""))}%`) as T;
    case "starts_with":
      return query.ilike(col, `${escapeIlike(String(value ?? ""))}%`) as T;
    case "ends_with":
      return query.ilike(col, `%${escapeIlike(String(value ?? ""))}`) as T;
    case "in":
      return query.in(col, value as unknown[]) as T;
    case "not_in":
      return query.not(col, "in", `(${(value as unknown[]).map((v) => `"${String(v).replace(/"/g, "")}"`).join(",")})`) as T;
    case "empty":
      return query.or(`${col}.is.null,${col}.eq.`) as T;
    case "not_empty":
      return query.not("is", col, null).neq(col, "") as T;
    case "gt":
    case "after":
      return query.gt(col, value) as T;
    case "gte":
      return query.gte(col, value) as T;
    case "lt":
    case "before":
      return query.lt(col, value) as T;
    case "lte":
      return query.lte(col, value) as T;
    case "on": {
      const day = String(value).slice(0, 10);
      return query.gte(col, `${day}T00:00:00.000Z`).lte(col, `${day}T23:59:59.999Z`) as T;
    }
    case "between": {
      const [from, to] = value as [unknown, unknown];
      return query.gte(col, from).lte(col, to) as T;
    }
    case "last_n_days":
    case "last_7_days":
    case "last_30_days":
    case "last_60_days":
    case "last_90_days": {
      const n =
        op === "last_7_days" ? 7
        : op === "last_30_days" ? 30
        : op === "last_60_days" ? 60
        : op === "last_90_days" ? 90
        : Number(value);
      const from = new Date(Date.now() - n * 86400000).toISOString();
      return query.gte(col, from) as T;
    }
    case "today": {
      const day = new Date().toISOString().slice(0, 10);
      return query.gte(col, `${day}T00:00:00.000Z`).lte(col, `${day}T23:59:59.999Z`) as T;
    }
    case "yesterday": {
      const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      return query.gte(col, `${day}T00:00:00.000Z`).lte(col, `${day}T23:59:59.999Z`) as T;
    }
    case "true":
      return query.eq(col, true) as T;
    case "false":
      return query.eq(col, false) as T;
    default:
      return query;
  }
}

function applyAllClauses<T extends FilterBuilder>(
  query: T,
  request: ShiprocketFilterRequest
): T {
  const compiled = compileFilters(request.filters);
  let next = query;
  for (const clause of compiled.and) {
    next = applyClause(next, clause);
  }
  for (const group of compiled.orGroups) {
    const parts = group.map((clause) => compileOrFragment(clause)).filter(Boolean);
    if (parts.length > 0) next = next.or(parts.join(",")) as T;
  }
  if (request.search && request.search.trim()) {
    const term = escapeIlike(request.search.trim());
    const searchOr = GLOBAL_SEARCH_COLUMNS.map((col) => `${col}.ilike.%${term}%`).join(",");
    next = next.or(searchOr) as T;
  }
  return next;
}

function compileOrFragment(clause: CompiledClause): string {
  const col = clause.column;
  const value = clause.value;
  switch (clause.operator as FilterOperator) {
    case "eq":
      return `${col}.eq.${value}`;
    case "neq":
      return `${col}.neq.${value}`;
    case "contains":
      return `${col}.ilike.%${escapeIlike(String(value ?? ""))}%`;
    case "in":
      return `${col}.in.(${(value as unknown[]).join(",")})`;
    case "empty":
      return `${col}.is.null`;
    case "not_empty":
      return `${col}.not.is.null`;
    default:
      return "";
  }
}

export async function queryShiprocketOrders(request: ShiprocketFilterRequest): Promise<{
  rows: ShiprocketExplorerRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const supabase = getSupabaseClient();
  const from = (request.page - 1) * request.pageSize;
  const to = from + request.pageSize - 1;
  const sort = request.sort[0] ?? { field: "last_webhook_sync_at", direction: "desc" as const };

  let query = supabase
    .from("shiprocket_order_explorer")
    .select(LIST_COLUMNS, { count: "exact" });

  query = applyAllClauses(query, request);
  query = query.order(sort.field, { ascending: sort.direction === "asc", nullsFirst: false });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Shiprocket query failed: ${error.message}`);
  }

  return {
    rows: (data as unknown as Array<Record<string, unknown>> || []).map((row) => ({ ...row, reconciliation_status: reconciliationStatus(row) })) as unknown as ShiprocketExplorerRow[],
    total: count ?? 0,
    page: request.page,
    pageSize: request.pageSize,
  };
}

export async function getShiprocketOrderDetail(srOrderId: string): Promise<{
  order: ShiprocketExplorerRow;
  rawPayload: unknown;
  scans: unknown[];
  remittances: unknown[];
} | null> {
  const supabase = getSupabaseClient();
  const [{ data: order }, { data: raw }, { data: scans }, { data: remittances }] = await Promise.all([
    supabase.from("shiprocket_order_explorer").select(LIST_COLUMNS).eq("sr_order_id", srOrderId).maybeSingle(),
    supabase.from("shiprocket_orders").select("raw_payload").eq("sr_order_id", srOrderId).maybeSingle(),
    supabase
      .from("shiprocket_scans")
      .select("scan_index, scan_date, status, sr_status, sr_status_label, activity, location, latitude, longitude, awb")
      .eq("sr_order_id", srOrderId)
      .order("scan_index", { ascending: true }),
    supabase
      .from("shiprocket_remittance_orders")
      .select("crf_id, awb, order_id, remittance_type, remittance_date, utr, order_value, total_adjusted_amt, channel_name, linked_crf_ids, match_status")
      .eq("matched_sr_order_id", srOrderId),
  ]);

  if (!order) return null;
  const crfIds = [...new Set((remittances || []).map((row) => row.crf_id).filter(Boolean))];
  const { data: crfs } = crfIds.length
    ? await supabase.from("shiprocket_remittances").select("*").in("crf_id", crfIds)
    : { data: [] };
  const crfMap = new Map((crfs || []).map((row) => [row.crf_id, row]));

  return {
    order: order as unknown as ShiprocketExplorerRow,
    rawPayload: raw?.raw_payload ?? null,
    scans: scans || [],
    remittances: (remittances || []).map((row) => ({
      ...row,
      crf: crfMap.get(row.crf_id) ?? null,
    })),
  };
}

export async function queryShiprocketOverview(
  request: ShiprocketFilterRequest
): Promise<ShiprocketOverview & { truncated: boolean }> {
  const supabase = getSupabaseClient();
  const batchSize = 1000;
  let offset = 0;
  const allRows: OverviewRowInput[] = [];
  while (true) {
    let query = supabase.from("shiprocket_order_explorer").select(OVERVIEW_COLUMNS).range(offset, offset + batchSize - 1);
    query = applyAllClauses(query, request);
    const { data, error } = await query;
    if (error) throw new Error(`Shiprocket overview failed: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...(data as OverviewRowInput[]));
    if (data.length < batchSize) break;
    offset += batchSize;
    if (allRows.length >= 20000) break;
  }
  const shopifyIds = [...new Set(allRows.map((row) => row.shopify_order_identifier).filter(Boolean).map(String))];
  const shopify = new Map<string, { current_total_price: number | null; payment_category: string | null }>();
  for (let offset = 0; offset < shopifyIds.length; offset += 500) {
    const ids = shopifyIds.slice(offset, offset + 500);
    const { data, error } = await supabase.from("shopify_orders").select("shopify_order_id,current_total_price,payment_gateway_names").in("shopify_order_id", ids);
    if (error) throw new Error(`Shopify commercial enrichment failed: ${error.message}`);
    for (const row of data || []) {
      const gateways = (row.payment_gateway_names || []).map((value: string) => value.toLowerCase()).join(" ");
      const payment_category = /cash_on_delivery|cash on delivery|(^|[^a-z])cod([^a-z]|$)|(^|[^a-z])cash([^a-z]|$)/.test(gateways)
        ? "COD" : gateways ? "PREPAID" : "UNKNOWN";
      shopify.set(String(row.shopify_order_id), { current_total_price: row.current_total_price, payment_category });
    }
  }
  const enrichedRows = allRows.map((row) => ({ ...row, ...(shopify.get(String(row.shopify_order_identifier || "")) ? { shopify_current_total_price: shopify.get(String(row.shopify_order_identifier))?.current_total_price, shopify_payment_category: shopify.get(String(row.shopify_order_identifier))?.payment_category } : {}) }));
  const overview = computeOverviewFromRows(enrichedRows as OverviewRowInput[]);
  const remittance = await scopedRemittanceStats(request, allRows.map((row) => String(row.sr_order_id)).filter(Boolean));
  const isDelivered = (row: OverviewRowInput) => canonicalDelivered(row as Record<string, unknown>);
  const isCod = (row: OverviewRowInput) => row.shopify_payment_category ? row.shopify_payment_category === "COD" : row.payment_bucket === "COD" || /cod/i.test(String(row.payment_method || ""));
  const deliveredRows = enrichedRows.filter((row) => isDelivered(row));
  const deliveredCodRows = deliveredRows.filter((row) => isCod(row));
  // Remittance evidence is independent of payment classification. Unknown
  // payment must not erase a valid delivered/remitted match.
  const deliveredRemitted = deliveredRows.filter((row) => remittance.matchedSrIds.has(String(row.sr_order_id).trim())).length;
  const deliveredCodRemitted = deliveredCodRows.filter((row) => remittance.matchedSrIds.has(String(row.sr_order_id).trim())).length;
  const remittedNotDelivered = [...remittance.matchedSrIds].filter((id) => !enrichedRows.some((row) => String(row.sr_order_id).trim() === id && isDelivered(row))).length;
  return {
    ...overview,
    remittanceDataAvailable: remittance.available,
    remittanceStatus: remittance.status as typeof overview.remittanceStatus,
    remittanceRowsTotal: remittance.rowsTotal,
    remittanceUnmatched: remittance.unmatched,
    remittanceMatchRate: remittance.matchRate,
    settledOrders: deliveredRemitted,
    unmatchedRemittanceOrders: remittance.unmatched,
    distinctCrfs: remittance.crfCount,
    distinctUtrs: remittance.utrCount,
    orderSettlementValue: remittance.settlementValue,
    settlementAmountAvailable: remittance.settlementAmountAvailable,
    remittanceMatched: remittance.matched,
    deliveredCodOrders: deliveredCodRows.length,
    deliveredRemittedOrders: deliveredCodRemitted,
    deliveredNotRemittedOrders: Math.max(0, deliveredCodRows.length - deliveredCodRemitted),
    remittedNotDeliveredOrders: remittedNotDelivered,
    deliveredOrdersWithRemittance: deliveredRemitted,
    deliveredOrdersWithoutRemittance: Math.max(0, deliveredRows.length - deliveredRemitted),
    paymentUnknownOrders: deliveredRows.filter((row) => !row.shopify_payment_category && !String(row.payment_bucket || "").trim() && !String(row.payment_method || "").trim()).length,
    truncated: allRows.length >= 20000,
  };
}

export async function queryShiprocketRemittances(request: ShiprocketFilterRequest = { filters: [], search: "", page: 1, pageSize: 1, sort: [] }): Promise<{
  summary: Record<string, unknown> | null;
  crfs: Record<string, unknown>[];
  imports: Record<string, unknown>[];
}> {
  const supabase = getSupabaseClient();
  const [selectedIds, imports] = await Promise.all([
    filteredShiprocketIds(request),
    supabase
      .from("shiprocket_remittance_imports")
      .select("id, file_name, file_hash, source, awb_rows_read, awb_rows_upserted, crf_rows_read, crf_rows_upserted, matched_orders, unmatched_orders, ambiguous_orders, status, started_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const scopedRows = await loadScopedRemittanceRows(request, selectedIds);
  const crfIds = [...new Set(scopedRows.map((row) => row.crf_id).filter(Boolean))];
  const awbAmountByCrf = new Map<string, number>();
  for (const row of scopedRows) {
    if (!row.crf_id || row.total_adjusted_amt == null || row.total_adjusted_amt === "") continue;
    const amount = Number(row.total_adjusted_amt);
    if (Number.isFinite(amount)) awbAmountByCrf.set(String(row.crf_id), (awbAmountByCrf.get(String(row.crf_id)) || 0) + amount);
  }
  const [{ data: summaryRows, error: summaryError }] = await Promise.all([
    crfIds.length ? supabase.from("shiprocket_remittances").select("*").in("crf_id", crfIds).order("remittance_date", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (summaryError) throw new Error(`Remittance CRF query failed: ${summaryError.message}`);
  const crfRows = scopedRows;

  const deliveryBySr = new Map<string, boolean>();
  const matchedSrIds = [...new Set(scopedRows.filter((row) => row.matched_sr_order_id).map((row) => String(row.matched_sr_order_id)))];
  for (let offset = 0; offset < matchedSrIds.length; offset += 500) {
    const ids = matchedSrIds.slice(offset, offset + 500);
    const { data, error } = await supabase.from("shiprocket_order_explorer").select("sr_order_id,status_bucket,shipment_status,current_status").in("sr_order_id", ids);
    if (error) throw new Error(`Remittance delivery reconciliation failed: ${error.message}`);
    for (const row of data || []) deliveryBySr.set(String(row.sr_order_id), row.status_bucket === "delivered" || (/delivered/i.test(`${row.shipment_status || ""} ${row.current_status || ""}`) && !/rto/i.test(`${row.shipment_status || ""} ${row.current_status || ""}`)));
  }
  const crfStats = new Map<string, { awb_count: number; matched: number; unmatched: number; ambiguous: number; delivered: number; not_delivered: number }>();
  for (const row of crfRows || []) {
    const current = crfStats.get(row.crf_id) ?? { awb_count: 0, matched: 0, unmatched: 0, ambiguous: 0, delivered: 0, not_delivered: 0 };
    current.awb_count += 1;
    if (row.match_status === "matched") current.matched += 1;
    else if (row.match_status === "ambiguous") current.ambiguous += 1;
    else current.unmatched += 1;
    if (row.match_status === "matched") deliveryBySr.get(String(row.matched_sr_order_id)) ? current.delivered += 1 : current.not_delivered += 1;
    crfStats.set(row.crf_id, current);
  }

  return {
    summary: {
      crf_count: (summaryRows || []).length,
      distinct_utrs: new Set((scopedRows || []).map((row) => row.utr).filter(Boolean)).size,
      remittance_amount_total: (summaryRows || []).reduce(
        (sum, row) => sum + Number(row.remittance_amount != null && row.remittance_amount !== "" ? row.remittance_amount : awbAmountByCrf.get(String(row.crf_id)) ?? 0),
        0
      ),
      latest_remittance_date: summaryRows?.[0]?.remittance_date ?? null,
    },
    crfs: (summaryRows || []).map((row) => ({
      ...row,
      settlement_amount: row.remittance_amount != null && row.remittance_amount !== "" ? row.remittance_amount : (awbAmountByCrf.has(String(row.crf_id)) ? awbAmountByCrf.get(String(row.crf_id)) : null),
      ...(crfStats.get(row.crf_id) ?? { awb_count: 0, matched: 0, unmatched: 0, ambiguous: 0, delivered: 0, not_delivered: 0 }),
    })),
    imports: imports.data || [],
  };
}

export async function getShiprocketRemittanceDetail(crfId: string): Promise<{
  remittance: Record<string, unknown>;
  orders: Record<string, unknown>[];
} | null> {
  const supabase = getSupabaseClient();
  const [{ data: remittance }, { data: orders }] = await Promise.all([
    supabase.from("shiprocket_remittances").select("*").eq("crf_id", crfId).maybeSingle(),
    supabase.from("shiprocket_remittance_orders").select("*").eq("crf_id", crfId),
  ]);
  if (!remittance) return null;
  return { remittance, orders: orders || [] };
}

export async function exportShiprocketOrders(
  request: ShiprocketFilterRequest,
  options?: { legacyLabels?: boolean; includeRaw?: boolean }
): Promise<{ headers: string[]; rows: string[][]; truncated: boolean }> {
  const limited: ShiprocketFilterRequest = {
    ...request,
    page: 1,
    pageSize: 500,
  };
  const result = await queryShiprocketOrders(limited);
  const truncated = result.total > 500;

  if (options?.legacyLabels) {
    const headers = [...LEGACY_PABBLY_HEADERS];
    const rows = result.rows.map((row) => {
      const payload = buildLegacyPabblyPayload(row);
      return headers.map((header) => payload[header] ?? "");
    });
    return { headers: [...headers], rows, truncated };
  }

  const headers = LIST_COLUMNS.split(",");
  const rows = result.rows.map((row) =>
    headers.map((header) => {
      const value = (row as unknown as Record<string, unknown>)[header];
      if (value === null || value === undefined) return "";
      return String(value);
    })
  );
  return { headers, rows, truncated };
}

export async function loadShiprocketQuality(request: ShiprocketFilterRequest = { filters: [], search: "", page: 1, pageSize: 1, sort: [] }): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();
  const explorer = supabase.from("shiprocket_order_explorer");
  // Supabase's generated builder types become recursively deep when reused across
  // head-count and row queries; keep this local adapter intentionally untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = (query: any): any => applyAllClauses(query, request);

  const [
    total,
    missingOrderId,
    missingAwb,
    missingShopifyId,
    matched,
    missingName,
    missingPhone,
    missingApi,
    latestWebhook,
  ] = await Promise.all([
    scoped(explorer.select("sr_order_id", { count: "exact", head: true })),
    scoped(explorer.select("sr_order_id", { count: "exact", head: true }).or("order_id.is.null,order_id.eq.")),
    scoped(explorer.select("sr_order_id", { count: "exact", head: true }).or("awb.is.null,awb.eq.")),
    scoped(explorer.select("sr_order_id", { count: "exact", head: true }).or("order_id_shopify_format.is.null,order_id_shopify_format.eq.")),
    scoped(explorer.select("sr_order_id", { count: "exact", head: true }).not("shopify_order_identifier", "is", null)),
    scoped(explorer.select("sr_order_id", { count: "exact", head: true }).or("customer_name_shopify.is.null,customer_name_shopify.eq.")),
    scoped(explorer.select("sr_order_id", { count: "exact", head: true }).or("customer_phone_shopify.is.null,customer_phone_shopify.eq.")),
    scoped(explorer.select("sr_order_id", { count: "exact", head: true }).is("last_local_api_sync_at", null)),
    scoped(explorer.select("last_webhook_sync_at").order("last_webhook_sync_at", { ascending: false }).limit(1).maybeSingle()),
  ]);

  return {
    orders_total: total.count ?? 0,
    missing_order_id: missingOrderId.count ?? 0,
    missing_awb: missingAwb.count ?? 0,
    missing_shopify_8_digit: missingShopifyId.count ?? 0,
    shopify_matched: matched.count ?? 0,
    shopify_unmatched: Math.max(0, (total.count ?? 0) - (matched.count ?? 0)),
    missing_customer_name: missingName.count ?? 0,
    missing_customer_phone: missingPhone.count ?? 0,
    last_api_sync_missing: missingApi.count ?? 0,
    last_webhook_sync: latestWebhook.data?.last_webhook_sync_at ?? null,
    remittance: (await loadRemittanceQuality(request)),
  };
}

async function loadRemittanceQuality(request: ShiprocketFilterRequest): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();
  const [selectedIds, latest] = await Promise.all([
    filteredShiprocketIds(request),
    supabase.from("shiprocket_remittance_imports").select("completed_at, file_name, status").eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const list = await loadScopedRemittanceRows(request, selectedIds);
  const matchedCount = list.filter((row) => row.match_status === "matched").length;
  const unmatchedCount = list.filter((row) => row.match_status !== "matched").length;
  const ambiguousCount = list.filter((row) => row.match_status === "ambiguous").length;
  const crfCount = new Set(list.map((row) => row.crf_id).filter(Boolean)).size;
  const utrCount = new Set(list.map((row) => row.utr).filter(Boolean)).size;
  return {
    status: list.length === 0 ? "NO_REMITTANCE_DATA" : matchedCount > 0 && (unmatchedCount > 0 || ambiguousCount > 0) ? "PARTIAL_REMITTANCE_DATA" : "RECONCILIATION_AVAILABLE",
    data_available: list.length > 0,
    crfs: crfCount,
    utrs: utrCount,
    awb_rows: list.length,
    matched: matchedCount,
    unmatched: unmatchedCount,
    ambiguous: ambiguousCount,
    match_rate: list.length ? Math.round((matchedCount / list.length) * 1000) / 10 : null,
    last_import: latest.data ?? null,
  };
}

export async function loadPabblyPreview(srOrderId: string): Promise<Record<string, string> | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("shiprocket_order_explorer")
    .select("*")
    .eq("sr_order_id", srOrderId)
    .maybeSingle();
  if (!data) return null;
  return buildLegacyPabblyPayload(data, {
    sheetAction: "preview",
    eventId: "preview",
  });
}
