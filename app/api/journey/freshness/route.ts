import { NextRequest, NextResponse } from "next/server";
import { queryJourneyFreshness } from "@/modules/journey";
import { authorizeShiprocketDashboard, dashboardAuthConfigured } from "@/modules/shiprocket";

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ success: true, ...(await queryJourneyFreshness()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Freshness query failed" }, { status: 500 });
  }
}
