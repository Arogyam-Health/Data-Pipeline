import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { calculateRetryDelay, isDeadLetter } from "@/lib/integrations/retry";
import { extractWebhookFields, toOrderRow } from "./parser";
import { sendToPabbly } from "./pabbly";
import { isStaleWebhook, mergeShiprocketOrderRow } from "./merge";
import { enrichShiprocketOrder } from "./enrichment";
import type { ShiprocketOrderRow, ShiprocketWebhookPayload } from "./types";
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

    // 4. Load existing current-state row for sparse merge + freshness
    const { data: existing } = await supabase
      .from("shiprocket_orders")
      .select("*")
      .eq("sr_order_id", fields.sr_order_id)
      .maybeSingle();

    const incomingRow = toOrderRow(
      fields,
      payload as Record<string, unknown>,
      eventId
    );
    const stale = isStaleWebhook(fields.current_ts, existing?.current_ts);
    const row = mergeShiprocketOrderRow(
      (existing as ShiprocketOrderRow | null) ?? null,
      incomingRow,
      { staleCurrentState: stale }
    );

    if (stale) {
      logger.info("Stale Shiprocket webhook preserved in history only", {
        event_id: eventId,
        sr_order_id: fields.sr_order_id,
        incoming_ts: fields.current_ts,
        existing_ts: existing?.current_ts,
      });
    }

    // 5. Upsert shiprocket_orders (source-aware merged row)
    const { error: upsertError } = await supabase
      .from("shiprocket_orders")
      .upsert(
        {
          ...row,
          unique_key: fields.unique_key || existing?.unique_key,
          current_ts: stale ? existing?.current_ts ?? fields.current_ts : row.current_ts,
          raw_payload: stale && existing?.raw_payload ? existing.raw_payload : payload,
          integration_event_id: eventId,
          last_webhook_sync_at: new Date().toISOString(),
          last_local_api_sync_at: existing?.last_local_api_sync_at ?? null,
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

    if (!stale && fields.all_scans.length > 0) {
      await replaceShiprocketScans(fields.sr_order_id, fields.awb, fields.all_scans);
    }

    try {
      await enrichShiprocketOrder(fields.sr_order_id);
    } catch (enrichErr) {
      logger.warn("Shopify enrichment failed after order upsert", {
        event_id: eventId,
        sr_order_id: fields.sr_order_id,
        error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
      });
    }

    // 6. Send to Pabbly if enabled (default false — Apps Script remains production)
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

async function replaceShiprocketScans(
  srOrderId: string,
  awb: string | null,
  scans: Array<{
    status: string | null;
    sr_status: string | null;
    sr_status_label: string | null;
    activity: string | null;
    location: string | null;
    date: string | null;
    latitude: string | null;
    longitude: string | null;
  }>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase
    .from("shiprocket_scans")
    .delete()
    .eq("sr_order_id", srOrderId);
  if (deleteError) {
    logger.warn("Failed to clear previous Shiprocket scans", {
      sr_order_id: srOrderId,
      error: deleteError.message,
    });
    return;
  }

  const rows = scans.map((scan, index) => ({
    sr_order_id: srOrderId,
    awb,
    scan_index: index,
    scan_date: scan.date || null,
    status: scan.status || null,
    sr_status: scan.sr_status || null,
    sr_status_label: scan.sr_status_label || null,
    activity: scan.activity || null,
    location: scan.location || null,
    latitude: scan.latitude || null,
    longitude: scan.longitude || null,
  }));

  if (rows.length === 0) return;
  const { error: insertError } = await supabase.from("shiprocket_scans").insert(rows);
  if (insertError) {
    logger.warn("Failed to insert Shiprocket scans", {
      sr_order_id: srOrderId,
      error: insertError.message,
    });
  }
}
