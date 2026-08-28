import { NextRequest, NextResponse } from "next/server";
import { authorizeDashboard, dashboardAuthConfigured, loadMetaSyncHealth } from "@/modules/meta";
import { metaErrorResponse } from "@/modules/meta/http";

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const syncHealth = await loadMetaSyncHealth();
    return NextResponse.json({ success: true, syncHealth });
  } catch (err) {
    return metaErrorResponse(err);
  }
}
