import { NextRequest } from "next/server";
import { loadMetaDaily } from "@/modules/meta";
import { withMetaDashboard } from "@/modules/meta/dashboard-route";

export async function GET(request: NextRequest) {
  return withMetaDashboard(request, async ({ range, filters }) => ({ daily: await loadMetaDaily(range, filters) }));
}
