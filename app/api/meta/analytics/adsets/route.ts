import { NextRequest } from "next/server";
import { loadMetaAdsets } from "@/modules/meta";
import { withMetaDashboard } from "@/modules/meta/dashboard-route";

export async function GET(request: NextRequest) {
  return withMetaDashboard(request, async ({ range, filters }) => ({
    adsets: await loadMetaAdsets(range, filters),
  }));
}
