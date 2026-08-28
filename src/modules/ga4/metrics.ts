import { BASE_METRICS, ECOMMERCE_METRICS } from "./constants";
import type { Ga4MetricSet } from "./types";

export const emptyMetrics = (): Ga4MetricSet => ({
  sessions: 0,
  engaged_sessions: 0,
  engagement_rate: null,
  bounce_rate: null,
  users: 0,
  new_users: 0,
  views: 0,
  add_to_carts: 0,
  items_added_to_cart: 0,
  begin_checkout: 0,
  purchases: 0,
  revenue: 0,
});

export function metricNames(kind: "base" | "ecommerce"): string[] {
  return kind === "base" ? [...BASE_METRICS] : [...ECOMMERCE_METRICS];
}

export function parseIntegerMetric(value: string | undefined): number {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
}

export function parseDecimalMetric(value: string | undefined): number {
  if (value == null || value === "") return 0;
  const cleaned = String(value).replace(/[₹$,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseRateMetric(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function mapBaseMetrics(values: Record<string, string | undefined>): Pick<
  Ga4MetricSet,
  | "sessions"
  | "engaged_sessions"
  | "engagement_rate"
  | "bounce_rate"
  | "users"
  | "new_users"
  | "views"
  | "purchases"
  | "revenue"
> {
  return {
    sessions: parseIntegerMetric(values.sessions),
    engaged_sessions: parseIntegerMetric(values.engagedSessions),
    engagement_rate: parseRateMetric(values.engagementRate),
    bounce_rate: parseRateMetric(values.bounceRate),
    users: parseIntegerMetric(values.totalUsers),
    new_users: parseIntegerMetric(values.newUsers),
    views: parseIntegerMetric(values.screenPageViews),
    purchases: parseDecimalMetric(values.ecommercePurchases),
    revenue: parseDecimalMetric(values.totalRevenue),
  };
}

export function mapEcommerceMetrics(values: Record<string, string | undefined>): Pick<
  Ga4MetricSet,
  "add_to_carts" | "items_added_to_cart" | "begin_checkout"
> {
  return {
    add_to_carts: parseIntegerMetric(values.addToCarts),
    items_added_to_cart: parseIntegerMetric(values.itemsAddedToCart),
    begin_checkout: parseIntegerMetric(values.checkouts),
  };
}

export function derivedEngagementRate(engagedSessions: number, sessions: number): number | null {
  if (sessions <= 0) return null;
  return engagedSessions / sessions;
}

export function derivedBounceRate(engagedSessions: number, sessions: number): number | null {
  const engagement = derivedEngagementRate(engagedSessions, sessions);
  return engagement == null ? null : 1 - engagement;
}
