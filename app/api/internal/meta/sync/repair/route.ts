import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternalSync, publicSyncResult, runMetaSync } from "@/modules/meta";
import { MetaError } from "@/modules/meta/errors";
import { metaErrorResponse } from "@/modules/meta/http";

const bodySchema = z.object({
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
      throw new MetaError("Repair requires since/until as YYYY-MM-DD", "VALIDATION_ERROR", false);
    }
    const result = await runMetaSync({
      mode: "repair",
      since: parsed.data.since,
      until: parsed.data.until,
      requireEnabled: false,
    });
    return NextResponse.json({ success: result.success, ...publicSyncResult(result) });
  } catch (err) {
    return metaErrorResponse(err);
  }
}
