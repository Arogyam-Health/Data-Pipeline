import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternalSync, publicSyncResult, runMetaSync } from "@/modules/meta";
import { metaErrorResponse } from "@/modules/meta/http";

const bodySchema = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
});

export async function POST(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    const result = await runMetaSync({
      mode: "test",
      since: parsed.success ? parsed.data.since : undefined,
      until: parsed.success ? parsed.data.until : undefined,
      requireEnabled: false,
    });
    return NextResponse.json({ success: result.success, ...publicSyncResult(result) });
  } catch (err) {
    return metaErrorResponse(err);
  }
}
