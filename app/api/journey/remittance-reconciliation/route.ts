import { NextRequest, NextResponse } from "next/server";
import { authorizeShiprocketDashboard, dashboardAuthConfigured, queryRemittanceJourneyReconciliation } from "@/modules/shiprocket";

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const importId = params.get("importId")?.trim();
  if (!importId) return NextResponse.json({ error: "importId is required" }, { status: 400 });
  try {
    return NextResponse.json({ success: true, ...await queryRemittanceJourneyReconciliation(importId, { from: params.get("from") || undefined, to: params.get("to") || undefined }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Journey remittance reconciliation failed" }, { status: 500 });
  }
}
