import { NextRequest, NextResponse } from "next/server";
import { authorizeInternalSync, runShopifySync } from "@/modules/shopify";
import { shopifyErrorResponse } from "@/modules/shopify/http";

export const maxDuration = 60;

async function runIncremental(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runShopifySync({ mode: "incremental", requireEnabled: true });
    return NextResponse.json({
      success: result.success,
      runId: result.runId,
      mode: result.mode,
      status: result.status,
      from: result.actualFrom,
      to: result.actualTo,
      ordersFetched: result.ordersFetched,
      itemsUpserted: result.itemsUpserted,
      pagesFetched: result.pagesFetched,
      retryCount: result.retryCount,
      historyWarning: result.historyWarning,
    });
  } catch (err) {
    return shopifyErrorResponse(err);
  }
}

/** Vercel Cron uses GET. */
export async function GET(request: NextRequest) {
  return runIncremental(request);
}

export async function POST(request: NextRequest) {
  return runIncremental(request);
}
