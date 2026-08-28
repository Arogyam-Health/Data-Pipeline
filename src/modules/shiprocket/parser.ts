import type {
  ShiprocketWebhookPayload,
  ShiprocketExtractedFields,
  ShiprocketOrderRow,
} from "./types";

// ============================================================
// Ported from Apps Script pick_ / pickRaw_ / getScan_ / getWebhookData_
// with exact field-name alternates preserved.
// ============================================================

/**
 * Port of Apps Script normalizeKey_ — lowercase + strip non-alphanumeric.
 */
function normalizeKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Port of Apps Script flattenObject_ — recursive flatten with dot notation.
 */
function flattenObject(
  value: unknown,
  prefix = "",
  result: Record<string, unknown> = {}
): Record<string, unknown> {
  if (value === null || value === undefined) {
    if (prefix) result[prefix] = "";
    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenObject(item, prefix ? `${prefix}.${index}` : String(index), result);
    });
    return result;
  }

  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      flattenObject(
        (value as Record<string, unknown>)[key],
        prefix ? `${prefix}.${key}` : key,
        result
      );
    }
    return result;
  }

  if (prefix) result[prefix] = value;
  return result;
}

/**
 * Port of Apps Script pickRaw_ — tries each key directly, then falls back
 * to flattened+normalized key matching.
 */
function pickRaw(
  object: Record<string, unknown> | null | undefined,
  keys: string[]
): unknown {
  if (!object || typeof object !== "object") return "";

  // Direct key lookup
  for (const key of keys) {
    if (
      object[key] !== undefined &&
      object[key] !== null &&
      object[key] !== ""
    ) {
      return object[key];
    }
  }

  // Flatten + normalized fallback
  const flat = flattenObject(object);
  const flatKeys = Object.keys(flat);

  for (const target of keys) {
    const normalizedTarget = normalizeKey(target);

    for (const flatKey of flatKeys) {
      const normalizedFlat = normalizeKey(flatKey);
      const lastPart = normalizeKey(
        String(flatKey).split(".").pop() || ""
      );

      if (normalizedFlat === normalizedTarget || lastPart === normalizedTarget) {
        const value = flat[flatKey];
        if (value !== undefined && value !== null && value !== "") {
          return value;
        }
      }
    }
  }

  return "";
}

/**
 * Port of Apps Script pick_ — returns stringified value or empty string.
 * Objects are JSON.stringify'd, not returned as null.
 */
function pick(
  object: Record<string, unknown> | null | undefined,
  keys: string[]
): string {
  const value = pickRaw(object, keys);

  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

/**
 * Port of Apps Script firstNonEmpty — returns first non-empty argument.
 */
function firstNonEmpty(
  ...candidates: (string | null | undefined | unknown)[]
): string {
  for (const value of candidates) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return String(value).trim();
    }
  }
  return "";
}

/**
 * Port of Apps Script getScan_ — tries multiple array key names.
 */
function getScan(
  data: Record<string, unknown>,
  index: number
): Record<string, unknown> {
  const scans =
    data.scans ||
    data.scan ||
    data.activities ||
    data.shipment_track_activities;

  if (Array.isArray(scans) && scans[index]) {
    return scans[index] as Record<string, unknown>;
  }

  if (
    !Array.isArray(scans) &&
    typeof scans === "object" &&
    scans !== null &&
    index === 0
  ) {
    return scans as Record<string, unknown>;
  }

  return {};
}

/**
 * Port of Apps Script pickScan_ — tries each key on a scan object.
 */
function pickScan(
  scan: Record<string, unknown>,
  keys: string[]
): string {
  if (!scan || typeof scan !== "object") return "";

  for (const key of keys) {
    if (scan[key] !== undefined && scan[key] !== null && scan[key] !== "") {
      return String(scan[key]);
    }
  }

  return "";
}

/**
 * Port of Apps Script isDeliveredText_.
 */
function isDeliveredText(value: unknown): boolean {
  return String(value || "").trim().toUpperCase() === "DELIVERED";
}

/**
 * Port of Apps Script stringifyIfObject_.
 */
function stringifyIfObject(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ============================================================
// Field name alternates — exact match from Apps Script
// ============================================================

const SR_ORDER_ID_KEYS = [
  "Sr Order Id",
  "sr_order_id",
  "srOrderId",
  "shiprocket_order_id",
  "shiprocketOrderId",
  "id",
];

const ORDER_ID_KEYS = [
  "Order Id",
  "order_id",
  "channel_order_id",
  "channelOrderId",
  "channel_order",
  "order_number",
  "external_order_id",
];

const SHIPMENT_STATUS_KEYS = [
  "Shipment Status",
  "shipment_status",
  "shipmentStatus",
  "current_status",
  "Current Status",
  "status",
];

const CURRENT_STATUS_KEYS = [
  "Current Status",
  "current_status",
  "Shipment Status",
  "shipment_status",
  "status",
];

const SHIPMENT_STATUS_ID_KEYS = [
  "Shipment Status Id",
  "shipment_status_id",
  "shipmentStatusId",
  "current_status_id",
  "Current Status Id",
  "status_id",
  "status_code",
];

const CURRENT_STATUS_ID_KEYS = [
  "Current Status Id",
  "current_status_id",
  "Shipment Status Id",
  "shipment_status_id",
  "status_id",
  "status_code",
];

const CURRENT_TIMESTAMP_KEYS = [
  "Current Timestamp",
  "current_timestamp",
  "currentTimestamp",
  "updated_at",
  "event_time",
  "status_date_time",
  "current_status_time",
];

const AWB_KEYS = [
  "Awb",
  "awb",
  "awb_code",
  "awbCode",
  "awb_number",
  "tracking_number",
];

const SHIPMENT_ID_KEYS = [
  "Shipment ID",
  "Shipment Id",
  "shipment_id",
  "shipmentId",
  "shiprocket_shipment_id",
];

const COURIER_NAME_KEYS = [
  "Courier Name",
  "courier_name",
  "courier",
  "courier_company_name",
];

const CHANNEL_ID_KEYS = ["Channel Id", "channel_id", "channelId", "channel"];

const ORDER_DATE_KEYS = [
  "Order Date",
  "order_date",
  "channel_created_at",
  "created_at",
];

const CREATED_AT_KEYS = ["Created At", "created_at", "created_on"];

const CUSTOMER_NAME_KEYS = [
  "Customer Name",
  "customer_name",
  "billing_name",
  "consignee_name",
  "buyer_name",
];

const CUSTOMER_EMAIL_KEYS = [
  "Customer Email",
  "customer_email",
  "billing_email",
  "email",
];

const CUSTOMER_PHONE_KEYS = [
  "Customer Phone",
  "customer_phone",
  "billing_phone",
  "phone",
  "mobile",
  "customer_mobile",
];

const PAYMENT_STATUS_KEYS = ["Payment Status", "payment_status"];

const PAYMENT_METHOD_KEYS = [
  "Payment Method",
  "payment_method",
  "payment_mode",
];

const ORDER_TOTAL_KEYS = [
  "Order Total",
  "total",
  "total_amount",
  "amount",
  "order_total",
];

const TAX_KEYS = ["Tax", "tax"];

const ORDER_STATUS_KEYS = ["Order Status", "order_status", "status"];

const ORDER_STATUS_CODE_KEYS = [
  "Order Status Code",
  "order_status_code",
  "status_code",
];

const TRACKING_URL_KEYS = [
  "Tracking URL",
  "tracking_url",
  "track_url",
  "tracking_link",
];

const DELIVERED_DATE_KEYS = ["Delivered Date", "delivered_date", "delivery_date"];

const PRODUCTS_KEYS = ["Products", "products", "items", "line_items", "order_items"];

const IS_RETURN_KEYS = [
  "Is Return",
  "is_return",
  "isReturn",
  "return_order",
  "is_reverse",
];

const ETD_KEYS = ["Etd", "etd", "edd", "expected_delivery_date"];

const PICKUP_LOCATION_KEYS = ["Pickup Location", "pickup_location"];

const UNIQUE_KEY_KEYS = ["Shiprocket Unique Key", "shiprocket_unique_key"];

// ============================================================
// Main extraction — port of extractWebhookFields_
// ============================================================

/**
 * Extract Shiprocket webhook fields from payload.
 * Supports both payload.data and root-level formats.
 * Uses exact Apps Script field-name alternates.
 */
function parseIsReturn(raw: string): boolean | null {
  if (!raw || raw.trim() === "") return null;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function extractScan(scan: Record<string, unknown>): ShiprocketExtractedFields["scans"][number] {
  return {
    status: pickScan(scan, ["status"]),
    sr_status_label: pickScan(scan, [
      "sr-status-label",
      "sr_status_label",
      "srStatusLabel",
      "status_label",
    ]),
    sr_status: pickScan(scan, ["sr-status", "sr_status", "srStatus", "status_code"]),
    location: pickScan(scan, ["location", "scan_location", "current_location"]),
    date: pickScan(scan, [
      "date",
      "scan_date",
      "status_date",
      "created_at",
      "updated_at",
    ]),
    activity: pickScan(scan, ["activity", "description", "remarks", "message"]),
    latitude: pickScan(scan, ["latitude", "lat"]),
    longitude: pickScan(scan, ["longitude", "lng", "lon"]),
  };
}

function getAllScans(data: Record<string, unknown>): ShiprocketExtractedFields["scans"] {
  const scans =
    data.scans ||
    data.scan ||
    data.activities ||
    data.shipment_track_activities;

  if (Array.isArray(scans)) {
    return scans.map((item) =>
      extractScan(
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {}
      )
    );
  }

  if (scans && typeof scans === "object") {
    return [extractScan(scans as Record<string, unknown>)];
  }

  return [];
}

export function extractWebhookFields(
  payload: ShiprocketWebhookPayload
): ShiprocketExtractedFields {
  // Port of getWebhookData_
  let data: Record<string, unknown>;
  if (
    payload.data &&
    typeof payload.data === "object" &&
    !Array.isArray(payload.data)
  ) {
    data = payload.data as Record<string, unknown>;
  } else {
    data = (payload || {}) as Record<string, unknown>;
  }

  const fullPayload = payload as Record<string, unknown>;

  // Scans — port of getScan_ behavior for legacy columns; keep full history separately
  const scan0 = getScan(data, 0); // "Scans 0" — oldest / second most recent
  const scan1 = getScan(data, 1); // "Scans 1" — most recent
  const allScans = getAllScans(data);

  // sr_order_id
  const srOrderId = pick(data, SR_ORDER_ID_KEYS);

  // order_id
  const orderId = pick(data, ORDER_ID_KEYS);

  // Status fields
  const shipmentStatus = pick(data, SHIPMENT_STATUS_KEYS);
  const currentStatus = pick(data, CURRENT_STATUS_KEYS);
  const shipmentStatusId = pick(data, SHIPMENT_STATUS_ID_KEYS);
  const currentStatusId = pick(data, CURRENT_STATUS_ID_KEYS);
  const currentTimestamp = pick(data, CURRENT_TIMESTAMP_KEYS);

  // Shipment details
  const awb = pick(data, AWB_KEYS);
  const shipmentId = pick(data, SHIPMENT_ID_KEYS);

  // Delivered date — auto-set for delivered orders (Apps Script behavior)
  const deliveredDate =
    isDeliveredText(shipmentStatus) || isDeliveredText(currentStatus)
      ? firstNonEmpty(
          pick(data, DELIVERED_DATE_KEYS),
          currentTimestamp,
          new Date().toISOString()
        )
      : pick(data, DELIVERED_DATE_KEYS);

  return {
    sr_order_id: srOrderId || null,
    order_id: orderId || null,
    shipment_status_id: shipmentStatusId || null,
    shipment_status: shipmentStatus || null,
    current_status_id: currentStatusId || null,
    current_status: currentStatus || null,
    order_status: pick(data, ORDER_STATUS_KEYS) || null,
    order_status_code: pick(data, ORDER_STATUS_CODE_KEYS) || null,
    payment_status: pick(data, PAYMENT_STATUS_KEYS) || null,
    payment_method: pick(data, PAYMENT_METHOD_KEYS) || null,
    courier_name: pick(data, COURIER_NAME_KEYS) || null,
    awb: awb || null,
    channel_id: pick(data, CHANNEL_ID_KEYS) || null,
    shipment_id: shipmentId || null,
    tracking_url: pick(data, TRACKING_URL_KEYS) || null,
    is_return: parseIsReturn(pick(data, IS_RETURN_KEYS)),
    etd: pick(data, ETD_KEYS) || null,
    order_date: pick(data, ORDER_DATE_KEYS) || null,
    created_at_sr: pick(data, CREATED_AT_KEYS) || null,
    customer_name: pick(data, CUSTOMER_NAME_KEYS) || null,
    customer_email: pick(data, CUSTOMER_EMAIL_KEYS) || null,
    customer_phone: pick(data, CUSTOMER_PHONE_KEYS) || null,
    pickup_location: pick(data, PICKUP_LOCATION_KEYS) || null,
    order_total: pick(data, ORDER_TOTAL_KEYS) || null,
    tax: pick(data, TAX_KEYS) || null,
    products: stringifyIfObject(pickRaw(data, PRODUCTS_KEYS)) || null,
    delivered_date: deliveredDate || null,
    scans: [extractScan(scan0), extractScan(scan1)],
    all_scans: allScans,

    return_awb_code:
      pick(data, ["return_awb_code", "returnAwbCode", "return_awb"]) || null,
    awb_assigned_date:
      pick(data, ["awb_assigned_date", "awbAssignedDate"]) || null,
    pickup_scheduled_date:
      pick(data, ["pickup_scheduled_date", "pickupScheduledDate"]) || null,
    pickup_exception_reason:
      pick(data, ["pickup_exception_reason", "pickupExceptionReason"]) || null,
    undelivered_reason:
      pick(data, ["undelivered_reason", "undeliveredReason"]) || null,
    undelivered_reason_code:
      pick(data, ["undelivered_reason_code", "undeliveredReasonCode"]) || null,
    pick_exception_reason_code:
      pick(data, [
        "pick_exception_reason_code",
        "pickup_exception_reason_code",
        "pickExceptionReasonCode",
      ]) || null,
    delivery_attempt_count:
      pick(data, ["delivery_attempt_count", "deliveryAttemptCount"]) || null,
    pickup_attempt_count:
      pick(data, ["pickup_attempt_count", "pickupAttemptCount"]) || null,
    qc_image: pick(data, ["qc_image", "qcImage"]) || null,
    qc_failure_reason:
      pick(data, ["qc_failure_reason", "qcFailureReason"]) || null,
    pod_status: pick(data, ["pod_status", "podStatus"]) || null,
    pod: pick(data, ["pod"]) || null,
    shipping_method:
      pick(data, ["shipping_method", "shippingMethod"]) || null,
    billing_name: pick(data, ["billing_name", "billingName"]) || null,
    billing_email: pick(data, ["billing_email", "billingEmail"]) || null,
    billing_phone: pick(data, ["billing_phone", "billingPhone"]) || null,
    source_date: pick(data, ["date", "Date"]) || null,

    // Extra fields for Pabbly / tracking
    unique_key: firstNonEmpty(
      pick(data, UNIQUE_KEY_KEYS),
      srOrderId ? `shiprocket_order:${srOrderId}` : ""
    ),
    current_ts: currentTimestamp || null,
    raw_json: JSON.stringify(fullPayload),
  };
}

/**
 * Convert extracted fields to a database row for upsert.
 * scan[0] = "Scans 0" (older), scan[1] = "Scans 1" (newer).
 * In the DB: scans1_* = scan[1] (newer), scans0_* = scan[0] (older).
 */
export function toOrderRow(
  fields: ShiprocketExtractedFields,
  _rawPayload: Record<string, unknown>,
  _integrationEventId: string
): ShiprocketOrderRow {
  const scan0 = fields.scans[0] ?? null; // "Scans 0" (older)
  const scan1 = fields.scans[1] ?? null; // "Scans 1" (newer)
  const latestScan = fields.scans[1] ?? fields.scans[0] ?? null; // newest scan for "current" fields

  return {
    sr_order_id: fields.sr_order_id ?? "UNKNOWN",
    shipment_status_id: fields.shipment_status_id,
    shipment_status: fields.shipment_status,
    current_status_id: fields.current_status_id,
    current_status: fields.current_status,
    order_status: fields.order_status,
    order_status_code: fields.order_status_code,
    payment_status: fields.payment_status,
    payment_method: fields.payment_method,
    courier_name: fields.courier_name,
    awb: fields.awb,
    channel_id: fields.channel_id,
    shipment_id: fields.shipment_id,
    tracking_url: fields.tracking_url,
    is_return: fields.is_return,
    etd: fields.etd,
    order_date: fields.order_date,
    created_at_sr: fields.created_at_sr,
    customer_name: fields.customer_name,
    customer_email: fields.customer_email,
    customer_phone: fields.customer_phone,
    pickup_location: fields.pickup_location,
    order_total: fields.order_total,
    tax: fields.tax,
    products: fields.products,
    delivered_date: fields.delivered_date,
    // "Scans 1" = scan1 (newer) — matches Apps Script sheet column naming
    scans1_status: scan1?.status ?? null,
    scans1_sr_status_label: scan1?.sr_status_label ?? null,
    scans1_sr_status: scan1?.sr_status ?? null,
    scans1_location: scan1?.location ?? null,
    scans1_date: scan1?.date ?? null,
    scans1_activity: scan1?.activity ?? null,
    // "Scans 0" = scan0 (older)
    scans0_status: scan0?.status ?? null,
    scans0_sr_status_label: scan0?.sr_status_label ?? null,
    scans0_sr_status: scan0?.sr_status ?? null,
    scans0_location: scan0?.location ?? null,
    scans0_date: scan0?.date ?? null,
    scans0_activity: scan0?.activity ?? null,
    // "Current" fields — use latest scan
    scan_status: latestScan?.status ?? null,
    scan_sr_status_label: latestScan?.sr_status_label ?? null,
    scan_sr_status: latestScan?.sr_status ?? null,
    scan_location: latestScan?.location ?? null,
    scan_date: latestScan?.date ?? null,
    scan_activity: latestScan?.activity ?? null,
    return_awb_code: fields.return_awb_code,
    awb_assigned_date: fields.awb_assigned_date,
    pickup_scheduled_date: fields.pickup_scheduled_date,
    pickup_exception_reason: fields.pickup_exception_reason,
    undelivered_reason: fields.undelivered_reason,
    undelivered_reason_code: fields.undelivered_reason_code,
    pick_exception_reason_code: fields.pick_exception_reason_code,
    delivery_attempt_count: fields.delivery_attempt_count,
    pickup_attempt_count: fields.pickup_attempt_count,
    qc_image: fields.qc_image,
    qc_failure_reason: fields.qc_failure_reason,
    pod_status: fields.pod_status,
    pod: fields.pod,
    shipping_method: fields.shipping_method,
    current_ts: fields.current_ts,
    billing_name: fields.billing_name,
    billing_email: fields.billing_email,
    billing_phone: fields.billing_phone,
    source_date: fields.source_date,
  };
}
