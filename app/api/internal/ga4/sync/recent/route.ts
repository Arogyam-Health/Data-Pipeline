import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternalSync, ga4ErrorResponse, publicSyncResult, runRecentSync } from "@/modules/ga4";

const bodySchema = z.object({
  datasets: z.array(z.enum(["daily", "channel", "utm"])).optional(),
  force: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    const result = await runRecentSync({
      datasets: parsed.success ? parsed.data.datasets : undefined,
      force: parsed.success ? parsed.data.force : undefined,
      requireEnabled: true,
    });
    if (result.disabled) {
      return NextResponse.json({
        success: false,
        disabled: true,
        code: "SYNC_DISABLED",
        error: "GA4 sync is disabled. Set GA4_SYNC_ENABLED=true for scheduled recent sync.",
      });
    }
    return NextResponse.json({
      success: result.success,
      results: result.results.map(publicSyncResult),
    });
  } catch (err) {
    return ga4ErrorResponse(err);
  }
}
