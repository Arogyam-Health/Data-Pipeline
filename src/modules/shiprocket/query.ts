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
import { computeOverviewFromRows, resolveCanonicalDeliveryState, type OverviewRowInput, type ShiprocketOverview } from "./status";
import type { ShiprocketExplorerRow } from "./types";
import { reconcileRemittanceRows, summarizeRemittanceReconciliation, type RemittanceSourceRow, type ReconciliationJourneyRow, type ReconciliationShipment, type ReconciliationShopifySource } from "@/modules/journey/reconciliation";

const LIST_COLUMNS = SHIPROCKET_EXPLORER_COLUMNS.join(",");

function canonicalDelivered(row: Record<string, unknown>): boolean {
  return resolveCanonicalDeliveryState({
    statusBucket: row.status_bucket,
    shipmentStatus: String(row.shipment_status || ""), currentStatus: String(row.current_status || ""),
    shipmentStatusId: row.shipment_status_id, currentStatusId: row.current_status_id,
    orderStatus: row.order_status,
    deliveredDate: String(row.delivered_date || "") || null,
    scans: [row].flatMap((item) => [
      { status: item.scans0_status, sr_status_label: item.scans0_sr_status_label, sr_status: item.scans0_sr_status, date: item.scans0_date, activity: item.scans0_activity },
      { status: item.scans1_status, sr_status_label: item.scans1_sr_status_label, sr_status: item.scans1_sr_status, date: item.scans1_date, activity: item.scans1_activity },
    ]),
  }).isDelivered;
}

function canonicalizeExplorerRow(row: Record<string, unknown>, history: Array<Record<string, unknown>> = []): Record<string, unknown> {
  const state = resolveCanonicalDeliveryState({
    statusBucket: row.status_bucket,
    shipmentStatus: String(row.shipment_status || ""), currentStatus: String(row.current_status || ""),
    shipmentStatusId: row.shipment_status_id, currentStatusId: row.current_status_id,
    orderStatus: row.order_status,
    deliveredDate: String(row.delivered_date || "") || null,
    awb: String(row.awb || "") || null,
    scans: [...history, ...[
      { status: row.scans0_status, sr_status_label: row.scans0_sr_status_label, sr_status: row.scans0_sr_status, scan_date: row.scans0_date, activity: row.scans0_activity },
      { status: row.scans1_status, sr_status_label: row.scans1_sr_status_label, sr_status: row.scans1_sr_status, scan_date: row.scans1_date, activity: row.scans1_activity },
    ]],
  });
  return {
    ...row,
    status_bucket: state.outcome === "DELIVERED" ? "delivered" : state.outcome === "RTO" ? "rto" : state.outcome === "NDR_OPEN" ? "ndr" : state.outcome === "IN_TRANSIT" ? "in_transit" : row.status_bucket,
    delivery_outcome: state.outcome,
    is_delivered: state.isDelivered,
    is_rto: state.isRto,
    is_ndr: state.isNdr,
    delivered_date: row.delivered_date || state.deliveredDate,
    canonical_delivery_source: state.source,
    status_conflict: state.statusConflict,
  };
}

async function canonicalizeExplorerRows(rows: Array<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(rows.map((row) => String(row.sr_order_id || "")).filter(Boolean))];
  const history = new Map<string, Array<Record<string, unknown>>>();
  const supabase = getSupabaseClient();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const { data, error } = await supabase.from("shiprocket_scans")
      .select("sr_order_id,scan_date,status,sr_status,sr_status_label,activity")
      .in("sr_order_id", batch);
    if (error) throw new Error(`Shiprocket delivery scan lookup failed: ${error.message}`);
    for (const scan of data || []) {
      const key = String(scan.sr_order_id);
      history.set(key, [...(history.get(key) || []), scan as Record<string, unknown>]);
    }
  }
  return rows.map((row) => canonicalizeExplorerRow(row, history.get(String(row.sr_order_id || "")) || []));
}

export function reconciliationStatus(row: Record<string, unknown>): string {
  const remitted = row.remittance_match_status === "matched";
  const payment = String(row.payment_bucket || "").toUpperCase();
  if (payment === "PREPAID") return remitted ? "PREPAID_WITH_REMITTANCE" : "NOT_APPLICABLE_PREPAID";
  if (!payment && !String(row.payment_method || "").trim()) return remitted ? "UNKNOWN_PAYMENT" : "PENDING";
  const cod = payment === "COD" || /cod/i.test(String(row.payment_method || ""));
  if (!cod) return remitted ? "PREPAID_WITH_REMITTANCE" : "NOT_APPLICABLE_PREPAID";
  if (canonicalDelivered(row)) return remitted ? "DELIVERED_REMITTED" : "DELIVERED_NOT_REMITTED";
  return remitted ? "REMITTED_NOT_DELIVERED" : "PENDING";
}

const OVERVIEW_COLUMNS = [
  "sr_order_id",
  "status_bucket",
  "shipment_status",
  "current_status",
  "shipment_status_id",
  "current_status_id",
  "delivered_date",
  "awb",
  "scans0_status",
  "scans0_sr_status_label",
  "scans0_sr_status",
  "scans0_date",
  "scans0_activity",
  "scans1_status",
  "scans1_sr_status_label",
  "scans1_sr_status",
  "scans1_date",
  "scans1_activity",
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

function previousCalendarDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function requestDateRange(request: ShiprocketFilterRequest): [string | null, string | null] {
  let from: string | null = null;
  let to: string | null = null;
  for (const filter of request.filters || []) {
    if (!("field" in filter)) continue;
    if (filter.field !== "last_webhook_sync_at" && filter.field !== "awb_assigned_date" && filter.field !== "order_date") continue;
    if (filter.operator === "between" && Array.isArray(filter.value)) return [String(filter.value[0] || "").slice(0, 10) || null, String(filter.value[1] || "").slice(0, 10) || null];
    if (["on", "after", "before", "gte", "gt", "lt", "lte"].includes(filter.operator)) {
      const day = String(filter.value || "").slice(0, 10);
      if (filter.operator === "after" || filter.operator === "gte" || filter.operator === "gt") from = day || null;
      else to = day ? (filter.operator === "lt" ? previousCalendarDay(day) : day) : null;
    }
  }
  return [from, to];
}

async function scopedRemittanceStats(request: ShiprocketFilterRequest, srOrderIds: string[]) {
  const supabase = getSupabaseClient();
  const rows = await loadScopedRemittanceRows(request, srOrderIds);
  const matched = rows.filter((row) => row.match_status === "matched").length;
  const unmatched = rows.filter((row) => row.match_status === "unmatched").length;
  const ambiguous = rows.filter((row) => row.match_status === "ambiguous").length;
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
    status: rows.length === 0 ? "NO_REMITTANCE_DATA" : matched > 0 && (unmatched > 0 || ambiguous > 0) ? "PARTIAL_REMITTANCE_DATA" : "RECONCILIATION_AVAILABLE",
    rowsTotal: rows.length, matched, unmatched,
    ambiguous,
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
  const canonicalStatusFilters = request.filters.filter((filter) =>
    "field" in filter && (filter.field === "status_bucket" || filter.field === "delivery_outcome")
  );
  const dbRequest = canonicalStatusFilters.length
    ? { ...request, filters: request.filters.filter((filter) => !("field" in filter && (filter.field === "status_bucket" || filter.field === "delivery_outcome"))) }
    : request;
  const rawRows: Record<string, unknown>[] = [];
  let count: number | null = null;
  if (canonicalStatusFilters.length) {
    for (let offset = 0; offset < 20000; offset += 1000) {
      let pageQuery = supabase.from("shiprocket_order_explorer").select(LIST_COLUMNS, { count: "exact" });
      pageQuery = applyAllClauses(pageQuery, dbRequest);
      pageQuery = pageQuery.order(sort.field, { ascending: sort.direction === "asc", nullsFirst: false }).range(offset, offset + 999);
      const { data, error, count: pageCount } = await pageQuery;
      if (error) throw new Error(`Shiprocket query failed: ${error.message}`);
      rawRows.push(...((data || []) as unknown as Record<string, unknown>[]));
      count = pageCount ?? count;
      if (!data || data.length < 1000) break;
    }
  } else {
    let query = supabase.from("shiprocket_order_explorer").select(LIST_COLUMNS, { count: "exact" });
    query = applyAllClauses(query, request);
    query = query.order(sort.field, { ascending: sort.direction === "asc", nullsFirst: false }).range(from, to);
    const { data, error, count: pageCount } = await query;
    if (error) throw new Error(`Shiprocket query failed: ${error.message}`);
    rawRows.push(...((data || []) as unknown as Record<string, unknown>[]));
    count = pageCount ?? null;
  }

  const canonicalRows = await canonicalizeExplorerRows(rawRows);
  const filteredCanonicalRows = canonicalStatusFilters.length
    ? canonicalRows.filter((row) => canonicalStatusFilters.every((filter) => {
      const expected = String(("value" in filter ? filter.value : "") || "").toUpperCase();
      return String(row.delivery_outcome || "").toUpperCase() === expected;
    }))
    : canonicalRows;
  const pageRows = canonicalStatusFilters.length ? filteredCanonicalRows.slice(from, to + 1) : filteredCanonicalRows;
  return {
    rows: pageRows.map((canonical) => {
      return { ...canonical, reconciliation_status: reconciliationStatus(canonical) };
    }) as unknown as ShiprocketExplorerRow[],
    total: canonicalStatusFilters.length ? filteredCanonicalRows.length : count ?? 0,
    page: request.page,
    pageSize: request.pageSize,
  };
}

export async function queryRemittanceJourneyReconciliation(importId: string, cohort?: { from?: string; to?: string }) {
  const supabase = getSupabaseClient();
  const { data: source, error: sourceError } = await supabase.from("shiprocket_remittance_import_rows")
    .select("crf_id,awb,order_id,matched_sr_order_id,match_status,match_method,match_reason_code,remittance_date,utr,order_value,total_adjusted_amt")
    .eq("import_id", importId).order("id", { ascending: true }).limit(20000);
  if (sourceError) throw new Error(`Journey remittance reconciliation source query failed: ${sourceError.message}`);
  const sourceRows = (source || []) as RemittanceSourceRow[];
  const srIds = [...new Set(sourceRows.map((row) => String(row.matched_sr_order_id || "")).filter(Boolean))];
  const shipments = new Map<string, ReconciliationShipment>();
  const journeys = new Map<string, ReconciliationJourneyRow>();
  const shopify = new Map<string, ReconciliationShopifySource>();
  for (let offset = 0; offset < srIds.length; offset += 500) {
    const ids = srIds.slice(offset, offset + 500);
    const [{ data: shipmentRows, error: shipmentError }, { data: journeyRows, error: journeyError }] = await Promise.all([
      supabase.from("shiprocket_order_explorer").select("sr_order_id,shipment_status,current_status,shipment_status_id,current_status_id,delivered_date,status_bucket,awb,payment_bucket,payment_method,shopify_order_identifier,order_id_shopify_format,shopify_matched").in("sr_order_id", ids),
      supabase.from("mart_order_journey_remittance").select("shiprocket_sr_order_id,shopify_order_id,created_at_shopify,order_date,payment_type,is_cod,is_delivered,delivery_outcome,remittance_status").in("shiprocket_sr_order_id", ids),
    ]);
    if (shipmentError) throw new Error(`Journey remittance shipment query failed: ${shipmentError.message}`);
    if (journeyError) throw new Error(`Journey remittance order query failed: ${journeyError.message}`);
    const scans = await supabase.from("shiprocket_scans").select("sr_order_id,scan_date,status,sr_status,sr_status_label,activity").in("sr_order_id", ids);
    if (scans.error) throw new Error(`Journey remittance scan query failed: ${scans.error.message}`);
    for (const row of shipmentRows || []) {
      shipments.set(String(row.sr_order_id), { ...row, scans: (scans.data || []).filter((scan) => String(scan.sr_order_id) === String(row.sr_order_id)) as Record<string, unknown>[] });
    }
    for (const row of journeyRows || []) journeys.set(String(row.shiprocket_sr_order_id), row as ReconciliationJourneyRow);
  }
  const shopifyIds = [...new Set([...shipments.values()].map((row) => String(row.shopify_order_identifier || "")).filter(Boolean))];
  if (shopifyIds.length) {
    const { data, error } = await supabase.from("shopify_orders").select("shopify_order_id,order_number,order_name,created_at_shopify,payment_gateway_names").in("shopify_order_id", shopifyIds).limit(20000);
    if (error) throw new Error(`Journey remittance Shopify query failed: ${error.message}`);
    for (const row of data || []) shopify.set(String(row.shopify_order_id), row as ReconciliationShopifySource);
  }
  const rows = reconcileRemittanceRows(sourceRows, shipments, journeys, shopify, cohort);
  return { importId, crfId: String(sourceRows.find((row) => row.crf_id)?.crf_id || ""), summary: summarizeRemittanceReconciliation(rows), rows };
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
      .select("crf_id, awb, order_id, remittance_type, remittance_date, utr, order_value, total_adjusted_amt, channel_name, linked_crf_ids, match_status, match_method, match_reason_code, match_candidate_count")
      .eq("matched_sr_order_id", srOrderId),
  ]);

  if (!order) return null;
  const crfIds = [...new Set((remittances || []).map((row) => row.crf_id).filter(Boolean))];
  const { data: crfs } = crfIds.length
    ? await supabase.from("shiprocket_remittances").select("*").in("crf_id", crfIds)
    : { data: [] };
  const crfMap = new Map((crfs || []).map((row) => [row.crf_id, row]));

  const canonicalOrder = canonicalizeExplorerRow(order as unknown as Record<string, unknown>, (scans || []) as Record<string, unknown>[]);
  return {
    order: canonicalOrder as unknown as ShiprocketExplorerRow,
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
  const canonicalEnrichedRows = await canonicalizeExplorerRows(enrichedRows as unknown as Record<string, unknown>[]);
  const overview = computeOverviewFromRows(canonicalEnrichedRows as OverviewRowInput[]);
  const remittance = await scopedRemittanceStats(request, allRows.map((row) => String(row.sr_order_id)).filter(Boolean));
  const isDelivered = (row: OverviewRowInput) => canonicalDelivered(row as Record<string, unknown>);
  const isCod = (row: OverviewRowInput) => row.shopify_payment_category ? row.shopify_payment_category === "COD" : row.payment_bucket === "COD" || /cod/i.test(String(row.payment_method || ""));
  const deliveredRows = canonicalEnrichedRows.filter((row) => isDelivered(row));
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
    remittanceAmbiguous: remittance.ambiguous,
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
    deliveredCodSettlementCoverage: deliveredCodRows.length ? Math.round((deliveredCodRemitted / deliveredCodRows.length) * 1000) / 10 : null,
    remittedNotDeliveredOrders: remittedNotDelivered,
    deliveredOrdersWithRemittance: deliveredRemitted,
    deliveredOrdersWithoutRemittance: Math.max(0, deliveredRows.length - deliveredRemitted),
    paymentUnknownOrders: deliveredRows.filter((row) => !row.shopify_payment_category && !String(row.payment_bucket || "").trim() && !String(row.payment_method || "").trim()).length,
    truncated: allRows.length >= 20000,
  };
}

export async function queryShiprocketRemittances(request: ShiprocketFilterRequest = { filters: [], search: "", page: 1, pageSize: 1, sort: [] }): Promise<{
  summary: Record<string, unknown> | null;
  importSummary: Record<string, unknown> | null;
  crfs: Record<string, unknown>[];
  imports: Record<string, unknown>[];
  rows: Record<string, unknown>[];
  exceptions: Record<string, unknown>[];
  operationalScope: { rows: number; outsideScope: number };
  scope: { type: "IMPORT" | "ALL_IMPORTS"; importId?: string; fileName?: string };
}> {
  const supabase = getSupabaseClient();
  const [selectedIds, importsResult] = await Promise.all([
    filteredShiprocketIds(request),
    supabase
      .from("shiprocket_remittance_imports")
      .select("id, file_name, file_hash, source, awb_rows_read, awb_rows_upserted, crf_rows_read, crf_rows_upserted, matched_orders, unmatched_orders, ambiguous_orders, matched_by_awb, matched_by_order_id, matched_by_shopify_format, status, started_at, completed_at, error_message")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (importsResult.error) throw new Error(`Remittance imports query failed: ${importsResult.error.message}`);
  const imports = importsResult.data || [];
  const selectedImport = request.remittanceImportId && request.remittanceImportId !== "ALL"
    ? imports.find((row) => String(row.id) === request.remittanceImportId)
    : !request.remittanceImportId ? imports.find((row) => row.status === "completed") : null;
  if (request.remittanceImportId && request.remittanceImportId !== "ALL" && !selectedImport) {
    throw new Error("Selected remittance import was not found");
  }
  let scopedRows: Record<string, unknown>[];
  let scope: { type: "IMPORT" | "ALL_IMPORTS"; importId?: string; fileName?: string };
  if (selectedImport) {
    const { data, error } = await supabase.from("shiprocket_remittance_import_rows")
      .select("id,import_id,crf_id,awb,order_id,match_status,match_method,match_reason_code,match_candidate_count,matched_sr_order_id,delivered_date,remittance_date,courier,order_value,channel_name,remittance_type,utr,total_adjusted_amt,linked_crf_ids")
      .eq("import_id", selectedImport.id).order("id", { ascending: true }).limit(20000);
    if (error) throw new Error(`Import remittance rows query failed: ${error.message}`);
    scopedRows = (data || []) as Record<string, unknown>[];
    scope = { type: "IMPORT", importId: String(selectedImport.id), fileName: String(selectedImport.file_name || "") };
  } else {
    scopedRows = await loadScopedRemittanceRows(request, selectedIds);
    scope = { type: "ALL_IMPORTS" };
  }
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
  const crfAwbDates = new Map<string, Set<string>>();
  for (const row of crfRows) {
    const date = String(row.remittance_date || "").slice(0, 10);
    if (date) crfAwbDates.set(String(row.crf_id), new Set([...(crfAwbDates.get(String(row.crf_id)) || []), date]));
  }

  const deliveryBySr = new Map<string, Record<string, unknown>>();
  const matchedSrIds = [...new Set(scopedRows.filter((row) => row.matched_sr_order_id).map((row) => String(row.matched_sr_order_id)))];
  for (let offset = 0; offset < matchedSrIds.length; offset += 500) {
    const ids = matchedSrIds.slice(offset, offset + 500);
    const { data, error } = await supabase.from("shiprocket_order_explorer").select("sr_order_id,status_bucket,shipment_status,current_status,shipment_status_id,current_status_id,delivered_date,awb_assigned_date,order_date,payment_bucket,awb,scans0_status,scans0_sr_status_label,scans0_sr_status,scans0_date,scans0_activity,scans1_status,scans1_sr_status_label,scans1_sr_status,scans1_date,scans1_activity").in("sr_order_id", ids);
    if (error) throw new Error(`Remittance delivery reconciliation failed: ${error.message}`);
    const canonicalRows = await canonicalizeExplorerRows((data || []) as Record<string, unknown>[]);
    for (const row of canonicalRows) deliveryBySr.set(String(row.sr_order_id), row);
  }
  const crfStats = new Map<string, { awb_count: number; matched: number; unmatched: number; ambiguous: number; delivered: number; not_delivered: number }>();
  for (const row of crfRows || []) {
    const crfId = String(row.crf_id || "");
    const current = crfStats.get(crfId) ?? { awb_count: 0, matched: 0, unmatched: 0, ambiguous: 0, delivered: 0, not_delivered: 0 };
    current.awb_count += 1;
    if (row.match_status === "matched") current.matched += 1;
    else if (row.match_status === "ambiguous") current.ambiguous += 1;
    else current.unmatched += 1;
    const shipment = deliveryBySr.get(String(row.matched_sr_order_id));
    if (row.match_status === "matched") shipment?.status_bucket === "delivered" ? current.delivered += 1 : current.not_delivered += 1;
    crfStats.set(crfId, current);
  }
  const matchedRows = scopedRows.filter((row) => row.match_status === "matched");
  const matchedDelivered = matchedRows.filter((row) => deliveryBySr.get(String(row.matched_sr_order_id))?.status_bucket === "delivered").length;
  const matchedDeliveredCod = matchedRows.filter((row) => deliveryBySr.get(String(row.matched_sr_order_id))?.status_bucket === "delivered" && String(deliveryBySr.get(String(row.matched_sr_order_id))?.payment_bucket || "").toUpperCase() === "COD").length;
  const matchedDeliveredNonCod = matchedRows.filter((row) => deliveryBySr.get(String(row.matched_sr_order_id))?.status_bucket === "delivered" && String(deliveryBySr.get(String(row.matched_sr_order_id))?.payment_bucket || "").toUpperCase() === "PREPAID").length;
  const importSummary = selectedImport ? {
    imported_rows: scopedRows.length,
    matched: matchedRows.length,
    unmatched: scopedRows.filter((row) => row.match_status === "unmatched").length,
    ambiguous: scopedRows.filter((row) => row.match_status === "ambiguous").length,
    match_rate: scopedRows.length ? Math.round((matchedRows.length / scopedRows.length) * 1000) / 10 : null,
    matched_delivered: matchedDelivered,
    matched_not_delivered: matchedRows.length - matchedDelivered,
    matched_delivered_cod: matchedDeliveredCod,
    matched_delivered_non_cod: matchedDeliveredNonCod,
    matched_delivered_unknown: matchedDelivered - matchedDeliveredCod - matchedDeliveredNonCod,
    outside_scope: matchedRows.filter((row) => !selectedIds.includes(String(row.matched_sr_order_id || ""))).length,
  } : null;

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
    importSummary,
    crfs: (summaryRows || []).map((row) => ({
      ...row,
      remittance_date: row.remittance_date || (() => {
        const dates = [...(crfAwbDates.get(String(row.crf_id)) || new Set<string>())];
        return dates.length === 1 ? dates[0] : dates.length > 1 ? "Multiple dates" : null;
      })(),
      settlement_amount: row.remittance_amount != null && row.remittance_amount !== "" ? row.remittance_amount : (awbAmountByCrf.has(String(row.crf_id)) ? awbAmountByCrf.get(String(row.crf_id)) : null),
      ...(crfStats.get(row.crf_id) ?? { awb_count: 0, matched: 0, unmatched: 0, ambiguous: 0, delivered: 0, not_delivered: 0 }),
    })),
    imports,
    rows: scopedRows,
    exceptions: scopedRows.filter((row) => row.match_status !== "matched" || !selectedIds.includes(String(row.matched_sr_order_id || "")) || deliveryBySr.get(String(row.matched_sr_order_id))?.status_bucket !== "delivered").map((row) => {
      const shipment = deliveryBySr.get(String(row.matched_sr_order_id || ""));
      const outsideScope = row.match_status === "matched" && !selectedIds.includes(String(row.matched_sr_order_id || ""));
      const notDelivered = row.match_status === "matched" && shipment && shipment.status_bucket !== "delivered";
      return { ...row, ...shipment, outside_operational_scope: outsideScope, exception_reason: outsideScope ? "OUTSIDE_OPERATIONAL_SCOPE" : row.match_status === "unmatched" ? row.match_reason_code : row.match_status === "ambiguous" ? row.match_reason_code : notDelivered ? String(shipment?.status_bucket || "MISSING_DELIVERY_STATUS").toUpperCase() : "OTHER" };
    }),
    operationalScope: { rows: scopedRows.filter((row) => row.match_status === "matched" && selectedIds.includes(String(row.matched_sr_order_id || ""))).length, outsideScope: scopedRows.filter((row) => row.match_status === "matched" && !selectedIds.includes(String(row.matched_sr_order_id || ""))).length },
    scope,
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
  const unmatchedCount = list.filter((row) => row.match_status === "unmatched").length;
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
