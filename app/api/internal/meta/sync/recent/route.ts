import { NextRequest, NextResponse } from "next/server";
import { authorizeInternalSync, publicSyncResult, runMetaSync } from "@/modules/meta";
import { metaErrorResponse } from "@/modules/meta/http";

export async function POST(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runMetaSync({ mode: "recent_repair", requireEnabled: false });
    return NextResponse.json({ success: result.success, ...publicSyncResult(result) });
  } catch (err) {
    return metaErrorResponse(err);
  }
}
