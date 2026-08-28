import type { ShiprocketExplorerRow } from "./types";

export const LEGACY_PABBLY_HEADERS = [
  "Shiprocket Unique Key",
  "Sr Order Id",
  "Shipment Status Id",
  "Shipment Status",
  "Scans 1 Status",
  "Scans 1 Sr-status-label",
  "Scans 1 Sr-status",
  "Scans 1 Location",
  "Scans 1 Date",
  "Scans 1 Activity",
  "Scans 0 Status",
  "Scans 0 Sr-status-label",
  "Scans 0 Sr-status",
  "Scans 0 Location",
  "Scans 0 Date",
  "Scans 0 Activity",
  "Order Id",
  "Is Return",
  "Etd",
  "Current Timestamp",
  "Current Status Id",
  "Current Status",
  "Courier Name",
  "Channel Id",
  "Awb",
  "Order Date",
  "Created At",
  "Customer Name",
  "Customer Email",
  "Customer Phone",
  "Pickup Location",
  "Payment Status",
  "Payment Method",
  "Order Total",
  "Tax",
  "Order Status",
  "Order Status Code",
  "Shipment ID",
  "Tracking URL",
  "Delivered Date",
  "Products",
  "Last Local API Sync At",
  "Last Webhook Sync At",
  "Coach",
  "order id shopify format",
  ...Array.from({ length: 21 }, (_, i) => `Column ${47 + i}`),
] as const;

export interface LegacyPabblyTrace {
  sheetAction?: string;
  sheetRowNumber?: number | string;
  sheetError?: string;
  eventId?: string;
}

export interface LegacyOrderSource {
  unique_key?: string | null;
  sr_order_id?: string | null;
  shipment_status_id?: string | null;
  shipment_status?: string | null;
  scans1_status?: string | null;
  scans1_sr_status_label?: string | null;
  scans1_sr_status?: string | null;
  scans1_location?: string | null;
  scans1_date?: string | null;
  scans1_activity?: string | null;
  scans0_status?: string | null;
  scans0_sr_status_label?: string | null;
  scans0_sr_status?: string | null;
  scans0_location?: string | null;
  scans0_date?: string | null;
  scans0_activity?: string | null;
  order_id?: string | null;
  is_return?: boolean | null;
  etd?: string | null;
  current_ts?: string | null;
  current_status_id?: string | null;
  current_status?: string | null;
  courier_name?: string | null;
  channel_id?: string | null;
  awb?: string | null;
  order_date?: string | null;
  created_at_sr?: string | null;
  customer_email?: string | null;
  pickup_location?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  order_total?: string | null;
  tax?: string | null;
  order_status?: string | null;
  order_status_code?: string | null;
  shipment_id?: string | null;
  tracking_url?: string | null;
  delivered_date?: string | null;
  products?: string | null;
  last_local_api_sync_at?: string | null;
  last_webhook_sync_at?: string | null;
  customer_name_shopify?: string | null;
  customer_phone_shopify?: string | null;
  coach?: string | null;
  order_id_shopify_format?: string | null;
}

function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Builds the production Pabbly payload from the compatibility projection.
 * Does NOT include "Raw Shiprocket JSON".
 * Customer Name / Phone / Coach / order id shopify format are Shopify-derived.
 */
export function buildLegacyPabblyPayload(
  row: LegacyOrderSource,
  trace: LegacyPabblyTrace = {}
): Record<string, string> {
  const payload: Record<string, string> = {
    "Shiprocket Unique Key": cell(
      row.unique_key || (row.sr_order_id ? `shiprocket_order:${row.sr_order_id}` : "")
    ),
    "Sr Order Id": cell(row.sr_order_id),
    "Shipment Status Id": cell(row.shipment_status_id),
    "Shipment Status": cell(row.shipment_status),
    "Scans 1 Status": cell(row.scans1_status),
    "Scans 1 Sr-status-label": cell(row.scans1_sr_status_label),
    "Scans 1 Sr-status": cell(row.scans1_sr_status),
    "Scans 1 Location": cell(row.scans1_location),
    "Scans 1 Date": cell(row.scans1_date),
    "Scans 1 Activity": cell(row.scans1_activity),
    "Scans 0 Status": cell(row.scans0_status),
    "Scans 0 Sr-status-label": cell(row.scans0_sr_status_label),
    "Scans 0 Sr-status": cell(row.scans0_sr_status),
    "Scans 0 Location": cell(row.scans0_location),
    "Scans 0 Date": cell(row.scans0_date),
    "Scans 0 Activity": cell(row.scans0_activity),
    "Order Id": cell(row.order_id),
    "Is Return": cell(row.is_return),
    Etd: cell(row.etd),
    "Current Timestamp": cell(row.current_ts),
    "Current Status Id": cell(row.current_status_id),
    "Current Status": cell(row.current_status),
    "Courier Name": cell(row.courier_name),
    "Channel Id": cell(row.channel_id),
    Awb: cell(row.awb),
    "Order Date": cell(row.order_date),
    "Created At": cell(row.created_at_sr),
    "Customer Name": cell(row.customer_name_shopify),
    "Customer Email": cell(row.customer_email),
    "Customer Phone": cell(row.customer_phone_shopify),
    "Pickup Location": cell(row.pickup_location),
    "Payment Status": cell(row.payment_status),
    "Payment Method": cell(row.payment_method),
    "Order Total": cell(row.order_total),
    Tax: cell(row.tax),
    "Order Status": cell(row.order_status),
    "Order Status Code": cell(row.order_status_code),
    "Shipment ID": cell(row.shipment_id),
    "Tracking URL": cell(row.tracking_url),
    "Delivered Date": cell(row.delivered_date),
    Products: cell(row.products),
    "Last Local API Sync At": cell(row.last_local_api_sync_at),
    "Last Webhook Sync At": cell(row.last_webhook_sync_at),
    Coach: cell(row.coach),
    "order id shopify format": cell(row.order_id_shopify_format),
  };

  for (let i = 47; i <= 67; i += 1) {
    payload[`Column ${i}`] = "";
  }

  payload["Sheet Action"] = cell(trace.sheetAction);
  payload["Sheet Row Number"] = cell(trace.sheetRowNumber);
  payload["Sheet Error"] = cell(trace.sheetError);
  payload["Webhook Event Id"] = cell(trace.eventId);
  payload["Pabbly Idempotency Key"] = cell(trace.eventId);

  return payload;
}

export function explorerToLegacySource(row: ShiprocketExplorerRow): LegacyOrderSource {
  return row;
}
