import { NextRequest } from "next/server";
import { loadMetaFunnel } from "@/modules/meta";
import { withMetaDashboard } from "@/modules/meta/dashboard-route";

export async function GET(request: NextRequest) {
  return withMetaDashboard(request, async ({ range, filters }) => ({
    funnel: await loadMetaFunnel(range, filters),
  }));
}
