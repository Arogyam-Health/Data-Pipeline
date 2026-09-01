import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingDeliveries, processShiprocketEvent } from "@/modules/shiprocket";

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
  const authHeader = request.headers.get("authorization");
  const workerSecret = process.env.WORKER_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  if (!workerSecret && !cronSecret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const providedSecret = authHeader?.replace("Bearer ", "");
  const secrets = [workerSecret, cronSecret].filter(Boolean) as string[];

  if (!providedSecret || secrets.length === 0) {
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = (await import("@/lib/supabase/admin")).getSupabaseClient();

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
    } else if (messages && messages.length > 0) {
      for (const msg of messages) {
        const eventId = msg.message?.event_id;
        const msgId = msg.msg_id;
        if (!eventId || msgId == null) continue;

        const result = await processShiprocketEvent(eventId, msgId);
        if (result.success) queueProcessed++;
        else queueErrors.push(`Event ${eventId}: ${result.error}`);
      }
    }
  } catch (err) {
    queueErrors.push(`Queue processing error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 2: Dispatch pending deliveries → sends to Pabbly
  let dispatchResult;
  try {
    dispatchResult = await dispatchPendingDeliveries();
  } catch (err) {
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
