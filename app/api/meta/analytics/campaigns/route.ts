import { NextRequest } from "next/server";
import { loadMetaCampaigns } from "@/modules/meta";
import { withMetaDashboard } from "@/modules/meta/dashboard-route";

export async function GET(request: NextRequest) {
  return withMetaDashboard(request, async ({ range, filters }) => ({
    campaigns: await loadMetaCampaigns(range, filters),
  }));
}
