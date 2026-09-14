export type ProfitabilitySortKey =
  | "spend" | "meta_roas" | "ordered_roas" | "order_gap" | "delivered_roas"
  | "delivery_gap" | "meta_purchases" | "cpa" | "ctr" | "cpm" | "orders";

export function formatProfitMetric(value: unknown): string {
  if (value == null || (typeof value === "string" && value.trim() === "")) return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "—";
}

function numeric(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function profitabilitySortValue(row: Record<string, unknown>, sort: ProfitabilitySortKey): number | null {
  if (sort === "cpa") {
    const purchases = numeric(row.meta_purchases);
    const spend = numeric(row.spend);
    return purchases != null && purchases !== 0 && spend != null ? spend / purchases : null;
  }
  if (sort === "ctr") {
    const impressions = numeric(row.impressions);
    const clicks = numeric(row.clicks);
    return impressions != null && impressions !== 0 && clicks != null ? clicks / impressions : null;
  }
  if (sort === "cpm") {
    const impressions = numeric(row.impressions);
    const spend = numeric(row.spend);
    return impressions != null && impressions !== 0 && spend != null ? spend / impressions * 1000 : null;
  }
  return numeric(row[sort]);
}

export function sortProfitabilityRows(rows: Record<string, unknown>[], sort: ProfitabilitySortKey, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = profitabilitySortValue(left, sort);
    const b = profitabilitySortValue(right, sort);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return (a - b) * sign;
  });
}
