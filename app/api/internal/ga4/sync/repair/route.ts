import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternalSync, ga4ErrorResponse, publicSyncResult, runGa4Sync } from "@/modules/ga4";

const bodySchema = z.object({
  dataset: z.enum(["daily", "channel", "utm"]),
  since: z.string(),
  until: z.string(),
});

export async function POST(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "dataset, since, and until are required" }, { status: 400 });
    }
    const result = await runGa4Sync({
      dataset: parsed.data.dataset,
      mode: "repair",
      since: parsed.data.since,
      until: parsed.data.until,
      requireEnabled: false,
    });
    return NextResponse.json({ success: result.success, ...publicSyncResult(result) });
  } catch (err) {
    return ga4ErrorResponse(err);
  }
}
