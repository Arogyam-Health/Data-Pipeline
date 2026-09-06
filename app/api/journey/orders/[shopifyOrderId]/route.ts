import { NextRequest, NextResponse } from "next/server";
import { getJourneyDetail } from "@/modules/journey";
import { authorizeShiprocketDashboard, dashboardAuthConfigured } from "@/modules/shiprocket";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopifyOrderId: string }> }
) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { shopifyOrderId } = await context.params;
    if (!shopifyOrderId) return NextResponse.json({ error: "Missing Shopify order ID" }, { status: 400 });
    const result = await getJourneyDetail(shopifyOrderId);
    if (!result) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Journey lookup failed" }, { status: 500 });
  }
}
