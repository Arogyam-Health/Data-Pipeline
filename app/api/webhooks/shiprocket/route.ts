import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getSupabaseClient } from "@/lib/supabase/admin";
import { computeRequestHash } from "@/lib/integrations/hashing";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/webhooks/shiprocket
 *
 * Lightweight webhook receiver. Does only:
 * 1. Authenticate webhook
 * 2. Read raw body
 * 3. Validate JSON
 * 4. Compute SHA-256 hash
 * 5. Store event + enqueue (atomic)
 * 6. Return 200 quickly
 *
 * Does NOT process orders synchronously.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();

  // 1. Authenticate webhook
  // Shiprocket may send auth via header or query param.
  // Adjust header name based on your Shiprocket webhook config.
  const authHeader = request.headers.get("authorization");
  const webhookSecret = env.SHIPROCKET_WEBHOOK_SECRET;

  // Simple shared-secret authentication
  // Compare against Authorization header or X-Webhook-Secret
  const providedSecret =
    authHeader?.replace("Bearer ", "") ??
    request.headers.get("x-webhook-secret");

  if (!providedSecret || !safeCompare(providedSecret, webhookSecret)) {
    logger.warn("Webhook authentication failed");
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // 2. Read raw body
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 }
    );
  }

  if (!rawBody || rawBody.trim().length === 0) {
    return NextResponse.json(
      { error: "Empty request body" },
      { status: 400 }
    );
  }

  // 3. Validate JSON
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }

  // 4. Compute deterministic SHA-256 hash
  const requestHash = computeRequestHash(rawBody);

  // 5. Store event + enqueue atomically via database function
  const supabase = getSupabaseClient();

  // Sanitize headers: remove sensitive values before storing
  const safeHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "authorization" ||
      lowerKey === "x-webhook-secret" ||
      lowerKey === "cookie"
    ) {
      safeHeaders[key] = "[REDACTED]";
    } else {
      safeHeaders[key] = value;
    }
  });

  const { data, error } = await supabase
    .rpc("ingest_shiprocket_webhook", {
      p_payload: payload,
      p_request_hash: requestHash,
      p_request_headers: safeHeaders,
    });

  if (error) {
    logger.error("Failed to ingest Shiprocket webhook", {
      error: error.message,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }

  const result = data as { event_id: string; duplicate: boolean };

  if (result.duplicate) {
    logger.info("Duplicate webhook received, acknowledged", {
      event_id: result.event_id,
      request_hash: requestHash,
    });
  } else {
    logger.info("Webhook ingested and enqueued", {
      event_id: result.event_id,
      request_hash: requestHash,
    });
  }

  // 6. Return quickly
  return NextResponse.json(
    {
      received: true,
      event_id: result.event_id,
      duplicate: result.duplicate,
    },
    { status: 200 }
  );
}
