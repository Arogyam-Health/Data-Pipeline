import { NextRequest, NextResponse } from "next/server";
import {
  authorizeShiprocketDashboard,
  dashboardAuthConfigured,
  queryShiprocketOverview,
  ShiprocketFilterError,
  validateFilterRequest,
} from "@/modules/shiprocket";

export async function POST(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = validateFilterRequest(body);
    const overview = await queryShiprocketOverview(parsed);
    return NextResponse.json({ success: true, overview });
  } catch (err) {
    if (err instanceof ShiprocketFilterError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Overview failed" },
      { status: 500 }
    );
  }
}
