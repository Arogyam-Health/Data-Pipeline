import { emptyMetrics } from "./metrics";
import type { Ga4MetricSet } from "./types";

export function mergeMetricSets(base?: Partial<Ga4MetricSet>, ecommerce?: Partial<Ga4MetricSet>): Ga4MetricSet {
  const empty = emptyMetrics();
  return {
    sessions: base?.sessions ?? empty.sessions,
    engaged_sessions: base?.engaged_sessions ?? empty.engaged_sessions,
    engagement_rate: base?.engagement_rate ?? empty.engagement_rate,
    bounce_rate: base?.bounce_rate ?? empty.bounce_rate,
    users: base?.users ?? empty.users,
    new_users: base?.new_users ?? empty.new_users,
    views: base?.views ?? empty.views,
    purchases: base?.purchases ?? empty.purchases,
    revenue: base?.revenue ?? empty.revenue,
    add_to_carts: ecommerce?.add_to_carts ?? empty.add_to_carts,
    items_added_to_cart: ecommerce?.items_added_to_cart ?? empty.items_added_to_cart,
    begin_checkout: ecommerce?.begin_checkout ?? empty.begin_checkout,
  };
}

export function mergeReports(
  baseRows: Array<{ key: string; metrics: Partial<Ga4MetricSet> }>,
  ecommerceRows: Array<{ key: string; metrics: Partial<Ga4MetricSet> }>
): Map<string, Ga4MetricSet> {
  const merged = new Map<string, Ga4MetricSet>();
  for (const row of baseRows) {
    merged.set(row.key, mergeMetricSets(row.metrics, undefined));
  }
  for (const row of ecommerceRows) {
    const existing = merged.get(row.key);
    merged.set(row.key, mergeMetricSets(existing, row.metrics));
  }
  return merged;
}
