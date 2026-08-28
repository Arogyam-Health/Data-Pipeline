import { NextRequest, NextResponse } from "next/server";
import { authorizeInternalSync, ga4ErrorResponse, runConnectionTest } from "@/modules/ga4";

async function handle(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runConnectionTest({});
    return NextResponse.json(result);
  } catch (err) {
    return ga4ErrorResponse(err);
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
