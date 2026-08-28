import { NextRequest, NextResponse } from "next/server";
import {
  authorizeShiprocketDashboard,
  dashboardAuthConfigured,
  getFilterMetadata,
} from "@/modules/shiprocket";

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ success: true, ...getFilterMetadata() });
}
