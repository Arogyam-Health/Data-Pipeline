import { NextRequest, NextResponse } from "next/server";
import {
  authorizeDashboard,
  dashboardAuthConfigured,
  loadShopifyOrderDetail,
} from "@/modules/shopify";
import { shopifyErrorResponse } from "@/modules/shopify/http";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> }
) {
  if (!dashboardAuthConfigured() || !authorizeDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { orderId } = await context.params;
    if (!orderId || orderId.length > 64) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }
    const detail = await loadShopifyOrderDetail(orderId);
    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...detail });
  } catch (err) {
    return shopifyErrorResponse(err);
  }
}
