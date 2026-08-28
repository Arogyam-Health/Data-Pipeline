import { NextRequest, NextResponse } from "next/server";
import { authorizeShiprocketInternal, backfillShiprocketEnrichment } from "@/modules/shiprocket";

export async function POST(request: NextRequest) {
  if (!authorizeShiprocketInternal(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      batchSize?: number;
      afterSrOrderId?: string;
    };
    const result = await backfillShiprocketEnrichment({
      batchSize: body.batchSize,
      afterSrOrderId: body.afterSrOrderId,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
