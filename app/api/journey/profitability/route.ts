import { NextRequest, NextResponse } from "next/server";
import { queryProfitability, type ProfitabilityLevel } from "@/modules/journey";
import { authorizeShiprocketDashboard, dashboardAuthConfigured } from "@/modules/shiprocket";

function value(params: URLSearchParams, name: string): string | undefined {
  return params.get(name)?.trim() || undefined;
}

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const p = request.nextUrl.searchParams;
    const raw = value(p, "level") || "campaign";
    if (!["campaign", "adset", "ad"].includes(raw)) {
      return NextResponse.json({ error: "level must be campaign, adset, or ad" }, { status: 400 });
    }
    const result = await queryProfitability({
      from: value(p, "from"), to: value(p, "to"), channel: value(p, "channel"), source: value(p, "source"),
      campaignId: value(p, "campaignId"), adsetId: value(p, "adsetId"), adId: value(p, "adId"),
      attributionStatus: value(p, "attributionStatus"), paymentCategory: value(p, "paymentCategory"),
    }, raw as ProfitabilityLevel);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Profitability query failed" }, { status: 500 });
  }
}
