import { NextRequest, NextResponse } from "next/server";
import {
  authorizeDashboard,
  dashboardAuthConfigured,
} from "./internal-auth";
import { dashboardRangeSchema, metaErrorResponse, parseMetaFilters, resolveDashboardDateRange } from "./http";
import type { MetaFilters } from "./filters";

export async function withMetaDashboard<T>(
  request: NextRequest,
  loader: (input: { range: { from: string; to: string }; filters: MetaFilters }) => Promise<T>
): Promise<NextResponse> {
  if (!dashboardAuthConfigured() || !authorizeDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = dashboardRangeSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }
    // Dashboard calendar/reporting boundaries are intentionally fixed to IST.
    // Meta account timezone must not move the visible "Today" date backward.
    const range = resolveDashboardDateRange({ ...parsed.data, timeZone: "Asia/Kolkata" });
    const filters = parseMetaFilters(parsed.data);
    const data = await loader({ range, filters });
    return NextResponse.json({ success: true, range, filters, ...(isPlainObject(data) ? data : { data }) });
  } catch (err) {
    return metaErrorResponse(err);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
