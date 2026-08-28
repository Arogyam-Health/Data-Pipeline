import { NextRequest, NextResponse } from "next/server";
import { authorizeInternalSync, isMetaSyncEnabled, publicSyncResult, runMetaSync } from "@/modules/meta";
import { metaErrorResponse } from "@/modules/meta/http";

export async function POST(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (!isMetaSyncEnabled()) {
      return NextResponse.json({
        success: false,
        disabled: true,
        error: "Meta sync is disabled. Set META_SYNC_ENABLED=true to run scheduled today sync.",
        code: "SYNC_DISABLED",
      });
    }
    const result = await runMetaSync({ mode: "today", requireEnabled: true });
    return NextResponse.json({ success: result.success, ...publicSyncResult(result) });
  } catch (err) {
    return metaErrorResponse(err);
  }
}
