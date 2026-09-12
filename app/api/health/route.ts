import { NextResponse } from "next/server";

/** Lightweight platform health check; dependency health is monitored separately. */
export function GET() {
  return NextResponse.json({ ok: true, service: "data-pipeline-server" });
}

export function HEAD() {
  return new NextResponse(null, { status: 200 });
}
