import { z } from "zod";

export type FilterFieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "enum"
  | "json";

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "in"
  | "not_in"
  | "empty"
  | "not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "on"
  | "before"
  | "after"
  | "last_n_days"
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "last_60_days"
  | "last_90_days"
  | "is"
  | "is_not"
  | "is_any_of"
  | "is_none_of"
  | "true"
  | "false";

export type FilterGroup =
  | "Identifiers"
  | "Status"
  | "Logistics"
  | "Scan / Tracking"
  | "Customer / Shopify"
  | "Payment / Order"
  | "Remittance / Settlement"
  | "Sync / Data Quality";

export interface FilterFieldMeta {
  key: string;
  label: string;
  type: FilterFieldType;
  operators: FilterOperator[];
  column: string;
  group: FilterGroup;
}

const TEXT_OPS: FilterOperator[] = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "empty",
  "not_empty",
];
const NUMBER_OPS: FilterOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "empty",
  "not_empty",
];
const DATE_OPS: FilterOperator[] = [
  "on",
  "before",
  "after",
  "between",
  "last_n_days",
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "last_60_days",
  "last_90_days",
  "empty",
  "not_empty",
];
const BOOL_OPS: FilterOperator[] = ["true", "false"];
const ENUM_OPS: FilterOperator[] = [
  "eq",
  "neq",
  "is",
  "is_not",
  "contains",
  "not_contains",
  "in",
  "not_in",
  "is_any_of",
  "is_none_of",
  "empty",
  "not_empty",
];
const JSON_OPS: FilterOperator[] = ["contains"];

function text(key: string, label: string, group: FilterGroup, column = key): FilterFieldMeta {
  return { key, label, type: "text", operators: TEXT_OPS, column, group };
}
function num(key: string, label: string, group: FilterGroup, column = key): FilterFieldMeta {
  return { key, label, type: "number", operators: NUMBER_OPS, column, group };
}
function date(key: string, label: string, group: FilterGroup, column = key): FilterFieldMeta {
  return { key, label, type: "date", operators: DATE_OPS, column, group };
}
function bool(key: string, label: string, group: FilterGroup, column = key): FilterFieldMeta {
  return { key, label, type: "boolean", operators: BOOL_OPS, column, group };
}
function enm(key: string, label: string, group: FilterGroup, column = key): FilterFieldMeta {
  return { key, label, type: "enum", operators: ENUM_OPS, column, group };
}

export const SHIPROCKET_FILTER_FIELDS: FilterFieldMeta[] = [
  text("unique_key", "Shiprocket Unique Key", "Identifiers"),
  text("sr_order_id", "Sr Order Id", "Identifiers"),
  text("order_id", "Order Id", "Identifiers"),
  text("order_id_shopify_format", "order id shopify format", "Identifiers"),
  text("awb", "Awb", "Identifiers"),
  text("return_awb_code", "Return AWB", "Identifiers"),
  text("shipment_id", "Shipment ID", "Identifiers"),
  text("channel_id", "Channel Id", "Identifiers"),
  text("shipment_status_id", "Shipment Status Id", "Status"),
  enm("shipment_status", "Shipment Status", "Status"),
  enm("current_status", "Current Status", "Status"),
  text("current_status_id", "Current Status Id", "Status"),
  enm("order_status", "Order Status", "Status"),
  text("order_status_code", "Order Status Code", "Status"),
  enm("status_bucket", "Status Bucket", "Status"),
  bool("is_return", "Is Return", "Status"),
  text("courier_name", "Courier Name", "Logistics"),
  text("pickup_location", "Pickup Location", "Logistics"),
  text("shipping_method", "Shipping Method", "Logistics"),
  text("etd", "Etd", "Logistics"),
  text("awb_assigned_date", "AWB Assigned Date", "Logistics"),
  text("pickup_scheduled_date", "Pickup Scheduled Date", "Logistics"),
  date("delivered_date", "Delivered Date", "Logistics"),
  num("delivery_attempt_count", "Delivery Attempt Count", "Logistics"),
  num("pickup_attempt_count", "Pickup Attempt Count", "Logistics"),
  text("pickup_exception_reason", "Pickup Exception Reason", "Logistics"),
  text("pick_exception_reason_code", "Pick Exception Reason Code", "Logistics"),
  text("undelivered_reason", "Undelivered Reason", "Logistics"),
  text("undelivered_reason_code", "Undelivered Reason Code", "Logistics"),
  text("pod_status", "POD Status", "Logistics"),
  text("pod", "POD", "Logistics"),
  text("scans1_status", "Scans 1 Status", "Scan / Tracking"),
  text("scans1_sr_status_label", "Scans 1 Sr-status-label", "Scan / Tracking"),
  text("scans1_sr_status", "Scans 1 Sr-status", "Scan / Tracking"),
  text("scans1_location", "Scans 1 Location", "Scan / Tracking"),
  text("scans1_date", "Scans 1 Date", "Scan / Tracking"),
  text("scans1_activity", "Scans 1 Activity", "Scan / Tracking"),
  text("scans0_status", "Scans 0 Status", "Scan / Tracking"),
  text("scans0_sr_status_label", "Scans 0 Sr-status-label", "Scan / Tracking"),
  text("scans0_sr_status", "Scans 0 Sr-status", "Scan / Tracking"),
  text("scans0_location", "Scans 0 Location", "Scan / Tracking"),
  text("scans0_date", "Scans 0 Date", "Scan / Tracking"),
  text("scans0_activity", "Scans 0 Activity", "Scan / Tracking"),
  bool("has_scan_activity", "Has Scan Activity", "Scan / Tracking"),
  text("customer_name_shopify", "Customer Name", "Customer / Shopify"),
  text("customer_email", "Customer Email", "Customer / Shopify"),
  text("customer_phone_shopify", "Customer Phone", "Customer / Shopify"),
  text("billing_name", "Billing Name", "Customer / Shopify"),
  text("billing_email", "Billing Email", "Customer / Shopify"),
  text("billing_phone", "Billing Phone", "Customer / Shopify"),
  text("coach", "Coach", "Customer / Shopify"),
  bool("shopify_matched", "Shopify Match", "Customer / Shopify"),
  text("shopify_order_identifier", "Shopify Order Identifier", "Customer / Shopify"),
  enm("payment_status", "Payment Status", "Payment / Order"),
  enm("payment_method", "Payment Method", "Payment / Order"),
  enm("payment_bucket", "Payment Bucket", "Payment / Order"),
  num("order_total", "Order Total", "Payment / Order", "order_total_num"),
  num("tax", "Tax", "Payment / Order"),
  text("products", "Products", "Payment / Order"),
  date("order_date", "Order Date", "Payment / Order"),
  date("created_at_sr", "Created At", "Payment / Order"),
  date("current_ts", "Current Timestamp", "Payment / Order"),
  text("latest_crf_id", "CRF ID", "Remittance / Settlement"),
  text("latest_utr", "UTR", "Remittance / Settlement"),
  date("latest_remittance_date", "Remittance Date", "Remittance / Settlement"),
  enm("latest_remittance_type", "Remittance Type", "Remittance / Settlement"),
  enm("latest_remittance_method", "Remittance Method", "Remittance / Settlement"),
  enm("latest_remittance_status", "Remittance Status", "Remittance / Settlement"),
  num("latest_order_settlement_value", "Order Settlement Value", "Remittance / Settlement"),
  num("latest_remittance_amount", "Remittance Amount", "Remittance / Settlement"),
  num("latest_adjusted_amount", "Adjusted Amount", "Remittance / Settlement"),
  num("latest_total_adjusted_amt", "total_adjusted_amt", "Remittance / Settlement"),
  num("latest_cod_available", "COD Available", "Remittance / Settlement"),
  num("latest_standard_cod_available", "Standard COD Available", "Remittance / Settlement"),
  num("latest_instant_cod_available", "Instant COD Available", "Remittance / Settlement"),
  num("latest_early_cod_available", "Early COD Available", "Remittance / Settlement"),
  num("latest_freight_charges_from_cod", "Freight Charges from COD", "Remittance / Settlement"),
  num("latest_rto_reversal_amount", "RTO Reversal Amount", "Remittance / Settlement"),
  num("latest_early_cod_charges", "Early COD Charges", "Remittance / Settlement"),
  num("latest_instant_cod_charges", "Instant COD Charges", "Remittance / Settlement"),
  text("latest_linked_crf_ids", "Linked CRF IDs", "Remittance / Settlement"),
  enm("remittance_match_status", "Remittance Match Status", "Remittance / Settlement"),
  date("last_webhook_sync_at", "Last Webhook Sync At", "Sync / Data Quality"),
  date("last_local_api_sync_at", "Last Local API Sync At", "Sync / Data Quality"),
  bool("api_enriched", "API Enriched", "Sync / Data Quality"),
  bool("has_raw_payload", "Has Raw Payload", "Sync / Data Quality"),
  {
    key: "raw_payload",
    label: "Raw Shiprocket JSON",
    type: "json",
    operators: JSON_OPS,
    column: "raw_payload",
    group: "Sync / Data Quality",
  },
];

export const FILTER_FIELD_MAP = new Map(
  SHIPROCKET_FILTER_FIELDS.map((field) => [field.key, field])
);

export const SORTABLE_FIELDS = new Set(
  SHIPROCKET_FILTER_FIELDS.filter((f) => f.key !== "raw_payload").map((f) => f.key)
);

const leafFilterSchema = z.object({
  field: z.string().min(1).max(80),
  operator: z.string().min(1).max(40),
  value: z.unknown().optional(),
});

const groupFilterSchema: z.ZodType<{ or: z.infer<typeof leafFilterSchema>[] }> = z.object({
  or: z.array(leafFilterSchema).min(1).max(20),
});

export const shiprocketFilterRequestSchema = z.object({
  filters: z.array(z.union([leafFilterSchema, groupFilterSchema])).max(40).default([]),
  sort: z
    .array(
      z.object({
        field: z.string().min(1).max(80),
        direction: z.enum(["asc", "desc"]).default("desc"),
      })
    )
    .max(3)
    .default([]),
  search: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  includeRaw: z.boolean().optional(),
});

export type ShiprocketFilterRequest = z.infer<typeof shiprocketFilterRequestSchema>;
export type LeafFilter = z.infer<typeof leafFilterSchema>;
export type AppliedFilter = LeafFilter | { or: LeafFilter[] };

export class ShiprocketFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShiprocketFilterError";
  }
}

function isSqlInjectionToken(value: string): boolean {
  return /[;"'\\]|--|\/\*|\*\/|xp_|information_schema|pg_sleep|drop\s+table|union\s+select/i.test(
    value
  );
}

export function validateFilterRequest(input: unknown): ShiprocketFilterRequest {
  const parsed = shiprocketFilterRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ShiprocketFilterError("Malformed filter request");
  }

  const data = parsed.data;
  if (data.pageSize > 500) {
    throw new ShiprocketFilterError("pageSize exceeds maximum of 500");
  }

  for (const item of data.filters) {
    if ("or" in item) {
      for (const leaf of item.or) validateLeaf(leaf);
    } else {
      validateLeaf(item);
    }
  }

  for (const sort of data.sort) {
    if (!SORTABLE_FIELDS.has(sort.field) || isSqlInjectionToken(sort.field)) {
      throw new ShiprocketFilterError(`Unknown sort field: ${sort.field}`);
    }
  }

  if (data.search && isSqlInjectionToken(data.search)) {
    throw new ShiprocketFilterError("Invalid search value");
  }

  return data;
}

function validateLeaf(leaf: LeafFilter): void {
  if (isSqlInjectionToken(leaf.field) || isSqlInjectionToken(leaf.operator)) {
    throw new ShiprocketFilterError("Rejected unsafe field or operator");
  }
  const meta = FILTER_FIELD_MAP.get(leaf.field);
  if (!meta) {
    throw new ShiprocketFilterError(`Unknown field: ${leaf.field}`);
  }
  if (!meta.operators.includes(leaf.operator as FilterOperator)) {
    throw new ShiprocketFilterError(`Unknown operator: ${leaf.operator}`);
  }
  validateValue(meta, leaf.operator as FilterOperator, leaf.value);
}

function validateValue(
  meta: FilterFieldMeta,
  operator: FilterOperator,
  value: unknown
): void {
  if (
    operator === "empty" ||
    operator === "not_empty" ||
    operator === "true" ||
    operator === "false" ||
    operator === "today" ||
    operator === "yesterday" ||
    operator === "last_7_days" ||
    operator === "last_30_days" ||
    operator === "last_60_days" ||
    operator === "last_90_days"
  ) {
    return;
  }
  if (operator === "in" || operator === "not_in" || operator === "is_any_of" || operator === "is_none_of") {
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
      throw new ShiprocketFilterError("in/not_in requires a non-empty array of at most 50 values");
    }
    return;
  }
  if (operator === "between") {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new ShiprocketFilterError("between requires [from, to]");
    }
    if (meta.type === "date" || meta.type === "number") {
      if (meta.type === "date") {
        assertDate(value[0]);
        assertDate(value[1]);
      }
    }
    return;
  }
  if (operator === "last_n_days") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      throw new ShiprocketFilterError("last_n_days requires an integer 1-3650");
    }
    return;
  }
  if (meta.type === "date" && (operator === "on" || operator === "before" || operator === "after")) {
    assertDate(value);
  }
}

function assertDate(value: unknown): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ShiprocketFilterError("Malformed date");
  }
}

export interface CompiledClause {
  column: string;
  operator: FilterOperator;
  value?: unknown;
}

export function normalizeFilterOperator(
  operator: FilterOperator
): FilterOperator {
  if (operator === "is") return "eq";
  if (operator === "is_not") return "neq";
  if (operator === "is_any_of") return "in";
  if (operator === "is_none_of") return "not_in";
  return operator;
}

function compileLeaf(leaf: LeafFilter): CompiledClause {
  return {
    column: FILTER_FIELD_MAP.get(leaf.field)!.column,
    operator: normalizeFilterOperator(leaf.operator as FilterOperator),
    value: leaf.value,
  };
}

export function compileFilters(filters: AppliedFilter[]): {
  and: CompiledClause[];
  orGroups: CompiledClause[][];
} {
  const and: CompiledClause[] = [];
  const orGroups: CompiledClause[][] = [];

  for (const item of filters) {
    if ("or" in item) {
      orGroups.push(item.or.map(compileLeaf));
    } else {
      and.push(compileLeaf(item));
    }
  }

  return { and, orGroups };
}

export function getFilterMetadata() {
  return {
    fields: SHIPROCKET_FILTER_FIELDS.map(({ key, label, type, operators, group }) => ({
      key,
      label,
      type,
      operators,
      group,
    })),
    groups: [
      "Identifiers",
      "Status",
      "Logistics",
      "Scan / Tracking",
      "Customer / Shopify",
      "Payment / Order",
      "Remittance / Settlement",
      "Sync / Data Quality",
    ],
  };
}

export const GLOBAL_SEARCH_COLUMNS = [
  "sr_order_id",
  "order_id",
  "order_id_shopify_format",
  "awb",
  "return_awb_code",
  "shipment_id",
  "customer_name_shopify",
  "customer_email",
  "customer_phone_shopify",
  "courier_name",
  "latest_crf_id",
  "latest_utr",
] as const;
