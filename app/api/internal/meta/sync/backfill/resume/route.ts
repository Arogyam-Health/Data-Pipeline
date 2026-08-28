import { NextRequest, NextResponse } from "next/server";
import { authorizeInternalSync, publicSyncResult, runMetaBackfill } from "@/modules/meta";
import { metaErrorResponse } from "@/modules/meta/http";

export async function POST(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runMetaBackfill({ resume: true });
    return NextResponse.json({
      success: result.success,
      resumable: result.resumable ?? false,
      ...publicSyncResult(result),
    });
  } catch (err) {
    return metaErrorResponse(err);
  }
}
