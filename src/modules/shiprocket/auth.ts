import { timingSafeEqual } from "crypto";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function authorizeShiprocketDashboard(header: string | null): boolean {
  const user = process.env.DASHBOARD_USERNAME;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) return false;
  if (!header || !header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return false;
    return (
      safeCompare(decoded.slice(0, idx), user) &&
      safeCompare(decoded.slice(idx + 1), pass)
    );
  } catch {
    return false;
  }
}

export function dashboardAuthConfigured(): boolean {
  return Boolean(process.env.DASHBOARD_USERNAME && process.env.DASHBOARD_PASSWORD);
}

export function authorizeShiprocketInternal(header: string | null): boolean {
  const secret =
    process.env.SHIPROCKET_INTERNAL_SYNC_SECRET || process.env.WORKER_SECRET;
  if (!secret || !header || !header.startsWith("Bearer ")) return false;
  return safeCompare(header.slice("Bearer ".length), secret);
}
