import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternalSync, ga4ErrorResponse, getBackfillStatus } from "@/modules/ga4";

const querySchema = z.object({
  dataset: z.enum(["daily", "channel", "utm"]),
});

export async function GET(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "dataset is required" }, { status: 400 });
    }
    const job = await getBackfillStatus(parsed.data.dataset);
    return NextResponse.json({ success: true, job });
  } catch (err) {
    return ga4ErrorResponse(err);
  }
}
