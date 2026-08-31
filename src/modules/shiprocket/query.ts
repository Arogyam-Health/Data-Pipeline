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
import { computeOverviewFromRows, type OverviewRowInput, type ShiprocketOverview } from "./status";
import type { ShiprocketExplorerRow } from "./types";

const LIST_COLUMNS = SHIPROCKET_EXPLORER_COLUMNS.join(",");

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
    rows: (data || []) as unknown as ShiprocketExplorerRow[],
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
  let query = supabase.from("shiprocket_order_explorer").select(OVERVIEW_COLUMNS);
  query = applyAllClauses(query, request);
  const { data, error } = await query.limit(20000);
  if (error) throw new Error(`Shiprocket overview failed: ${error.message}`);
  const rows = data || [];
  return {
    ...computeOverviewFromRows(rows as OverviewRowInput[]),
    truncated: rows.length >= 20000,
  };
}

export async function queryShiprocketRemittances(): Promise<{
  summary: Record<string, unknown> | null;
  crfs: Record<string, unknown>[];
  imports: Record<string, unknown>[];
}> {
  const supabase = getSupabaseClient();
  const [summary, crfs, imports] = await Promise.all([
    supabase.from("shiprocket_remittances").select("*").order("remittance_date", { ascending: false }).limit(200),
    supabase.from("shiprocket_remittance_orders").select("crf_id, match_status, awb"),
    supabase
      .from("shiprocket_remittance_imports")
      .select("id, file_name, file_hash, source, awb_rows_read, awb_rows_upserted, crf_rows_read, crf_rows_upserted, matched_orders, unmatched_orders, ambiguous_orders, status, started_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const crfStats = new Map<string, { awb_count: number; matched: number; unmatched: number; ambiguous: number }>();
  for (const row of crfs.data || []) {
    const current = crfStats.get(row.crf_id) ?? { awb_count: 0, matched: 0, unmatched: 0, ambiguous: 0 };
    current.awb_count += 1;
    if (row.match_status === "matched") current.matched += 1;
    else if (row.match_status === "ambiguous") current.ambiguous += 1;
    else current.unmatched += 1;
    crfStats.set(row.crf_id, current);
  }

  return {
    summary: {
      crf_count: (summary.data || []).length,
      distinct_utrs: new Set((summary.data || []).map((row) => row.utr).filter(Boolean)).size,
      remittance_amount_total: (summary.data || []).reduce(
        (sum, row) => sum + Number(row.remittance_amount || 0),
        0
      ),
      latest_remittance_date: summary.data?.[0]?.remittance_date ?? null,
    },
    crfs: (summary.data || []).map((row) => ({
      ...row,
      ...(crfStats.get(row.crf_id) ?? { awb_count: 0, matched: 0, unmatched: 0, ambiguous: 0 }),
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

export async function loadShiprocketQuality(): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();
  const explorer = supabase.from("shiprocket_order_explorer");

  const [
    total,
    missingOrderId,
    missingAwb,
    missingShopifyId,
    matched,
    unmatched,
    missingName,
    missingPhone,
    missingApi,
    latestWebhook,
  ] = await Promise.all([
    explorer.select("sr_order_id", { count: "exact", head: true }),
    explorer.select("sr_order_id", { count: "exact", head: true }).or("order_id.is.null,order_id.eq."),
    explorer.select("sr_order_id", { count: "exact", head: true }).or("awb.is.null,awb.eq."),
    explorer.select("sr_order_id", { count: "exact", head: true }).or("order_id_shopify_format.is.null,order_id_shopify_format.eq."),
    explorer.select("sr_order_id", { count: "exact", head: true }).not("shopify_order_identifier", "is", null),
    explorer.select("sr_order_id", { count: "exact", head: true }).not("order_id_shopify_format", "is", null).is("shopify_order_identifier", null),
    explorer.select("sr_order_id", { count: "exact", head: true }).or("customer_name_shopify.is.null,customer_name_shopify.eq."),
    explorer.select("sr_order_id", { count: "exact", head: true }).or("customer_phone_shopify.is.null,customer_phone_shopify.eq."),
    explorer.select("sr_order_id", { count: "exact", head: true }).is("last_local_api_sync_at", null),
    explorer.select("last_webhook_sync_at").order("last_webhook_sync_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    orders_total: total.count ?? 0,
    missing_order_id: missingOrderId.count ?? 0,
    missing_awb: missingAwb.count ?? 0,
    missing_shopify_8_digit: missingShopifyId.count ?? 0,
    shopify_matched: matched.count ?? 0,
    shopify_unmatched: unmatched.count ?? 0,
    missing_customer_name: missingName.count ?? 0,
    missing_customer_phone: missingPhone.count ?? 0,
    last_api_sync_missing: missingApi.count ?? 0,
    last_webhook_sync: latestWebhook.data?.last_webhook_sync_at ?? null,
    remittance: (await loadRemittanceQuality()),
  };
}

async function loadRemittanceQuality(): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();
  const [crfs, awbs, matched, unmatched, ambiguous, latest] = await Promise.all([
    supabase.from("shiprocket_remittances").select("id", { count: "exact", head: true }),
    supabase.from("shiprocket_remittance_orders").select("id", { count: "exact", head: true }),
    supabase.from("shiprocket_remittance_orders").select("id", { count: "exact", head: true }).eq("match_status", "matched"),
    supabase.from("shiprocket_remittance_orders").select("id", { count: "exact", head: true }).eq("match_status", "unmatched"),
    supabase.from("shiprocket_remittance_orders").select("id", { count: "exact", head: true }).eq("match_status", "ambiguous"),
    supabase
      .from("shiprocket_remittance_imports")
      .select("completed_at, file_name, status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    crfs: crfs.count ?? 0,
    awb_rows: awbs.count ?? 0,
    matched: matched.count ?? 0,
    unmatched: unmatched.count ?? 0,
    ambiguous: ambiguous.count ?? 0,
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
