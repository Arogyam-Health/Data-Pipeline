import { timingSafeEqual } from "crypto";
import { getShopifyEnv } from "./env";

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function authorizeInternalSync(header: string | null): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  const shopifySecret = getShopifyEnv().SHOPIFY_INTERNAL_SYNC_SECRET;
  if (safeCompare(provided, shopifySecret)) return true;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && safeCompare(provided, cronSecret)) return true;
  return false;
}

export function authorizeDashboard(header: string | null): boolean {
  const user = process.env.DASHBOARD_USERNAME;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) return false;
  if (!header || !header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return false;
    const providedUser = decoded.slice(0, idx);
    const providedPass = decoded.slice(idx + 1);
    return safeCompare(providedUser, user) && safeCompare(providedPass, pass);
  } catch {
    return false;
  }
}

export function dashboardAuthConfigured(): boolean {
  return Boolean(process.env.DASHBOARD_USERNAME && process.env.DASHBOARD_PASSWORD);
}
