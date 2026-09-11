import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { extractShopifyOrderId } from "./enrichment";

export const AWB_REPORT_SHEET = "AWB level report";
export const CRF_REPORT_SHEET = "CRF level report";
export const AWB_REQUIRED_HEADERS = [
  "CRF ID",
  "AWB",
  "Delivered Date",
  "Shipped Date",
  "Order Id",
  "Courier",
  "Order Value",
  "Channel Name",
  "Remmitance Type",
  "Remittance Date",
  "UTR",
  "total_adjusted_amt",
  "Linked CRF Ids",
] as const;

export const CRF_REQUIRED_HEADERS = [
  "Date",
  "CRF ID",
  "COD Available",
  "Instant COD Available",
  "Standard COD Available",
  "Early COD Available",
  "Freight Charges from COD",
  "RTO Reversal Amount",
  "Remittance Amount",
  "Remittance Method",
  "UTR",
  "Adjusted Amount",
  "Status",
  "remarks",
  "Early COD Charges",
  "Instant COD Charges",
] as const;

export const MAX_REMITTANCE_UPLOAD_BYTES = 8 * 1024 * 1024;

export type RemittanceMatchStatus = "matched" | "unmatched" | "ambiguous";
export type RemittanceMatchMethod = "AWB" | "ORDER_ID" | "SHOPIFY_FORMAT" | "NONE";
export type RemittanceMatchReasonCode =
  | "MATCHED_BY_AWB" | "MATCHED_BY_ORDER_ID" | "MATCHED_BY_SHOPIFY_FORMAT"
  | "MISSING_AWB_AND_ORDER_ID" | "AWB_NOT_FOUND" | "ORDER_ID_NOT_FOUND"
  | "SHOPIFY_ORDER_NOT_FOUND" | "MULTIPLE_AWB_MATCHES" | "MULTIPLE_ORDER_ID_MATCHES"
  | "MULTIPLE_SHOPIFY_MATCHES" | "INVALID_ORDER_IDENTIFIER" | "UNKNOWN";

export interface ParsedAwbRemittanceRow {
  crf_id: string;
  awb: string;
  order_id: string;
  delivered_date: string | null;
  shipped_date: string | null;
  courier: string;
  order_value: string | null;
  channel_name: string;
  remittance_type: string;
  remittance_date: string | null;
  utr: string;
  total_adjusted_amt: string | null;
  linked_crf_ids: string;
}

export interface ParsedCrfRemittanceRow {
  crf_id: string;
  report_date: string | null;
  remittance_date: string | null;
  cod_available: string | null;
  instant_cod_available: string | null;
  standard_cod_available: string | null;
  early_cod_available: string | null;
  freight_charges_from_cod: string | null;
  rto_reversal_amount: string | null;
  remittance_amount: string | null;
  remittance_method: string;
  adjusted_amount: string | null;
  utr: string;
  status: string;
  remarks: string;
  early_cod_charges: string | null;
  instant_cod_charges: string | null;
}

export interface ParsedRemittanceWorkbook {
  awbRows: ParsedAwbRemittanceRow[];
  crfRows: ParsedCrfRemittanceRow[];
}

export interface OrderMatchIndex {
  byAwb: Map<string, string[]>;
  byOrderId: Map<string, string[]>;
  byShopifyFormat: Map<string, string[]>;
}

export function cellText(sheet: XLSX.WorkSheet, address: string): string {
  const cell = sheet[address];
  if (!cell) return "";
  if (cell.w != null && String(cell.w).trim() !== "") {
    return normalizeBusinessIdentifier(String(cell.w).trim());
  }
  if (cell.t === "s" && cell.v != null) {
    return normalizeBusinessIdentifier(cell.v);
  }
  if (cell.t === "n" && typeof cell.v === "number" && Number.isFinite(cell.v)) {
    if (cell.z) {
      const formatted = XLSX.SSF.format(cell.z, cell.v).trim();
      if (formatted && !/[eE]/.test(formatted)) {
        return normalizeBusinessIdentifier(formatted);
      }
    }
    if (Math.abs(cell.v - Math.round(cell.v)) < 1e-9) {
      return normalizeBusinessIdentifier(cell.v);
    }
  }
  if (cell.v == null) return "";
  return normalizeBusinessIdentifier(cell.v);
}

function expandScientificNotation(text: string): string | null {
  const match = text.trim().match(/^([+-]?)(\d+)\.?(\d*)[eE]([+-]?\d+)$/);
  if (!match) return null;
  const sign = match[1] === "-" ? "-" : "";
  const intPart = match[2];
  const fracPart = match[3] ?? "";
  const exp = Number.parseInt(match[4], 10);
  if (!Number.isFinite(exp)) return null;
  const digits = intPart + fracPart;
  if (exp >= fracPart.length) {
    return `${sign}${digits}${"0".repeat(exp - fracPart.length)}`;
  }
  const splitAt = intPart.length + exp;
  if (splitAt <= 0) return null;
  const whole = `${digits.slice(0, splitAt)}${digits.slice(splitAt)}`.replace(/\.$/, "");
  if (whole.includes(".") && !whole.endsWith(".0")) return null;
  return `${sign}${whole.replace(/\.$/, "")}`;
}

/** Trim identifiers; never emit scientific notation for whole-number AWBs/order ids. */
export function normalizeBusinessIdentifier(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const asText = String(value);
    if (/[eE]/.test(asText)) {
      const expanded = expandScientificNotation(asText);
      if (expanded) return expanded;
    }
    if (Math.abs(value - Math.round(value)) < 1e-9 && Number.isSafeInteger(Math.round(value))) {
      return String(Math.trunc(value));
    }
  }
  const text = String(value).trim();
  if (!text) return "";
  if (/[eE]/.test(text)) {
    const expanded = expandScientificNotation(text);
    if (expanded) return expanded;
  }
  return text;
}

function readSheetAsTextRows(sheet: XLSX.WorkSheet): Record<string, string>[] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    headers.push(cellText(sheet, XLSX.utils.encode_cell({ r: range.s.r, c })));
  }
  const rows: Record<string, string>[] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row: Record<string, string> = {};
    let hasValue = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const header = headers[c - range.s.c];
      if (!header) continue;
      const value = cellText(sheet, XLSX.utils.encode_cell({ r, c }));
      if (value) hasValue = true;
      row[header] = value;
    }
    if (hasValue) rows.push(row);
  }
  return rows;
}

function headerKey(value: unknown): string {
  return String(value ?? "").replace(/[\s_-]+/g, " ").trim().toLowerCase();
}

const HEADER_ALIASES: Record<string, string[]> = {
  "order id": ["order id", "order identifier", "order number"],
  "remittance amount": ["remittance amount", "settlement amount", "cod settlement amount"],
  "total adjusted amt": ["total adjusted amt", "total adjusted amount", "adjusted amount"],
  "remittance type": ["remittance type", "remmitance type"],
};

function cell(row: Record<string, unknown>, header: string): string {
  const want = HEADER_ALIASES[headerKey(header)] || [headerKey(header)];
  for (const [key, value] of Object.entries(row)) {
    if (want.includes(headerKey(key))) {
      if (value == null) return "";
      return String(value).trim();
    }
  }
  return "";
}

export function parseExcelDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const yyyy = String(parsed.y).padStart(4, "0");
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseMoney(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(4);
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(4);
}

function requireSheet(workbook: XLSX.WorkBook, name: string): XLSX.WorkSheet {
  const sheet = workbook.Sheets[name];
  if (!sheet) {
    throw new Error(`Missing required sheet: ${name}`);
  }
  return sheet;
}

function assertHeaders(rows: Record<string, unknown>[], required: readonly string[], sheet: string): void {
  if (rows.length === 0) {
    throw new Error(`${sheet} has no data rows`);
  }
  const present = new Set(Object.keys(rows[0] || {}).map(headerKey));
  const missing = required.filter((header) => !(HEADER_ALIASES[headerKey(header)] || [headerKey(header)]).some((alias) => present.has(alias)));
  if (missing.length > 0) {
    throw new Error(`${sheet} missing headers: ${missing.join(", ")}`);
  }
}

export function parseRemittanceWorkbook(buffer: Buffer): ParsedRemittanceWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  const awbSheet = requireSheet(workbook, AWB_REPORT_SHEET);
  const crfSheet = requireSheet(workbook, CRF_REPORT_SHEET);
  const awbObjects = readSheetAsTextRows(awbSheet).map((row) => row as Record<string, unknown>);
  const crfObjects = readSheetAsTextRows(crfSheet).map((row) => row as Record<string, unknown>);
  assertHeaders(awbObjects, AWB_REQUIRED_HEADERS, AWB_REPORT_SHEET);
  assertHeaders(crfObjects, CRF_REQUIRED_HEADERS, CRF_REPORT_SHEET);

  const awbRows = awbObjects
    .map((row) => ({
      crf_id: normalizeBusinessIdentifier(cell(row, "CRF ID")),
      awb: normalizeBusinessIdentifier(cell(row, "AWB")),
      order_id: normalizeBusinessIdentifier(cell(row, "Order Id")),
      delivered_date: parseExcelDate(row["Delivered Date"] ?? cell(row, "Delivered Date")),
      shipped_date: parseExcelDate(row["Shipped Date"] ?? cell(row, "Shipped Date")),
      courier: cell(row, "Courier"),
      order_value: parseMoney(row["Order Value"] ?? cell(row, "Order Value")),
      channel_name: cell(row, "Channel Name"),
      remittance_type: cell(row, "Remmitance Type"),
      remittance_date: parseExcelDate(row["Remittance Date"] ?? cell(row, "Remittance Date")),
      utr: normalizeBusinessIdentifier(cell(row, "UTR")),
      total_adjusted_amt: parseMoney(row["total_adjusted_amt"] ?? cell(row, "total_adjusted_amt")),
      linked_crf_ids: cell(row, "Linked CRF Ids"),
    }))
    .filter((row) => row.crf_id || row.awb || row.order_id);

  const crfRows = crfObjects
    .map((row) => ({
      crf_id: normalizeBusinessIdentifier(cell(row, "CRF ID")),
      report_date: parseExcelDate(row["Date"] ?? cell(row, "Date")),
      remittance_date: parseExcelDate(row["Remittance Date"] ?? cell(row, "Remittance Date") ?? row["Date"]),
      cod_available: parseMoney(row["COD Available"] ?? cell(row, "COD Available")),
      instant_cod_available: parseMoney(row["Instant COD Available"] ?? cell(row, "Instant COD Available")),
      standard_cod_available: parseMoney(row["Standard COD Available"] ?? cell(row, "Standard COD Available")),
      early_cod_available: parseMoney(row["Early COD Available"] ?? cell(row, "Early COD Available")),
      freight_charges_from_cod: parseMoney(
        row["Freight Charges from COD"] ?? cell(row, "Freight Charges from COD")
      ),
      rto_reversal_amount: parseMoney(row["RTO Reversal Amount"] ?? cell(row, "RTO Reversal Amount")),
      remittance_amount: parseMoney(row["Remittance Amount"] ?? cell(row, "Remittance Amount")),
      remittance_method: cell(row, "Remittance Method"),
      adjusted_amount: parseMoney(row["Adjusted Amount"] ?? cell(row, "Adjusted Amount")),
      utr: normalizeBusinessIdentifier(cell(row, "UTR")),
      status: cell(row, "Status"),
      remarks: cell(row, "remarks"),
      early_cod_charges: parseMoney(row["Early COD Charges"] ?? cell(row, "Early COD Charges")),
      instant_cod_charges: parseMoney(row["Instant COD Charges"] ?? cell(row, "Instant COD Charges")),
    }))
    .filter((row) => row.crf_id);

  return { awbRows, crfRows };
}

export function buildSyntheticRemittanceWorkbook(): Buffer {
  const awbHeader = [...AWB_REQUIRED_HEADERS];
  const crfHeader = [...CRF_REQUIRED_HEADERS];
  const awbRows = [
    awbHeader,
    [
      "CRF-TEST-001",
      "TESTAWB001",
      "2026-08-01",
      "2026-07-28",
      "TESTORDER01",
      "Delhivery",
      "1499",
      "Shopify",
      "Standard",
      "2026-08-10",
      "IN20000000000000",
      "0",
      "",
    ],
    [
      "CRF-TEST-001",
      "TESTAWB002",
      "2026-08-02",
      "2026-07-29",
      "TESTORDER02",
      "BlueDart",
      "999",
      "Shopify",
      "Standard",
      "2026-08-10",
      "IN20000000000000",
      "0",
      "",
    ],
    [
      "CRF-TEST-001",
      "TESTAWB003",
      "2026-08-03",
      "2026-07-30",
      "TESTORDER03",
      "Delhivery",
      "1999",
      "Shopify",
      "Standard",
      "2026-08-10",
      "IN20000000000000",
      "10",
      "",
    ],
  ];
  const crfRows = [
    crfHeader,
    [
      "2026-08-10",
      "CRF-TEST-001",
      "4497",
      "0",
      "4497",
      "0",
      "120",
      "0",
      "4377",
      "NEFT",
      "IN20000000000000",
      "10",
      "Remittance success",
      "test remarks",
      "0",
      "0",
    ],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(awbRows), AWB_REPORT_SHEET);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(crfRows), CRF_REPORT_SHEET);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

export function hashRemittanceFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function pushIndex(map: Map<string, string[]>, key: unknown, srOrderId: string): void {
  const normalized = normalizeBusinessIdentifier(key);
  if (!normalized) return;
  const list = map.get(normalized) ?? [];
  if (!list.includes(srOrderId)) list.push(srOrderId);
  map.set(normalized, list);
}

export interface RemittanceMatchDiagnostic {
  awbPresent: boolean;
  orderIdPresent: boolean;
  awbMatchFound: boolean;
  orderIdMatchFound: boolean;
  shopifyMatchFound: boolean;
  canonicalOrdersTotal: number;
  matchMethod: RemittanceMatchMethod;
  matchReasonCode: RemittanceMatchReasonCode;
  matchCandidateCount: number;
}

export function diagnoseRemittanceMatch(
  row: Pick<ParsedAwbRemittanceRow, "awb" | "order_id">,
  index: OrderMatchIndex,
  canonicalOrdersTotal: number,
  match?: Pick<ReturnType<typeof matchRemittanceOrderRow>, "matchMethod" | "matchReasonCode" | "matchCandidateCount">
): RemittanceMatchDiagnostic {
  const awb = normalizeBusinessIdentifier(row.awb);
  const orderId = normalizeBusinessIdentifier(row.order_id);
  const shopify = extractShopifyOrderId(orderId);
  return {
    awbPresent: Boolean(awb),
    orderIdPresent: Boolean(orderId),
    awbMatchFound: awb ? (index.byAwb.get(awb)?.length ?? 0) > 0 : false,
    orderIdMatchFound: orderId ? (index.byOrderId.get(orderId)?.length ?? 0) > 0 : false,
    shopifyMatchFound: shopify ? (index.byShopifyFormat.get(shopify)?.length ?? 0) > 0 : false,
    canonicalOrdersTotal,
    matchMethod: match?.matchMethod ?? "NONE",
    matchReasonCode: match?.matchReasonCode ?? "UNKNOWN",
    matchCandidateCount: match?.matchCandidateCount ?? 0,
  };
}

export function indexOrdersForRemittanceMatch(
  orders: Array<{ sr_order_id: string; awb?: string | null; order_id?: string | null }>
): OrderMatchIndex {
  const byAwb = new Map<string, string[]>();
  const byOrderId = new Map<string, string[]>();
  const byShopifyFormat = new Map<string, string[]>();
  for (const order of orders) {
    pushIndex(byAwb, order.awb, order.sr_order_id);
    pushIndex(byOrderId, order.order_id, order.sr_order_id);
    const shopify = extractShopifyOrderId(normalizeBusinessIdentifier(order.order_id));
    if (shopify) pushIndex(byShopifyFormat, shopify, order.sr_order_id);
  }
  return { byAwb, byOrderId, byShopifyFormat };
}

export function matchRemittanceOrderRow(
  row: Pick<ParsedAwbRemittanceRow, "awb" | "order_id">,
  index: OrderMatchIndex
): { status: RemittanceMatchStatus; matchedSrOrderId: string | null; matchMethod: RemittanceMatchMethod; matchReasonCode: RemittanceMatchReasonCode; matchCandidateCount: number } {
  const awb = normalizeBusinessIdentifier(row.awb);
  const orderId = normalizeBusinessIdentifier(row.order_id);

  const awbHits = awb ? index.byAwb.get(awb) ?? [] : [];
  if (awbHits.length === 1) return { status: "matched", matchedSrOrderId: awbHits[0], matchMethod: "AWB", matchReasonCode: "MATCHED_BY_AWB", matchCandidateCount: 1 };
  if (awbHits.length > 1) return { status: "ambiguous", matchedSrOrderId: null, matchMethod: "AWB", matchReasonCode: "MULTIPLE_AWB_MATCHES", matchCandidateCount: awbHits.length };

  const orderHits = orderId ? index.byOrderId.get(orderId) ?? [] : [];
  if (orderHits.length === 1) return { status: "matched", matchedSrOrderId: orderHits[0], matchMethod: "ORDER_ID", matchReasonCode: "MATCHED_BY_ORDER_ID", matchCandidateCount: 1 };
  if (orderHits.length > 1) return { status: "ambiguous", matchedSrOrderId: null, matchMethod: "ORDER_ID", matchReasonCode: "MULTIPLE_ORDER_ID_MATCHES", matchCandidateCount: orderHits.length };

  const shopify = extractShopifyOrderId(orderId);
  const shopifyHits = shopify ? index.byShopifyFormat.get(shopify) ?? [] : [];
  if (shopifyHits.length === 1) return { status: "matched", matchedSrOrderId: shopifyHits[0], matchMethod: "SHOPIFY_FORMAT", matchReasonCode: "MATCHED_BY_SHOPIFY_FORMAT", matchCandidateCount: 1 };
  if (shopifyHits.length > 1) return { status: "ambiguous", matchedSrOrderId: null, matchMethod: "SHOPIFY_FORMAT", matchReasonCode: "MULTIPLE_SHOPIFY_MATCHES", matchCandidateCount: shopifyHits.length };

  return {
    status: "unmatched", matchedSrOrderId: null, matchMethod: "NONE",
    matchReasonCode: !awb && !orderId ? "MISSING_AWB_AND_ORDER_ID" : awbHits.length === 0 && awb ? "AWB_NOT_FOUND" : orderId ? "ORDER_ID_NOT_FOUND" : "SHOPIFY_ORDER_NOT_FOUND",
    matchCandidateCount: 0,
  };
}

export async function importRemittanceWorkbook(options: {
  fileName: string;
  buffer: Buffer;
  source?: string;
}): Promise<{
  importId: string;
  fileHash: string;
  awbRowsRead: number;
  awbRowsUpserted: number;
  crfRowsRead: number;
  crfRowsUpserted: number;
  matchedOrders: number;
  unmatchedOrders: number;
  ambiguousOrders: number;
  matchedByAwb: number;
  matchedByOrderId: number;
  matchedByShopifyFormat: number;
  canonicalOrdersTotal: number;
  sampleUnmatched: RemittanceMatchDiagnostic[];
}> {
  if (options.buffer.length > MAX_REMITTANCE_UPLOAD_BYTES) {
    throw new Error("Remittance file exceeds 8MB");
  }
  const fileHash = hashRemittanceFile(options.buffer);
  const parsed = parseRemittanceWorkbook(options.buffer);
  const supabase = getSupabaseClient();
  const source = options.source ?? "report_upload";

  const { data: importRow, error: importError } = await supabase
    .from("shiprocket_remittance_imports")
    .insert({
      file_name: options.fileName,
      file_hash: fileHash,
      source,
      status: "started",
      awb_rows_read: parsed.awbRows.length,
      crf_rows_read: parsed.crfRows.length,
    })
    .select("id")
    .single();
  if (importError || !importRow) {
    throw new Error(importError?.message || "Failed to create remittance import audit");
  }

  try {
    // Paginated fetch — default PostgREST limit is 1000, so loop to get all 2357+
    const canonicalOrders: Array<{ sr_order_id: string; awb: string | null; order_id: string | null }> = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("shiprocket_orders")
        .select("sr_order_id, awb, order_id")
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      canonicalOrders.push(...(data as any[]));
      if (data.length < 1000) break;
      offset += 1000;
    }
    const index = indexOrdersForRemittanceMatch(canonicalOrders);
    const sampleUnmatched: RemittanceMatchDiagnostic[] = [];

    let crfUpserted = 0;
    for (const row of parsed.crfRows) {
      const { data, error } = await supabase
        .from("shiprocket_remittances")
        .upsert(
          {
            crf_id: row.crf_id,
            report_date: row.report_date,
            remittance_date: row.remittance_date,
            cod_available: row.cod_available,
            instant_cod_available: row.instant_cod_available,
            standard_cod_available: row.standard_cod_available,
            early_cod_available: row.early_cod_available,
            freight_charges_from_cod: row.freight_charges_from_cod,
            rto_reversal_amount: row.rto_reversal_amount,
            remittance_amount: row.remittance_amount,
            remittance_method: row.remittance_method,
            adjusted_amount: row.adjusted_amount,
            utr: row.utr || null,
            status: row.status,
            remarks: row.remarks,
            early_cod_charges: row.early_cod_charges,
            instant_cod_charges: row.instant_cod_charges,
            source,
            last_source_sync_at: new Date().toISOString(),
          },
          { onConflict: "crf_id" }
        )
        .select("id, crf_id")
        .single();
      if (error) throw new Error(error.message);
      crfUpserted += 1;
      void data;
    }

    const { data: remittances } = await supabase
      .from("shiprocket_remittances")
      .select("id, crf_id")
      .in(
        "crf_id",
        parsed.crfRows.map((row) => row.crf_id)
      );
    const remittanceIds = new Map((remittances || []).map((row) => [row.crf_id, row.id]));

    let matched = 0;
    let unmatched = 0;
    let ambiguous = 0;
    let awbUpserted = 0;
    let matchedByAwb = 0;
    let matchedByOrderId = 0;
    let matchedByShopifyFormat = 0;
    const importAuditRows: Record<string, unknown>[] = [];
    for (const row of parsed.awbRows) {
      const match = matchRemittanceOrderRow(row, index);
      if (match.status === "matched") matched += 1;
      else if (match.status === "ambiguous") ambiguous += 1;
      else unmatched += 1;
      if (match.matchMethod === "AWB") matchedByAwb += 1;
      if (match.matchMethod === "ORDER_ID") matchedByOrderId += 1;
      if (match.matchMethod === "SHOPIFY_FORMAT") matchedByShopifyFormat += 1;

      if (match.status === "unmatched" && sampleUnmatched.length < 5) {
        sampleUnmatched.push(diagnoseRemittanceMatch(row, index, canonicalOrders.length, match));
      }

      const { error } = await supabase.from("shiprocket_remittance_orders").upsert(
        {
          remittance_id: remittanceIds.get(row.crf_id) ?? null,
          crf_id: row.crf_id,
          awb: row.awb || "",
          order_id: row.order_id || "",
          delivered_date: row.delivered_date,
          shipped_date: row.shipped_date,
          courier: row.courier,
          order_value: row.order_value,
          channel_name: row.channel_name,
          remittance_type: row.remittance_type,
          remittance_date: row.remittance_date,
          utr: row.utr || null,
          total_adjusted_amt: row.total_adjusted_amt,
          linked_crf_ids: row.linked_crf_ids,
          matched_sr_order_id: match.matchedSrOrderId,
          match_status: match.status,
          match_method: match.matchMethod,
          match_reason_code: match.matchReasonCode,
          match_candidate_count: match.matchCandidateCount,
          last_import_id: importRow.id,
          source,
        },
        { onConflict: "crf_id,awb,order_id" }
      );
      if (error) throw new Error(error.message);
      awbUpserted += 1;
      importAuditRows.push({
        import_id: importRow.id, crf_id: row.crf_id || null, awb: row.awb || null, order_id: row.order_id || null,
        match_status: match.status, match_method: match.matchMethod, match_reason_code: match.matchReasonCode,
        match_candidate_count: match.matchCandidateCount, matched_sr_order_id: match.matchedSrOrderId,
        delivered_date: row.delivered_date, shipped_date: row.shipped_date, courier: row.courier || null,
        channel_name: row.channel_name || null, remittance_type: row.remittance_type || null,
        remittance_date: row.remittance_date, order_value: row.order_value,
        total_adjusted_amt: row.total_adjusted_amt, utr: row.utr || null,
        linked_crf_ids: row.linked_crf_ids || null,
      });
    }

    if (importAuditRows.length) {
      const { error } = await supabase.from("shiprocket_remittance_import_rows").insert(importAuditRows);
      if (error) throw new Error(error.message);
    }

    await supabase
      .from("shiprocket_remittance_imports")
      .update({
        status: "completed",
        awb_rows_upserted: awbUpserted,
        crf_rows_upserted: crfUpserted,
        matched_orders: matched,
        unmatched_orders: unmatched,
        ambiguous_orders: ambiguous,
        matched_by_awb: matchedByAwb,
        matched_by_order_id: matchedByOrderId,
        matched_by_shopify_format: matchedByShopifyFormat,
        completed_at: new Date().toISOString(),
      })
      .eq("id", importRow.id);

    return {
      importId: importRow.id,
      fileHash,
      awbRowsRead: parsed.awbRows.length,
      awbRowsUpserted: awbUpserted,
      crfRowsRead: parsed.crfRows.length,
      crfRowsUpserted: crfUpserted,
      matchedOrders: matched,
      unmatchedOrders: unmatched,
      ambiguousOrders: ambiguous,
      matchedByAwb,
      matchedByOrderId,
      matchedByShopifyFormat,
      canonicalOrdersTotal: canonicalOrders.length,
      sampleUnmatched,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "import failed";
    logger.error("Remittance import failed", { import_id: importRow.id });
    await supabase
      .from("shiprocket_remittance_imports")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", importRow.id);
    throw err;
  }
}
