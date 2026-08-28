import { NextRequest, NextResponse } from "next/server";
import {
  authorizeShiprocketDashboard,
  dashboardAuthConfigured,
  loadShiprocketQuality,
} from "@/modules/shiprocket";

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const quality = await loadShiprocketQuality();
    return NextResponse.json({ success: true, quality });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Quality load failed" },
      { status: 500 }
    );
  }
}
