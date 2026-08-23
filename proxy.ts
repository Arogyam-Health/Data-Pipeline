import { NextRequest, NextResponse } from "next/server";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Shopify Dashboard"',
    },
  });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsDashboardAuth =
    pathname.startsWith("/dashboard/shopify") || pathname.startsWith("/api/shopify");

  if (!needsDashboardAuth) {
    return NextResponse.next();
  }

  const user = process.env.DASHBOARD_USERNAME;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) {
    return unauthorized();
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return unauthorized();
  }

  try {
    const decoded = atob(header.slice("Basic ".length));
    const idx = decoded.indexOf(":");
    if (idx < 0) return unauthorized();
    if (!safeEqual(decoded.slice(0, idx), user) || !safeEqual(decoded.slice(idx + 1), pass)) {
      return unauthorized();
    }
  } catch {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/shopify", "/dashboard/shopify/:path*", "/api/shopify/:path*"],
};
