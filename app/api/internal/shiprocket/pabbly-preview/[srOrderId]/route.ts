import { NextRequest, NextResponse } from "next/server";
import { authorizeShiprocketInternal, loadPabblyPreview } from "@/modules/shiprocket";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ srOrderId: string }> }
) {
  if (!authorizeShiprocketInternal(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { srOrderId } = await context.params;
  const payload = await loadPabblyPreview(srOrderId);
  if (!payload) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    wouldSend: false,
    pabblyEnabled: process.env.SHIPROCKET_PABBLY_ENABLED === "true",
    payload,
  });
}
