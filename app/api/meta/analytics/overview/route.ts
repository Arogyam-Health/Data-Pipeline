import { NextRequest } from "next/server";
import { loadMetaOverview } from "@/modules/meta";
import { withMetaDashboard } from "@/modules/meta/dashboard-route";

export async function GET(request: NextRequest) {
  return withMetaDashboard(request, async ({ range, filters }) => loadMetaOverview(range, filters));
}
