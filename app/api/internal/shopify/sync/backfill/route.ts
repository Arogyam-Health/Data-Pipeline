import { NextRequest, NextResponse } from "next/server";
import { authorizeInternalSync, runBackfill } from "@/modules/shopify";
import { shopifyErrorResponse } from "@/modules/shopify/http";

export const maxDuration = 300;

async function handleBackfill(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runBackfill({ resume: false });
    return NextResponse.json({
      success: result.success,
      runId: result.runId,
      mode: result.mode,
      from: result.actualFrom,
      to: result.actualTo,
      ordersFetched: result.ordersFetched,
      itemsUpserted: result.itemsUpserted,
      pagesFetched: result.pagesFetched,
      resumable: result.resumable,
      historyWarning: result.historyWarning,
    });
  } catch (err) {
    return shopifyErrorResponse(err);
  }
}

export async function GET(request: NextRequest) {
  return handleBackfill(request);
}

export async function POST(request: NextRequest) {
  return handleBackfill(request);
}
