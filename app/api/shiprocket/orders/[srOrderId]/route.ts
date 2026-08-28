import { NextRequest, NextResponse } from "next/server";
import {
  authorizeShiprocketDashboard,
  dashboardAuthConfigured,
  getShiprocketOrderDetail,
} from "@/modules/shiprocket";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ srOrderId: string }> }
) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { srOrderId } = await context.params;
  if (!srOrderId) {
    return NextResponse.json({ error: "Missing srOrderId" }, { status: 400 });
  }

  try {
    const detail = await getShiprocketOrderDetail(srOrderId);
    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...detail });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      { status: 500 }
    );
  }
}
