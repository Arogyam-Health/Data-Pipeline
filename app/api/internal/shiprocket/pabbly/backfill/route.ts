import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * POST /api/internal/shiprocket/pabbly/backfill
 *
 * One-time backfill: creates pending Pabbly delivery records for all
 * shiprocket_orders that don't have one yet. After running, hit
 * /api/internal/shiprocket/pabbly/dispatch to send them.
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

  const supabase = getSupabaseClient();

  // Find all non-delivered orders that have no delivery record yet
  const { data: ordersWithoutDelivery, error: queryError } = await supabase
    .from("shiprocket_orders")
    .select("sr_order_id, order_id, shipment_status, current_status")
    .not("sr_order_id", "is", null)
    .not("shipment_status", "ilike", "%delivered%")
    .not("current_status", "ilike", "%delivered%");

  if (queryError) {
    return NextResponse.json(
      { error: `Failed to query orders: ${queryError.message}` },
      { status: 500 }
    );
  }

  if (!ordersWithoutDelivery || ordersWithoutDelivery.length === 0) {
    return NextResponse.json({ created: 0, message: "No orders found" });
  }

  // Find which sr_order_ids already have a delivery record
  const srOrderIds = ordersWithoutDelivery.map((o) => o.sr_order_id);

  const { data: existingDeliveries, error: existingError } = await supabase
    .from("shiprocket_pabbly_deliveries")
    .select("sr_order_id")
    .in("sr_order_id", srOrderIds);

  if (existingError) {
    return NextResponse.json(
      { error: `Failed to query existing deliveries: ${existingError.message}` },
      { status: 500 }
    );
  }

  const existingSet = new Set(
    (existingDeliveries || []).map((d) => d.sr_order_id)
  );

  const toCreate = ordersWithoutDelivery.filter(
    (o) => !existingSet.has(o.sr_order_id)
  );

  if (toCreate.length === 0) {
    return NextResponse.json({
      created: 0,
      total: ordersWithoutDelivery.length,
      alreadyHaveDelivery: existingSet.size,
      message: "All orders already have delivery records",
    });
  }

  // Batch insert delivery records (500 at a time)
  const BATCH_SIZE = 500;
  let created = 0;

  for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
    const batch = toCreate.slice(i, i + BATCH_SIZE);
    const rows = batch.map((o) => ({
      event_id: null,
      sr_order_id: o.sr_order_id,
      order_id: o.order_id,
      status: "pending",
      attempt_count: 0,
      first_attempt_at: new Date().toISOString(),
      next_attempt_at: new Date().toISOString(),
    }));

    const { error: insertError } = await supabase
      .from("shiprocket_pabbly_deliveries")
      .insert(rows);

    if (insertError) {
      logger.error("Backfill insert batch failed", {
        batch_start: i,
        error: insertError.message,
      });
      return NextResponse.json(
        {
          created,
          error: `Insert failed at batch ${i}: ${insertError.message}`,
        },
        { status: 500 }
      );
    }

    created += batch.length;
  }

  logger.info("Pabbly backfill complete", {
    created,
    total_orders: ordersWithoutDelivery.length,
    already_existed: existingSet.size,
  });

  return NextResponse.json({
    created,
    total: ordersWithoutDelivery.length,
    alreadyHaveDelivery: existingSet.size,
  });
}
