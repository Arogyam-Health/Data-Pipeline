import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeDashboard,
  dashboardAuthConfigured,
  loadShopifyOrders,
} from "@/modules/shopify";
import { resolveDateRange, shopifyErrorResponse } from "@/modules/shopify/http";

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  range: z.enum(["7d", "30d", "90d", "custom"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  financialStatus: z.string().optional(),
  fulfillmentStatus: z.string().optional(),
  paymentCategory: z.string().optional(),
  cancelled: z.enum(["yes", "no"]).optional(),
  cancelReason: z.string().optional(),
  search: z.string().max(80).optional(),
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
    const data = await loadShopifyOrders({
      from: range.from,
      to: range.to,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      financialStatus: parsed.data.financialStatus || undefined,
      fulfillmentStatus: parsed.data.fulfillmentStatus || undefined,
      paymentCategory: parsed.data.paymentCategory || undefined,
      cancelled: parsed.data.cancelled,
      cancelReason: parsed.data.cancelReason || undefined,
      search: parsed.data.search,
    });
    return NextResponse.json({ success: true, range, ...data });
  } catch (err) {
    return shopifyErrorResponse(err);
  }
}
