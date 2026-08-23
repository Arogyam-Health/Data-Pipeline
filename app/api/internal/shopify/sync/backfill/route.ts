import { NextRequest, NextResponse } from "next/server";
import { authorizeInternalSync, runBackfill } from "@/modules/shopify";
import { shopifyErrorResponse } from "@/modules/shopify/http";

export async function POST(request: NextRequest) {
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
