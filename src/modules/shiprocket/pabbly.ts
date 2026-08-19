import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Send processed Shiprocket data to Pabbly webhook.
 *
 * Port of Apps Script sendShiprocketSheetRowToPabbly_:
 * - Reads the full order row from the database
 * - Sends ALL fields to Pabbly (matches sheet column headers)
 * - Uses event_id as Pabbly Idempotency Key
 * - Does NOT send raw Shiprocket JSON
 */
export async function sendToPabbly(
  eventId: string,
  srOrderKey: string,
  rawPayload: Record<string, unknown>,
  sheetAction: string = "unknown",
  sheetRowNumber: number | string = ""
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const pabblyUrl = process.env.PABBLY_SHIPROCKET_URL;

  if (!pabblyUrl) {
    logger.warn("Pabbly URL not configured, skipping", { event_id: eventId });
    return { success: true };
  }

  // Check if already successfully delivered (idempotency)
  const { data: existing } = await supabase
    .from("shiprocket_pabbly_deliveries")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("status", "sent")
    .single();

  if (existing) {
    logger.info("Pabbly already delivered for this event, skipping", {
      event_id: eventId,
    });
    return { success: true };
  }

  // Create or update delivery record
  const { data: delivery, error: deliveryError } = await supabase
    .from("shiprocket_pabbly_deliveries")
    .upsert(
      {
        event_id: eventId,
        status: "pending",
        attempt_count: 0,
        first_attempt_at: new Date().toISOString(),
      },
      { onConflict: "event_id" }
    )
    .select("id")
    .single();

  if (deliveryError || !delivery) {
    logger.error("Failed to create Pabbly delivery record", {
      event_id: eventId,
      error: deliveryError?.message,
    });
    return { success: false, error: deliveryError?.message };
  }

  // Read the full order row
  const { data: orderRow, error: readError } = await supabase
    .from("shiprocket_orders")
    .select("*")
    .eq("sr_order_id", srOrderKey)
    .single();

  if (readError || !orderRow) {
    logger.error("Failed to read order for Pabbly", {
      event_id: eventId,
      sr_order_id: srOrderKey,
      error: readError?.message,
    });
    return { success: false, error: readError?.message };
  }

  // Build Pabbly payload matching Apps Script column headers
  const pabblyPayload: Record<string, unknown> = {
    "Shiprocket Unique Key": orderRow.unique_key ?? "",
    "Sr Order Id": orderRow.sr_order_id ?? "",
    "Shipment Status Id": orderRow.shipment_status_id ?? "",
    "Shipment Status": orderRow.shipment_status ?? "",
    "Scans 1 Status": orderRow.scans1_status ?? "",
    "Scans 1 Sr-status-label": orderRow.scans1_sr_status_label ?? "",
    "Scans 1 Sr-status": orderRow.scans1_sr_status ?? "",
    "Scans 1 Location": orderRow.scans1_location ?? "",
    "Scans 1 Date": orderRow.scans1_date ?? "",
    "Scans 1 Activity": orderRow.scans1_activity ?? "",
    "Scans 0 Status": orderRow.scans0_status ?? "",
    "Scans 0 Sr-status-label": orderRow.scans0_sr_status_label ?? "",
    "Scans 0 Sr-status": orderRow.scans0_sr_status ?? "",
    "Scans 0 Location": orderRow.scans0_location ?? "",
    "Scans 0 Date": orderRow.scans0_date ?? "",
    "Scans 0 Activity": orderRow.scans0_activity ?? "",
    "Order Id": orderRow.order_id ?? "",
    "Is Return": orderRow.is_return ?? "",
    Etd: orderRow.etd ?? "",
    "Current Timestamp": orderRow.current_ts ?? "",
    "Current Status Id": orderRow.current_status_id ?? "",
    "Current Status": orderRow.current_status ?? "",
    "Courier Name": orderRow.courier_name ?? "",
    "Channel Id": orderRow.channel_id ?? "",
    Awb: orderRow.awb ?? "",
    "Order Date": orderRow.order_date ?? "",
    "Created At": orderRow.created_at_sr ?? "",
    "Customer Name": orderRow.customer_name ?? "",
    "Customer Email": orderRow.customer_email ?? "",
    "Customer Phone": orderRow.customer_phone ?? "",
    "Pickup Location": orderRow.pickup_location ?? "",
    "Payment Status": orderRow.payment_status ?? "",
    "Payment Method": orderRow.payment_method ?? "",
    "Order Total": orderRow.order_total ?? "",
    Tax: orderRow.tax ?? "",
    "Order Status": orderRow.order_status ?? "",
    "Order Status Code": orderRow.order_status_code ?? "",
    "Shipment ID": orderRow.shipment_id ?? "",
    "Tracking URL": orderRow.tracking_url ?? "",
    "Delivered Date": orderRow.delivered_date ?? "",
    Products: orderRow.products ?? "",
    "Last Local API Sync At": "",
    "Last Webhook Sync At": orderRow.last_webhook_sync_at ?? "",
    "Sheet Action": sheetAction,
    "Sheet Row Number": sheetRowNumber,
    "Sheet Error": "",
    "Webhook Event Id": eventId,
    "Pabbly Idempotency Key": eventId,
  };

  try {
    const response = await fetch(pabblyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pabblyPayload),
    });

    const responseBody = await response.text();
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      parsedBody = { raw: responseBody };
    }

    await supabase
      .from("shiprocket_pabbly_deliveries")
      .update({
        status: response.ok ? "sent" : "failed",
        attempt_count: 1,
        response_code: response.status,
        response_body: parsedBody,
        last_attempt_at: new Date().toISOString(),
        sent_at: response.ok ? new Date().toISOString() : null,
      })
      .eq("id", delivery.id);

    if (!response.ok) {
      throw new Error(`Pabbly responded with status ${response.status}`);
    }

    logger.info("Pabbly delivery successful", {
      event_id: eventId,
      sr_order_id: srOrderKey,
      response_code: response.status,
    });

    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await supabase
      .from("shiprocket_pabbly_deliveries")
      .update({
        status: "failed",
        attempt_count: 1,
        last_error: errorMessage,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);

    logger.error("Pabbly delivery failed", {
      event_id: eventId,
      sr_order_id: srOrderKey,
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}
