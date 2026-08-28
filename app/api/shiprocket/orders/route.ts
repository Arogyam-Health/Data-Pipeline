import { NextRequest, NextResponse } from "next/server";
import {
  authorizeShiprocketDashboard,
  dashboardAuthConfigured,
  queryShiprocketOrders,
  ShiprocketFilterError,
  validateFilterRequest,
} from "@/modules/shiprocket";

export async function GET(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = validateFilterRequest({
      page: params.page,
      pageSize: params.pageSize,
      search: params.search,
      sort: params.sort ? JSON.parse(params.sort) : undefined,
      filters: params.filters ? JSON.parse(params.filters) : [],
    });
    const data = await queryShiprocketOrders(parsed);
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    if (err instanceof ShiprocketFilterError || err instanceof SyntaxError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!dashboardAuthConfigured() || !authorizeShiprocketDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = validateFilterRequest(body);
    const data = await queryShiprocketOrders(parsed);
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    if (err instanceof ShiprocketFilterError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 }
    );
  }
}
