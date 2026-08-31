import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { buildLegacyPabblyPayload } from "./legacy";

// ============================================================
// Delivery record helpers
// ============================================================

interface PabblyDelivery {
  id: string;
  event_id: string;
  sr_order_id: string | null;
  order_id: string | null;
  status: string;
  attempt_count: number;
  response_code: number | null;
  response_body: unknown;
  last_error: string | null;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  next_attempt_at: string | null;
  last_duration_ms: number | null;
  final_failure_at: string | null;
}

interface PabblyDeliveryLog {
  id: string;
  delivery_id: string;
  event_id: string;
  sr_order_id: string | null;
  order_id: string | null;
  attempt_number: number;
  status: string;
  response_code: number | null;
  error_category: string | null;
  error_message: string | null;
  duration_ms: number | null;
  attempted_at: string;
}

// ============================================================
// Max attempts + delay config
// ============================================================

const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [0, 15_000, 60_000, 300_000, 900_000, 3_600_000];

function backoffForAttempt(attempt: number): number {
  if (attempt < BACKOFF_MS.length) return BACKOFF_MS[attempt];
  return 3_600_000;
}

function categorizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("ECONNREFUSED"))
    return "network";
  if (msg.includes("timeout") || msg.includes("AbortError")) return "timeout";
  if (msg.includes("5") && msg.includes("status")) return "server";
  return "unknown";
}

// ============================================================
// Dispatch processor — called by cron or manual trigger
// ============================================================

export interface DispatchResult {
  processed: number;
  sent: number;
  failed: number;
  retried: number;
  skipped: number;
  errors: string[];
}

export async function dispatchPendingDeliveries(): Promise<DispatchResult> {
  const supabase = getSupabaseClient();
  const pabblyUrl = process.env.PABBLY_SHIPROCKET_URL;

  if (!pabblyUrl) {
    return { processed: 0, sent: 0, failed: 0, retried: 0, skipped: 0, errors: ["PABBLY_SHIPROCKET_URL not configured"] };
  }

  const result: DispatchResult = { processed: 0, sent: 0, failed: 0, retried: 0, skipped: 0, errors: [] };

  // Fetch pending/retrying deliveries ready for attempt
  const { data: deliveries, error: fetchError } = await supabase
    .from("shiprocket_pabbly_deliveries")
    .select("*")
    .in("status", ["pending", "retrying"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(50);

  if (fetchError || !deliveries || deliveries.length === 0) {
    if (fetchError) result.errors.push(fetchError.message);
    return result;
  }

  for (const delivery of deliveries as PabblyDelivery[]) {
    result.processed++;

    // Mark as processing
    await supabase
      .from("shiprocket_pabbly_deliveries")
      .update({ status: "processing" })
      .eq("id", delivery.id);

    const startTime = Date.now();

    try {
      // Build payload from explorer
      const payload = await buildPayloadForDelivery(delivery);
      if (!payload) {
        throw new Error("Could not build payload — order not found in explorer");
      }

      const response = await fetch(pabblyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const durationMs = Date.now() - startTime;
      const responseBody = await response.text();
      let parsedBody: Record<string, unknown> = {};
      try {
        parsedBody = JSON.parse(responseBody);
      } catch {
        parsedBody = { raw: responseBody };
      }

      const attemptNum = delivery.attempt_count + 1;

      // Write delivery log
      await writeDeliveryLog(supabase, {
        delivery_id: delivery.id,
        event_id: delivery.event_id,
        sr_order_id: delivery.sr_order_id,
        order_id: delivery.order_id,
        attempt_number: attemptNum,
        status: response.ok ? "sent" : "failed",
        response_code: response.status,
        error_category: null,
        error_message: response.ok ? null : `HTTP ${response.status}`,
        duration_ms: durationMs,
      });

      if (response.ok) {
        // Success
        await supabase
          .from("shiprocket_pabbly_deliveries")
          .update({
            status: "sent",
            attempt_count: attemptNum,
            response_code: response.status,
            response_body: parsedBody,
            last_attempt_at: new Date().toISOString(),
            last_duration_ms: durationMs,
            sent_at: new Date().toISOString(),
          })
          .eq("id", delivery.id);

        result.sent++;
        logger.info("Pabbly dispatch success", {
          delivery_id: delivery.id,
          sr_order_id: delivery.sr_order_id ?? undefined,
          status: response.status,
        });
      } else {
        // Non-retryable HTTP error (4xx) or retryable (5xx)
        await handleDispatchFailure(supabase, delivery, attemptNum, new Error(`HTTP ${response.status}`), durationMs);
        if (response.status >= 500) {
          result.retried++;
        } else {
          result.failed++;
        }
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const attemptNum = delivery.attempt_count + 1;
      await handleDispatchFailure(supabase, delivery, attemptNum, err, durationMs);
      result.failed++;
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}

// ============================================================
// Single delivery retry — manual trigger
// ============================================================

export async function retrySingleDelivery(deliveryId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const pabblyUrl = process.env.PABBLY_SHIPROCKET_URL;

  if (!pabblyUrl) {
    return { success: false, error: "PABBLY_SHIPROCKET_URL not configured" };
  }

  const { data: delivery, error: fetchError } = await supabase
    .from("shiprocket_pabbly_deliveries")
    .select("*")
    .eq("id", deliveryId)
    .single();

  if (fetchError || !delivery) {
    return { success: false, error: "Delivery not found" };
  }

  if (delivery.status === "processing") {
    return { success: false, error: "Delivery already processing" };
  }

  // Mark as processing
  await supabase
    .from("shiprocket_pabbly_deliveries")
    .update({ status: "processing" })
    .eq("id", deliveryId);

  const startTime = Date.now();

  try {
    const payload = await buildPayloadForDelivery(delivery);
    if (!payload) {
      throw new Error("Could not build payload — order not found in explorer");
    }

    const response = await fetch(pabblyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const durationMs = Date.now() - startTime;
    const responseBody = await response.text();
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      parsedBody = { raw: responseBody };
    }

    const attemptNum = delivery.attempt_count + 1;

    await writeDeliveryLog(supabase, {
      delivery_id: deliveryId,
      event_id: delivery.event_id,
      sr_order_id: delivery.sr_order_id,
      order_id: delivery.order_id,
      attempt_number: attemptNum,
      status: response.ok ? "sent" : "failed",
      response_code: response.status,
      error_category: null,
      error_message: response.ok ? null : `HTTP ${response.status}`,
      duration_ms: durationMs,
    });

    if (response.ok) {
      await supabase
        .from("shiprocket_pabbly_deliveries")
        .update({
          status: "sent",
          attempt_count: attemptNum,
          response_code: response.status,
          response_body: parsedBody,
          last_attempt_at: new Date().toISOString(),
          last_duration_ms: durationMs,
          sent_at: new Date().toISOString(),
        })
        .eq("id", deliveryId);

      return { success: true };
    }

    await handleDispatchFailure(supabase, delivery, attemptNum, new Error(`HTTP ${response.status}`), durationMs);
    return { success: false, error: `HTTP ${response.status}` };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const attemptNum = delivery.attempt_count + 1;
    await handleDispatchFailure(supabase, delivery, attemptNum, err, durationMs);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Internal helpers
// ============================================================

async function handleDispatchFailure(
  supabase: ReturnType<typeof getSupabaseClient>,
  delivery: PabblyDelivery,
  attemptNum: number,
  err: unknown,
  durationMs: number
): Promise<void> {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorCategory = categorizeError(err);

  // Write delivery log
  await writeDeliveryLog(supabase, {
    delivery_id: delivery.id,
    event_id: delivery.event_id,
    sr_order_id: delivery.sr_order_id,
    order_id: delivery.order_id,
    attempt_number: attemptNum,
    status: "failed",
    response_code: null,
    error_category: errorCategory,
    error_message: errorMessage,
    duration_ms: durationMs,
  });

  if (attemptNum >= MAX_ATTEMPTS) {
    // Final failure — no more retries
    await supabase
      .from("shiprocket_pabbly_deliveries")
      .update({
        status: "failed",
        attempt_count: attemptNum,
        last_error: errorMessage,
        last_attempt_at: new Date().toISOString(),
        last_duration_ms: durationMs,
        final_failure_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);

    logger.warn("Pabbly delivery final failure", {
      delivery_id: delivery.id,
      sr_order_id: delivery.sr_order_id ?? undefined,
      attempt: attemptNum,
      error: errorMessage,
    });
  } else {
    // Schedule retry
    const nextAttemptMs = backoffForAttempt(attemptNum);
    const nextAttemptAt = new Date(Date.now() + nextAttemptMs).toISOString();

    await supabase
      .from("shiprocket_pabbly_deliveries")
      .update({
        status: "retrying",
        attempt_count: attemptNum,
        last_error: errorMessage,
        last_attempt_at: new Date().toISOString(),
        last_duration_ms: durationMs,
        next_attempt_at: nextAttemptAt,
      })
      .eq("id", delivery.id);

    logger.info("Pabbly delivery retry scheduled", {
      delivery_id: delivery.id,
      sr_order_id: delivery.sr_order_id ?? undefined,
      attempt: attemptNum,
      next_attempt_at: nextAttemptAt,
      error: errorMessage,
    });
  }
}

async function buildPayloadForDelivery(delivery: PabblyDelivery): Promise<Record<string, string> | null> {
  const supabase = getSupabaseClient();

  const { data: orderRow, error } = await supabase
    .from("shiprocket_order_explorer")
    .select("*")
    .eq("sr_order_id", delivery.sr_order_id)
    .maybeSingle();

  if (error || !orderRow) return null;

  return buildLegacyPabblyPayload(orderRow, {
    sheetAction: "created_new_row",
    eventId: delivery.event_id,
  });
}

interface DeliveryLogInput {
  delivery_id: string;
  event_id: string;
  sr_order_id: string | null;
  order_id: string | null;
  attempt_number: number;
  status: string;
  response_code: number | null;
  error_category: string | null;
  error_message: string | null;
  duration_ms: number | null;
}

async function writeDeliveryLog(
  supabase: ReturnType<typeof getSupabaseClient>,
  input: DeliveryLogInput
): Promise<void> {
  const { error } = await supabase
    .from("shiprocket_pabbly_delivery_logs")
    .insert({
      delivery_id: input.delivery_id,
      event_id: input.event_id,
      sr_order_id: input.sr_order_id,
      order_id: input.order_id,
      attempt_number: input.attempt_number,
      status: input.status,
      response_code: input.response_code,
      error_category: input.error_category,
      error_message: input.error_message,
      duration_ms: input.duration_ms,
      attempted_at: new Date().toISOString(),
    });

  if (error) {
    logger.error("Failed to write Pabbly delivery log", {
      delivery_id: input.delivery_id,
      error: error.message,
    });
  }
}

// ============================================================
// Legacy sendToPabbly — kept for backward compatibility
// (deprecated: prefer dispatchPendingDeliveries)
// ============================================================

export async function sendToPabbly(
  eventId: string,
  srOrderKey: string,
  _rawPayload: Record<string, unknown>,
  sheetAction: string = "unknown",
  _sheetRowNumber: number | string = ""
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
    return { success: true };
  }

  // Create pending delivery record — actual dispatch via processor
  const { data: delivery, error: deliveryError } = await supabase
    .from("shiprocket_pabbly_deliveries")
    .upsert(
      {
        event_id: eventId,
        sr_order_id: srOrderKey,
        order_id: null,
        status: "pending",
        attempt_count: 0,
        first_attempt_at: new Date().toISOString(),
        next_attempt_at: new Date().toISOString(),
      },
      { onConflict: "event_id" }
    )
    .select("id")
    .single();

  if (deliveryError || !delivery) {
    return { success: false, error: deliveryError?.message };
  }

  logger.info("Pabbly delivery record created via legacy path", {
    event_id: eventId,
    sr_order_id: srOrderKey,
    sheet_action: sheetAction,
  });

  return { success: true };
}
