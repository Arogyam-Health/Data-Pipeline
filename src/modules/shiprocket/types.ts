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
  /** null when the webhook omitted Is Return — do not treat as false. */
  is_return: boolean | null;
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
  all_scans: ShiprocketScan[];

  unique_key: string | null;
  current_ts: string | null;
  raw_json: string | null;

  return_awb_code: string | null;
  awb_assigned_date: string | null;
  pickup_scheduled_date: string | null;
  pickup_exception_reason: string | null;
  undelivered_reason: string | null;
  undelivered_reason_code: string | null;
  pick_exception_reason_code: string | null;
  delivery_attempt_count: string | null;
  pickup_attempt_count: string | null;
  qc_image: string | null;
  qc_failure_reason: string | null;
  pod_status: string | null;
  pod: string | null;
  shipping_method: string | null;
  billing_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  source_date: string | null;
}

export interface ShiprocketScan {
  status: string | null;
  sr_status_label: string | null;
  sr_status: string | null;
  location: string | null;
  date: string | null;
  activity: string | null;
  latitude: string | null;
  longitude: string | null;
}

/** Row shape for database upsert. */
export interface ShiprocketOrderRow {
  sr_order_id: string;
  order_id: string | null;
  shipment_status_id: string | null;
  shipment_status: string | null;
  current_status_id: string | null;
  current_status: string | null;
  current_ts?: string | null;
  order_status: string | null;
  order_status_code: string | null;
  payment_status: string | null;
  payment_method: string | null;
  courier_name: string | null;
  awb: string | null;
  channel_id: string | null;
  shipment_id: string | null;
  tracking_url: string | null;
  is_return: boolean | null;
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
  return_awb_code?: string | null;
  awb_assigned_date?: string | null;
  pickup_scheduled_date?: string | null;
  pickup_exception_reason?: string | null;
  undelivered_reason?: string | null;
  undelivered_reason_code?: string | null;
  pick_exception_reason_code?: string | null;
  delivery_attempt_count?: string | null;
  pickup_attempt_count?: string | null;
  qc_image?: string | null;
  qc_failure_reason?: string | null;
  pod_status?: string | null;
  pod?: string | null;
  shipping_method?: string | null;
  last_local_api_sync_at?: string | null;
  billing_name?: string | null;
  billing_email?: string | null;
  billing_phone?: string | null;
  source_date?: string | null;
}

export interface ShiprocketExplorerRow {
  sr_order_id: string;
  unique_key: string | null;
  shipment_status_id: string | null;
  shipment_status: string | null;
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
  order_id: string | null;
  is_return: boolean | null;
  etd: string | null;
  current_ts: string | null;
  current_status_id: string | null;
  current_status: string | null;
  courier_name: string | null;
  channel_id: string | null;
  awb: string | null;
  order_date: string | null;
  created_at_sr: string | null;
  shiprocket_customer_name?: string | null;
  customer_email: string | null;
  shiprocket_customer_phone?: string | null;
  pickup_location: string | null;
  payment_status: string | null;
  payment_method: string | null;
  order_total: string | null;
  tax: string | null;
  order_status: string | null;
  order_status_code: string | null;
  shipment_id: string | null;
  tracking_url: string | null;
  delivered_date: string | null;
  products: string | null;
  last_local_api_sync_at: string | null;
  last_webhook_sync_at: string | null;
  return_awb_code: string | null;
  awb_assigned_date: string | null;
  pickup_scheduled_date: string | null;
  pickup_exception_reason: string | null;
  undelivered_reason: string | null;
  undelivered_reason_code: string | null;
  pick_exception_reason_code: string | null;
  delivery_attempt_count: string | null;
  pickup_attempt_count: string | null;
  qc_image?: string | null;
  qc_failure_reason?: string | null;
  pod_status: string | null;
  pod: string | null;
  shipping_method: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  order_id_shopify_format: string | null;
  shopify_order_identifier: string | null;
  customer_name_shopify: string | null;
  customer_phone_shopify: string | null;
  coach: string | null;
  last_enriched_at: string | null;
  billing_name?: string | null;
  billing_email?: string | null;
  billing_phone?: string | null;
  source_date?: string | null;
  status_bucket?: string | null;
  payment_bucket?: string | null;
  order_total_num?: number | string | null;
  has_scan_activity?: boolean | null;
  api_enriched?: boolean | null;
  shopify_matched?: boolean | null;
  has_raw_payload?: boolean | null;
  remittance_count?: number | null;
  latest_crf_id?: string | null;
  latest_utr?: string | null;
  latest_remittance_date?: string | null;
  latest_remittance_status?: string | null;
  latest_remittance_type?: string | null;
  latest_remittance_method?: string | null;
  latest_order_settlement_value?: number | string | null;
  latest_total_adjusted_amt?: number | string | null;
  latest_channel_name?: string | null;
  latest_linked_crf_ids?: string | null;
  latest_cod_available?: number | string | null;
  latest_standard_cod_available?: number | string | null;
  latest_instant_cod_available?: number | string | null;
  latest_early_cod_available?: number | string | null;
  latest_freight_charges_from_cod?: number | string | null;
  latest_rto_reversal_amount?: number | string | null;
  latest_early_cod_charges?: number | string | null;
  latest_instant_cod_charges?: number | string | null;
  latest_remittance_amount?: number | string | null;
  latest_adjusted_amount?: number | string | null;
  latest_remarks?: string | null;
  remittance_match_status?: string | null;
}
