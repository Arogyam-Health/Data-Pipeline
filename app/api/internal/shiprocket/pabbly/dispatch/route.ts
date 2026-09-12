import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingDeliveries, processShiprocketEvent } from "@/modules/shiprocket";
import { logger } from "@/lib/logger";
import { getSupabaseClient } from "@/lib/supabase/admin";

/**
 * POST/GET /api/internal/shiprocket/pabbly/dispatch
 *
 * Two-in-one worker endpoint (replaces the missing Supabase Edge Function):
 * 1. Process pending PGMQ queue messages → creates shiprocket_pabbly_deliveries rows
 * 2. Dispatch pending deliveries → sends to Pabbly
 *
 * Protected by WORKER_SECRET or CRON_SECRET header.
 */
export const maxDuration = 300;

async function handleDispatch(request: NextRequest) {
  const startedAt = Date.now();
  const authHeader = request.headers.get("authorization");
  const workerSecret = process.env.WORKER_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  logger.info("Pabbly dispatch request received", {
    method: request.method,
    has_authorization_header: Boolean(authHeader),
    worker_secret_configured: Boolean(workerSecret),
    cron_secret_configured: Boolean(cronSecret),
    node_env: process.env.NODE_ENV,
    scheduler_disabled: process.env.DISABLE_INTERNAL_SCHEDULER === "true",
  });

  if (!workerSecret && !cronSecret) {
    logger.error("Pabbly dispatch rejected: no worker or cron secret configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const providedSecret = authHeader?.replace("Bearer ", "");
  const secrets = [workerSecret, cronSecret].filter(Boolean) as string[];

  if (!providedSecret || secrets.length === 0) {
    logger.warn("Pabbly dispatch rejected: missing bearer token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let authorized = false;
  for (const secret of secrets) {
    if (providedSecret.length !== secret.length) continue;
    const a = new TextEncoder().encode(providedSecret);
    const b = new TextEncoder().encode(secret);
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    if (diff === 0) {
      authorized = true;
      break;
    }
  }

  if (!authorized) {
    logger.warn("Pabbly dispatch rejected: bearer token did not match configured secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  logger.info("Pabbly dispatch request authorized");

  let supabase: ReturnType<typeof getSupabaseClient>;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    logger.error("Pabbly dispatch could not initialize Supabase client", {
      duration_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Server database configuration is invalid" }, { status: 500 });
  }

  // Step 1: Process pending PGMQ queue messages → creates pabbly delivery rows
  const BATCH_SIZE = 20;
  const VISIBILITY_TIMEOUT = 300;

  let queueProcessed = 0;
  let queueErrors: string[] = [];

  try {
    const { data: messages, error: readError } = await supabase.rpc(
      "read_shiprocket_queue",
      { p_batch_size: BATCH_SIZE, p_visibility_timeout: VISIBILITY_TIMEOUT }
    );

    if (readError) {
      queueErrors.push(`Queue read failed: ${readError.message}`);
      logger.error("Pabbly queue read failed", { error: readError.message });
    } else if (messages && messages.length > 0) {
      logger.info("Pabbly queue messages received", { queue_message_count: messages.length });
      for (const msg of messages) {
        const eventId = msg.message?.event_id;
        const msgId = msg.msg_id;
        if (!eventId || msgId == null) continue;

        const result = await processShiprocketEvent(eventId, msgId);
        if (result.success) queueProcessed++;
        else {
          queueErrors.push(`Event ${eventId}: ${result.error}`);
          logger.warn("Shiprocket queue event processing failed", { event_id: eventId, queue_msg_id: msgId, error: result.error });
        }
      }
    } else {
      logger.info("Pabbly queue empty");
    }
  } catch (err) {
    queueErrors.push(`Queue processing error: ${err instanceof Error ? err.message : String(err)}`);
    logger.error("Pabbly queue processing threw", { error: err instanceof Error ? err.message : String(err) });
  }

  // Step 2: Dispatch pending deliveries → sends to Pabbly
  let dispatchResult;
  try {
    dispatchResult = await dispatchPendingDeliveries();
  } catch (err) {
    logger.error("Pabbly dispatch failed", {
      queue_processed: queueProcessed,
      queue_error_count: queueErrors.length,
      duration_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        success: false,
        queueProcessed,
        queueErrors,
        dispatchError: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  logger.info("Pabbly dispatch request completed", {
    queue_processed: queueProcessed,
    queue_error_count: queueErrors.length,
    processed: dispatchResult.processed,
    sent: dispatchResult.sent,
    failed: dispatchResult.failed,
    retried: dispatchResult.retried,
    skipped: dispatchResult.skipped,
    dispatch_error_count: dispatchResult.errors.length,
    duration_ms: Date.now() - startedAt,
  });

  return NextResponse.json({
    success: true,
    queueProcessed,
    queueErrors,
    ...dispatchResult,
  });
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}
