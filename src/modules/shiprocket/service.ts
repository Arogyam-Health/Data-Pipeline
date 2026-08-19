import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { calculateRetryDelay, isDeadLetter } from "@/lib/integrations/retry";
import { extractWebhookFields, toOrderRow } from "./parser";
import { sendToPabbly } from "./pabbly";
import type { ShiprocketWebhookPayload } from "./types";
import { getEnv } from "@/config/env";

/**
 * Process a single Shiprocket webhook event.
 * Called by the queue worker.
 */
export async function processShiprocketEvent(
  eventId: string,
  msgId: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const env = getEnv();

  logger.info("Processing Shiprocket event", {
    event_id: eventId,
    queue_msg_id: msgId,
  });

  // 1. Load the integration event
  const { data: event, error: fetchError } = await supabase
    .from("integration_events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (fetchError || !event) {
    logger.error("Failed to load integration event", {
      event_id: eventId,
      queue_msg_id: msgId,
    });
    return {
      success: false,
      error: `Event not found: ${fetchError?.message}`,
    };
  }

  // Skip if already processed
  if (event.status === "processed") {
    logger.info("Event already processed, skipping", { event_id: eventId });
    await supabase
      .rpc("archive_shiprocket_queue_message", { p_msg_id: msgId });
    return { success: true };
  }

  // Skip if dead-lettered
  if (event.status === "dead_letter") {
    logger.warn("Event is dead-lettered, skipping", { event_id: eventId });
    await supabase
      .rpc("archive_shiprocket_queue_message", { p_msg_id: msgId });
    return { success: true };
  }

  // 2. Mark as processing
  await supabase
    .from("integration_events")
    .update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
      attempt_count: event.attempt_count + 1,
    })
    .eq("id", eventId);

  try {
    // 3. Parse the payload (Apps Script-compatible parser)
    const payload = event.payload as ShiprocketWebhookPayload;
    const fields = extractWebhookFields(payload);

    if (!fields.sr_order_id) {
      throw new Error("No sr_order_id found in webhook payload");
    }

    logger.info("Extracted Shiprocket fields", {
      event_id: eventId,
      sr_order_id: fields.sr_order_id,
      shipment_status: fields.shipment_status,
      current_status: fields.current_status,
    });

    // 4. Build the order row
    const row = toOrderRow(
      fields,
      payload as Record<string, unknown>,
      eventId
    );

    // 5. Upsert shiprocket_orders
    const { error: upsertError } = await supabase
      .from("shiprocket_orders")
      .upsert(
        {
          ...row,
          unique_key: fields.unique_key,
          current_ts: fields.current_ts,
          raw_payload: payload,
          integration_event_id: eventId,
          last_webhook_sync_at: new Date().toISOString(),
        },
        { onConflict: "sr_order_id" }
      );

    if (upsertError) {
      throw new Error(`Upsert failed: ${upsertError.message}`);
    }

    // Verify the write
    const { data: verified, error: verifyError } = await supabase
      .from("shiprocket_orders")
      .select("sr_order_id")
      .eq("sr_order_id", fields.sr_order_id)
      .single();

    if (verifyError || !verified) {
      throw new Error(
        `Verification failed: sr_order_id ${fields.sr_order_id} not found after upsert`
      );
    }

    logger.info("Shiprocket order upserted and verified", {
      event_id: eventId,
      sr_order_id: fields.sr_order_id,
    });

    // 6. Send to Pabbly if enabled
    if (env.SHIPROCKET_PABBLY_ENABLED && env.PABBLY_SHIPROCKET_URL) {
      const { data: existingOrder } = await supabase
        .from("shiprocket_orders")
        .select("id")
        .eq("sr_order_id", fields.sr_order_id)
        .single();

      const sheetAction = existingOrder
        ? "updated_existing_row"
        : "created_new_row";

      await sendToPabbly(
        eventId,
        fields.sr_order_id,
        payload as Record<string, unknown>,
        sheetAction,
        ""
      );
    }

    // 7. Mark event as processed
    await supabase
      .from("integration_events")
      .update({
        status: "processed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", eventId);

    // 8. Archive the queue message
    await supabase
      .rpc("archive_shiprocket_queue_message", { p_msg_id: msgId });

    logger.info("Shiprocket event processed successfully", {
      event_id: eventId,
      sr_order_id: fields.sr_order_id,
      queue_msg_id: msgId,
    });

    return { success: true };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    const newAttemptCount = event.attempt_count + 1;

    logger.error("Shiprocket event processing failed", {
      event_id: eventId,
      queue_msg_id: msgId,
      error: errorMessage,
      attempt: newAttemptCount,
    });

    if (isDeadLetter(newAttemptCount)) {
      await supabase
        .from("integration_events")
        .update({
          status: "dead_letter",
          last_error: errorMessage,
        })
        .eq("id", eventId);

      await supabase
        .rpc("delete_shiprocket_queue_message", { p_msg_id: msgId });

      logger.warn("Event dead-lettered after max attempts", {
        event_id: eventId,
        attempt: newAttemptCount,
      });
    } else {
      const delaySeconds = Math.ceil(
        calculateRetryDelay(newAttemptCount) / 1000
      );

      await supabase
        .from("integration_events")
        .update({
          status: "failed",
          last_error: errorMessage,
        })
        .eq("id", eventId);

      await supabase
        .rpc("retry_shiprocket_queue_message", {
          p_msg_id: msgId,
          p_delay_seconds: delaySeconds,
        });

      logger.info("Event queued for retry", {
        event_id: eventId,
        attempt: newAttemptCount,
        delay_seconds: delaySeconds,
      });
    }

    return { success: false, error: errorMessage };
  }
}
