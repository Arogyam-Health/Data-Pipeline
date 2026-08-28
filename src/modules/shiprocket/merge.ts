import type { ShiprocketOrderRow } from "./types";

const WEBHOOK_OWNED_KEYS = [
  "shipment_status_id",
  "shipment_status",
  "current_status_id",
  "current_status",
  "current_ts",
  "courier_name",
  "awb",
  "channel_id",
  "etd",
  "delivered_date",
  "return_awb_code",
  "awb_assigned_date",
  "pickup_scheduled_date",
  "pickup_exception_reason",
  "undelivered_reason",
  "undelivered_reason_code",
  "pick_exception_reason_code",
  "delivery_attempt_count",
  "pickup_attempt_count",
  "qc_image",
  "qc_failure_reason",
  "pod_status",
  "pod",
  "shipping_method",
  "scans1_status",
  "scans1_sr_status_label",
  "scans1_sr_status",
  "scans1_location",
  "scans1_date",
  "scans1_activity",
  "scans0_status",
  "scans0_sr_status_label",
  "scans0_sr_status",
  "scans0_location",
  "scans0_date",
  "scans0_activity",
  "scan_status",
  "scan_sr_status_label",
  "scan_sr_status",
  "scan_location",
  "scan_date",
  "scan_activity",
  "source_date",
] as const;

const DETAIL_KEYS = [
  "order_id",
  "order_status",
  "order_status_code",
  "payment_status",
  "payment_method",
  "shipment_id",
  "tracking_url",
  "order_date",
  "created_at_sr",
  "customer_name",
  "customer_email",
  "customer_phone",
  "pickup_location",
  "order_total",
  "tax",
  "products",
  "billing_name",
  "billing_email",
  "billing_phone",
] as const;

export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

export function parseShiprocketTimestamp(value: unknown): number | null {
  if (isBlank(value)) return null;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Older incoming current_timestamp must not regress current shipment state.
 */
export function isStaleWebhook(
  incomingCurrentTs: unknown,
  existingCurrentTs: unknown
): boolean {
  const incoming = parseShiprocketTimestamp(incomingCurrentTs);
  const existing = parseShiprocketTimestamp(existingCurrentTs);
  if (incoming === null || existing === null) return false;
  return incoming < existing;
}

function mergeText<T>(existing: T, incoming: T): T {
  return isBlank(incoming) ? existing : incoming;
}

/**
 * Source-aware merge: blank incoming webhook values never wipe richer
 * API / earlier webhook / Shopify-adjacent detail fields.
 */
export function mergeShiprocketOrderRow(
  existing: Partial<ShiprocketOrderRow> | null,
  incoming: ShiprocketOrderRow,
  options?: { staleCurrentState?: boolean }
): ShiprocketOrderRow {
  if (!existing) return incoming;

  const stale = options?.staleCurrentState === true;
  const merged: ShiprocketOrderRow = { ...existing, ...incoming };
  const existingRec = existing as unknown as Record<string, unknown>;
  const incomingRec = incoming as unknown as Record<string, unknown>;
  const mergedRec = merged as unknown as Record<string, unknown>;

  merged.sr_order_id = incoming.sr_order_id || existing.sr_order_id || incoming.sr_order_id;

  for (const key of WEBHOOK_OWNED_KEYS) {
    if (stale) {
      mergedRec[key] = existingRec[key] ?? incomingRec[key];
    } else {
      mergedRec[key] = mergeText(existingRec[key], incomingRec[key]);
    }
  }

  for (const key of DETAIL_KEYS) {
    mergedRec[key] = mergeText(existingRec[key], incomingRec[key]);
  }

  if (incoming.is_return === null || incoming.is_return === undefined) {
    merged.is_return = existing.is_return ?? false;
  } else {
    merged.is_return = incoming.is_return;
  }

  if (stale) {
    merged.current_status = existing.current_status ?? incoming.current_status;
    merged.current_status_id = existing.current_status_id ?? incoming.current_status_id;
    merged.current_ts = existing.current_ts ?? incoming.current_ts;
    merged.shipment_status = existing.shipment_status ?? incoming.shipment_status;
    merged.shipment_status_id = existing.shipment_status_id ?? incoming.shipment_status_id;
  }

  return merged;
}
