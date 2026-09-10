import { NextRequest, NextResponse } from "next/server";
import { queryJourneyOrders } from "@/modules/journey";
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
    const page = Math.max(1, Number.parseInt(p.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(p.get("pageSize") || "25", 10) || 25));
    const result = await queryJourneyOrders({
      page, pageSize,
      from: value(p, "from"), to: value(p, "to"), channel: value(p, "channel"), source: value(p, "source"),
      campaignId: value(p, "campaignId"), adsetId: value(p, "adsetId"), adId: value(p, "adId"),
      attributionStatus: value(p, "attributionStatus"), paymentCategory: value(p, "paymentCategory"),
      courier: value(p, "courier"), shipmentStatus: value(p, "shipmentStatus"),
      delivered: value(p, "delivered"), rto: value(p, "rto"), ndr: value(p, "ndr"), hadNdr: value(p, "hadNdr"),
      remittanceStatus: value(p, "remittanceStatus"), search: value(p, "search"),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Journey query failed" }, { status: 500 });
  }
}
