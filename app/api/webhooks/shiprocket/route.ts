import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getSupabaseClient } from "@/lib/supabase/admin";
import { computeRequestHash } from "@/lib/integrations/hashing";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import {
  extractShiprocketWebhookSecret,
  forwardRawWebhookToAppsScript,
} from "@/modules/shiprocket/forward";

export const maxDuration = 60;

function safeCompare(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  const bufA = Buffer.from(left);
  const bufB = Buffer.from(right);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Shiprocket URL checks often use GET/HEAD. Auth is not required for reachability. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "shiprocket-webhook" }, { status: 200 });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

/**
 * POST /api/webhooks/shiprocket
 *
 * Lightweight webhook receiver. Does:
 * 1. Authenticate webhook
 * 2. Read raw body
 * 3. Forward the exact raw body to the existing Apps Script URL (if configured)
 * 4. Ingest into Supabase / PGMQ
 *
 * Apps Script / Sheet / production Pabbly stay intact when the forward URL is set.
 * This app still does NOT send to production Pabbly unless SHIPROCKET_PABBLY_ENABLED=true.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();
  const webhookSecret = env.SHIPROCKET_WEBHOOK_SECRET;
  const providedSecret = extractShiprocketWebhookSecret(request);

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
      { received: true, probe: true },
      { status: 200 }
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

  const appsScriptUrl = env.SHIPROCKET_APPS_SCRIPT_WEBHOOK_URL;
  if (appsScriptUrl) {
    const forwarded = await forwardRawWebhookToAppsScript({
      url: appsScriptUrl,
      rawBody,
    });
    if (!forwarded.ok) {
      return NextResponse.json(
        {
          error: "Apps Script forward failed",
          forwarded: false,
        },
        { status: 502 }
      );
    }
  } else {
    logger.warn(
      "SHIPROCKET_APPS_SCRIPT_WEBHOOK_URL is not set; this request was not forwarded to Apps Script"
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
      lowerKey === "x-api-key" ||
      lowerKey === "x-webhook-secret" ||
      lowerKey === "x-webhook-key" ||
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
