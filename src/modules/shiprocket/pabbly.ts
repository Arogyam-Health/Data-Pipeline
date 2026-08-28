import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { buildLegacyPabblyPayload } from "./legacy";

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

  const { data: orderRow, error: readError } = await supabase
    .from("shiprocket_order_explorer")
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

  const pabblyPayload = buildLegacyPabblyPayload(orderRow, {
    sheetAction,
    sheetRowNumber,
    eventId,
  });

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
