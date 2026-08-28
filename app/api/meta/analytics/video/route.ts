import { NextRequest } from "next/server";
import { loadMetaVideo } from "@/modules/meta";
import { withMetaDashboard } from "@/modules/meta/dashboard-route";

export async function GET(request: NextRequest) {
  return withMetaDashboard(request, async ({ range, filters }) => ({ video: await loadMetaVideo(range, filters) }));
}
