import { NextRequest, NextResponse } from "next/server";
import {
  authorizeShiprocketDashboard,
  dashboardAuthConfigured,
  exportShiprocketOrders,
  ShiprocketFilterError,
  validateFilterRequest,
} from "@/modules/shiprocket";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function POST(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = validateFilterRequest({ ...body, page: 1, pageSize: 500 });
    const exported = await exportShiprocketOrders(parsed, {
      legacyLabels: body.legacyLabels === true,
    });
    const lines = [
      exported.headers.map(csvEscape).join(","),
      ...exported.rows.map((row) => row.map(csvEscape).join(",")),
    ];
    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=shiprocket-export.csv",
        "X-Export-Truncated": exported.truncated ? "true" : "false",
      },
    });
  } catch (err) {
    if (err instanceof ShiprocketFilterError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}
