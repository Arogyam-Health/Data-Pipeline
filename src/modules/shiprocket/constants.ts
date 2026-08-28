/** Field name constants for Shiprocket webhook extraction. */

/** Legacy Sheet Coach formula: non-empty Order Id → this value. Change here only. */
export const DEFAULT_COACH = "Misba";

/** Exact 8-digit extraction used by the Sheet REGEXEXTRACT(..., "\\d{8}"). */
export const SHOPIFY_ORDER_ID_REGEX = /\d{8}/;

/** Top-level keys to look for the order data object. */
export const DATA_KEYS = ["data", "order", "shipment", "root"] as const;

/** Alternate field names for sr_order_id (business key). */
export const SR_ORDER_ID_KEYS = [
  "sr_order_id",
  "srOrderId",
  "shiprocket_order_id",
  "shiprocketOrderId",
  "unique_key",
  "shiprocket_unique_key",
] as const;

/** Alternate field names for order_id. */
export const ORDER_ID_KEYS = [
  "order_id",
  "orderId",
  "id",
  "customer_order_id",
] as const;

/** Status fields with alternate names. */
export const STATUS_FIELDS: Record<string, readonly string[]> = {
  shipment_status_id: ["shipment_status_id", "shipmentStatusId"],
  shipment_status: ["shipment_status", "shipmentStatus", "status"],
  current_status_id: ["current_status_id", "currentStatusId"],
  current_status: ["current_status", "currentStatus"],
  order_status: ["order_status", "orderStatus"],
  order_status_code: ["order_status_code", "orderStatusCode"],
  payment_status: ["payment_status", "paymentStatus"],
} as const;

/** Shipment detail fields. */
export const SHIPMENT_FIELDS: Record<string, readonly string[]> = {
  courier_name: ["courier_name", "courierName", "courier"],
  awb: ["awb", "awb_number", "awbNumber", "awb_no"],
  channel_id: ["channel_id", "channelId"],
  shipment_id: ["shipment_id", "shipmentId"],
  tracking_url: ["tracking_url", "trackingUrl"],
  is_return: ["is_return", "isReturn", "return"],
  etd: ["etd", "expected_delivery_date", "etd_date"],
  order_date: ["order_date", "orderDate"],
  created_at_sr: ["created_at", "createdAt", "order_created_at"],
  customer_name: ["customer_name", "customerName", "name"],
  customer_email: ["customer_email", "customerEmail", "email"],
  customer_phone: [
    "customer_phone",
    "customerPhone",
    "phone",
    "mobile",
    "mobile_number",
  ],
  pickup_location: ["pickup_location", "pickupLocation"],
  payment_method: ["payment_method", "paymentMethod"],
  order_total: ["order_total", "orderTotal", "total"],
  tax: ["tax", "tax_amount", "taxAmount"],
  products: ["products", "product_name", "items"],
  delivered_date: ["delivered_date", "deliveredDate"],
} as const;

/** Scan fields prefix patterns. Scans are typically in an array. */
export const SCANS_KEY = ["scans", "scan", "shipment_scans"] as const;
