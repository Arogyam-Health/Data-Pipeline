import { NextRequest, NextResponse } from "next/server";
import { authorizeDashboard, dashboardAuthConfigured } from "./internal-auth";
import { dashboardRangeSchema, ga4ErrorResponse, resolveDashboardDateRange } from "./http";
import { getProperty } from "./repository";
import { Ga4ConfigError } from "./errors";
import { getGa4Env, getGa4PropertyId } from "./env";

export async function withGa4Dashboard<T>(
  request: NextRequest,
  loader: (input: {
    range: { from: string; to: string };
    query: {
      channel?: string;
      source?: string;
      campaign?: string;
      medium?: string;
      content?: string;
      sort?: string;
      dir?: "asc" | "desc";
      page?: number;
      pageSize?: number;
    };
  }) => Promise<T>
): Promise<NextResponse> {
  if (!dashboardAuthConfigured() || !authorizeDashboard(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = dashboardRangeSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }
    let timeZone = process.env.GA4_REPORTING_TIMEZONE || "";
    try {
      const env = getGa4Env();
      const property = await getProperty(getGa4PropertyId(env));
      timeZone = property?.reporting_timezone || timeZone;
    } catch (err) {
      if (err instanceof Ga4ConfigError) {
        return NextResponse.json(
          { success: false, disabled: true, error: "GA4 not configured. Set GA4 env vars to enable." },
          { status: 200 }
        );
      }
      timeZone = timeZone || "UTC";
    }
    const range = resolveDashboardDateRange({ ...parsed.data, timeZone: timeZone || "UTC" });
    const query = {
      channel: parsed.data.channel,
      source: parsed.data.source,
      campaign: parsed.data.campaign,
      medium: parsed.data.medium,
      content: parsed.data.content,
      sort: parsed.data.sort,
      dir: parsed.data.dir,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    };
    const data = await loader({ range, query });
    return NextResponse.json({ success: true, range, query, ...(isPlainObject(data) ? data : { data }) });
  } catch (err) {
    if (err instanceof Ga4ConfigError) {
      return NextResponse.json(
        { success: false, disabled: true, error: "GA4 not configured. Set GA4 env vars to enable." },
        { status: 200 }
      );
    }
    return ga4ErrorResponse(err);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
