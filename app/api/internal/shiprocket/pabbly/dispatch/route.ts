import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingDeliveries } from "@/modules/shiprocket";

/**
 * POST /api/internal/shiprocket/pabbly/dispatch
 *
 * Triggers the Pabbly dispatch processor.
 * Fetches pending delivery records, builds payloads from
 * shiprocket_order_explorer, sends to Pabbly, logs results.
 *
 * Protected by WORKER_SECRET or CRON_SECRET header.
 */
export async function POST(request: NextRequest) {
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

  try {
    const result = await dispatchPendingDeliveries();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
