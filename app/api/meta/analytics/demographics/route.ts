import { NextRequest } from "next/server";
import { loadMetaDemographics } from "@/modules/meta";
import { withMetaDashboard } from "@/modules/meta/dashboard-route";

export async function GET(request: NextRequest) {
  return withMetaDashboard(request, async ({ range }) => ({
    demographics: await loadMetaDemographics(range),
  }));
}
