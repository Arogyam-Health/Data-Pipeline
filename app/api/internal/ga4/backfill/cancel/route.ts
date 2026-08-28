import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternalSync, cancelGa4Backfill, ga4ErrorResponse } from "@/modules/ga4";

const bodySchema = z.object({
  dataset: z.enum(["daily", "channel", "utm"]),
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
    const job = await cancelGa4Backfill(parsed.data.dataset);
    return NextResponse.json({ success: true, job });
  } catch (err) {
    return ga4ErrorResponse(err);
  }
}
