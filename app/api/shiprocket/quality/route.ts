import { NextRequest, NextResponse } from "next/server";
import {
  authorizeShiprocketDashboard,
  dashboardAuthConfigured,
  loadShiprocketQuality,
  validateFilterRequest,
} from "@/modules/shiprocket";

export async function POST(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const parsed = validateFilterRequest(body);
    const quality = await loadShiprocketQuality(parsed);
    return NextResponse.json({ success: true, quality });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Quality load failed" },
      { status: 500 }
    );
  }
}

// Backward-compatible unfiltered read for existing internal callers.
export async function GET(request: NextRequest) {
  return POST(new NextRequest(request.url, { method: "POST", headers: request.headers, body: JSON.stringify({}) }));
}
