import { NextRequest, NextResponse } from "next/server";
import { authorizeShiprocketInternal } from "@/modules/shiprocket";

/**
 * Shiprocket API reconciliation is not implemented in this repository.
 * No endpoint URLs are invented. This route exists so operators can see
 * that last_local_api_sync_at stays unset until a documented client is added.
 */
export async function POST(request: NextRequest) {
  if (!authorizeShiprocketInternal(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    success: false,
    implemented: false,
    last_local_api_sync_at: null,
    message:
      "No Shiprocket API client exists in this repository. Reconciliation is not invented. last_local_api_sync_at remains unset until a documented client is added.",
  });
}
