import { NextRequest } from "next/server";
import { loadMetaActions } from "@/modules/meta";
import { withMetaDashboard } from "@/modules/meta/dashboard-route";

export async function GET(request: NextRequest) {
  return withMetaDashboard(request, async ({ range, filters }) => ({
    actions: await loadMetaActions(range, filters),
  }));
}
