/**
 * Shiprocket webhook payload types.
 * Based on observed Shiprocket webhook structures and Apps Script field mappings.
 */

export interface ShiprocketWebhookPayload {
  data?: ShiprocketOrderData;
  [key: string]: unknown;
}

export interface ShiprocketOrderData {
  [key: string]: unknown;
}

/** Normalized fields extracted from Shiprocket webhook. */
export interface ShiprocketExtractedFields {
  sr_order_id: string | null;
  order_id: string | null;
  shipment_status_id: string | null;
  shipment_status: string | null;
  current_status_id: string | null;
  current_status: string | null;
  order_status: string | null;
  order_status_code: string | null;
  payment_status: string | null;
  payment_method: string | null;
  courier_name: string | null;
  awb: string | null;
  channel_id: string | null;
  shipment_id: string | null;
  tracking_url: string | null;
  is_return: boolean;
  etd: string | null;
  order_date: string | null;
  created_at_sr: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  pickup_location: string | null;
  order_total: string | null;
  tax: string | null;
  products: string | null;
  delivered_date: string | null;
  scans: ShiprocketScan[];

  // Extra fields (not in DB, used for Pabbly/tracking)
  unique_key: string | null;
  current_ts: string | null;
  raw_json: string | null;
}

export interface ShiprocketScan {
  status: string | null;
  sr_status_label: string | null;
  sr_status: string | null;
  location: string | null;
  date: string | null;
  activity: string | null;
}

/** Row shape for database upsert. */
export interface ShiprocketOrderRow {
  sr_order_id: string;
  shipment_status_id: string | null;
  shipment_status: string | null;
  current_status_id: string | null;
  current_status: string | null;
  order_status: string | null;
  order_status_code: string | null;
  payment_status: string | null;
  payment_method: string | null;
  courier_name: string | null;
  awb: string | null;
  channel_id: string | null;
  shipment_id: string | null;
  tracking_url: string | null;
  is_return: boolean;
  etd: string | null;
  order_date: string | null;
  created_at_sr: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  pickup_location: string | null;
  order_total: string | null;
  tax: string | null;
  products: string | null;
  delivered_date: string | null;
  scan_status: string | null;
  scan_sr_status_label: string | null;
  scan_sr_status: string | null;
  scan_location: string | null;
  scan_date: string | null;
  scan_activity: string | null;
  scans1_status: string | null;
  scans1_sr_status_label: string | null;
  scans1_sr_status: string | null;
  scans1_location: string | null;
  scans1_date: string | null;
  scans1_activity: string | null;
  scans0_status: string | null;
  scans0_sr_status_label: string | null;
  scans0_sr_status: string | null;
  scans0_location: string | null;
  scans0_date: string | null;
  scans0_activity: string | null;
}
