import { NextRequest, NextResponse } from "next/server";
import {
  authorizeDashboard,
  dashboardAuthConfigured,
  loadShopifyProducts,
} from "@/modules/shopify";
import { resolveDateRange, shopifyErrorResponse } from "@/modules/shopify/http";

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const range = resolveDateRange({
      from: request.nextUrl.searchParams.get("from") ?? undefined,
      to: request.nextUrl.searchParams.get("to") ?? undefined,
      range: (request.nextUrl.searchParams.get("range") as "7d" | "30d" | "90d" | "custom") ?? "30d",
    });
    const products = await loadShopifyProducts(range);
    return NextResponse.json({ success: true, products });
  } catch (err) {
    return shopifyErrorResponse(err);
  }
}
