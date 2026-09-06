import { NextRequest, NextResponse } from "next/server";
import {
  authorizeShiprocketDashboard,
  dashboardAuthConfigured,
  queryShiprocketRemittances,
  validateFilterRequest,
} from "@/modules/shiprocket";

export async function POST(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const data = await queryShiprocketRemittances(validateFilterRequest(body));
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Remittance query failed" },
      { status: 500 }
    );
  }
}

// Backward-compatible unfiltered read for existing internal callers.
export async function GET(request: NextRequest) {
  return POST(new NextRequest(request.url, { method: "POST", headers: request.headers, body: JSON.stringify({}) }));
}
