import { NextRequest, NextResponse } from "next/server";
import {
  authorizeDashboard,
  dashboardAuthConfigured,
} from "./internal-auth";
import { dashboardRangeSchema, metaErrorResponse, parseMetaFilters, resolveDashboardDateRange } from "./http";
import { getAccount } from "./repository";
import { getMetaEnv } from "./env";
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
    let timeZone = "UTC";
    try {
      const account = await getAccount(getMetaEnv().META_AD_ACCOUNT_ID);
      timeZone = account?.timezone_name || "UTC";
    } catch {
      timeZone = "UTC";
    }
    const range = resolveDashboardDateRange({ ...parsed.data, timeZone });
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
