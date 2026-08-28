import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternalSync, ga4ErrorResponse, publicSyncResult, runGa4Backfill } from "@/modules/ga4";

const bodySchema = z.object({
  dataset: z.enum(["daily", "channel", "utm"]),
  since: z.string().optional(),
  until: z.string().optional(),
});

export async function POST(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "dataset is required" }, { status: 400 });
    }
    const result = await runGa4Backfill({
      dataset: parsed.data.dataset,
      since: parsed.data.since,
      until: parsed.data.until,
    });
    return NextResponse.json({ success: result.success, ...publicSyncResult(result) });
  } catch (err) {
    return ga4ErrorResponse(err);
  }
}
