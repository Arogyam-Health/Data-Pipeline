import { NextRequest, NextResponse } from "next/server";
import {
  authorizeShiprocketDashboard,
  dashboardAuthConfigured,
  getShiprocketRemittanceDetail,
} from "@/modules/shiprocket";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ crfId: string }> }
) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { crfId } = await context.params;
  try {
    const detail = await getShiprocketRemittanceDetail(crfId);
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...detail });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      { status: 500 }
    );
  }
}
