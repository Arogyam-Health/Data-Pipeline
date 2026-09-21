import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeDashboard, dashboardAuthConfigured } from "@/modules/shopify";
import { shopifyErrorResponse } from "@/modules/shopify/http";
import { loadShopifyBusinessPerformance, type BusinessPerformanceLevel } from "@/modules/shopify/business-performance";
import { resolveBusinessDateRange } from "@/modules/shopify/business-date";

const dateInput = z.union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const schema = z.object({
  from: dateInput.optional(), to: dateInput.optional(), range: z.enum(["7d", "30d", "90d", "custom"]).optional(),
  level: z.enum(["source", "medium", "campaign", "content", "term"]).optional(),
  source: z.string().optional(), medium: z.string().optional(), campaign: z.string().optional(), content: z.string().optional(), term: z.string().optional(),
});

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeDashboard(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    const range = resolveBusinessDateRange(parsed.data);
    const parents = Object.fromEntries([["source", parsed.data.source], ["medium", parsed.data.medium], ["campaign", parsed.data.campaign], ["content", parsed.data.content]].filter(([, value]) => value)) as Record<string, string>;
    const data = await loadShopifyBusinessPerformance({ ...range, level: parsed.data.level as BusinessPerformanceLevel | undefined, parents });
    return NextResponse.json({ success: true, ...data });
  } catch (error) { return shopifyErrorResponse(error); }
}
