import { NextRequest, NextResponse } from "next/server";
import { retrySingleDelivery } from "@/modules/shiprocket";

/**
 * POST /api/internal/shiprocket/pabbly/[deliveryId]/retry
 *
 * Manually retries a single Pabbly delivery.
 * Resets the delivery to pending status and immediately dispatches.
 *
 * Protected by WORKER_SECRET header.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ deliveryId: string }> }
) {
  const authHeader = request.headers.get("authorization");
  const workerSecret = process.env.WORKER_SECRET;

  if (!workerSecret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const providedSecret = authHeader?.replace("Bearer ", "");
  if (!providedSecret || providedSecret.length !== workerSecret.length) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const a = new TextEncoder().encode(providedSecret);
  const b = new TextEncoder().encode(workerSecret);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  if (diff !== 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deliveryId } = await context.params;

  try {
    const result = await retrySingleDelivery(deliveryId);
    if (result.success) {
      return NextResponse.json({ success: true, message: "Delivery sent successfully" });
    }
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 422 }
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
