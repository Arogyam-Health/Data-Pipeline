import { NextRequest } from "next/server";
import { loadMetaDevices } from "@/modules/meta";
import { withMetaDashboard } from "@/modules/meta/dashboard-route";

export async function GET(request: NextRequest) {
  return withMetaDashboard(request, async ({ range }) => ({ devices: await loadMetaDevices(range) }));
}
