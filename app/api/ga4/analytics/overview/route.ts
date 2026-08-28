import { NextRequest } from "next/server";
import { loadGa4DashboardBundle } from "@/modules/ga4";
import { withGa4Dashboard } from "@/modules/ga4/dashboard-route";

export async function GET(request: NextRequest) {
  return withGa4Dashboard(request, async ({ range, query }) => loadGa4DashboardBundle(range, query));
}
