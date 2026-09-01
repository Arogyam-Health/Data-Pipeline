import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeDashboard,
  dashboardAuthConfigured,
  loadShopifyGokwikOrders,
} from "@/modules/shopify";
import { resolveDateRange, shopifyErrorResponse } from "@/modules/shopify/http";

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  range: z.enum(["7d", "30d", "90d", "custom"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }
    const range = resolveDateRange(parsed.data);
    const orders = await loadShopifyGokwikOrders(range);
    const limit = parsed.data.limit ?? 100;
    return NextResponse.json({ success: true, range, total: orders.length, orders: orders.slice(0, limit) });
  } catch (err) {
    return shopifyErrorResponse(err);
  }
}
