import { BASE_METRICS, CHANNEL_DIMENSIONS, DAILY_DIMENSIONS, ECOMMERCE_METRICS } from "./constants";
import { mergeReports } from "./merge";
import { extractReportDate, parseReportRows } from "./normalizer";
import { mapBaseMetrics, mapEcommerceMetrics } from "./metrics";
import type { DateRange, Ga4ReportResponse, NormalizedDailyRow } from "./types";

export function dailyMergeKey(date: string): string {
  return date;
}

export function normalizeDailyRows(
  propertyId: string,
  base: Ga4ReportResponse,
  ecommerce: Ga4ReportResponse
): NormalizedDailyRow[] {
  const baseRows = parseReportRows(base)
    .map((values) => {
      const date = extractReportDate(values);
      if (!date) return null;
      return { key: dailyMergeKey(date), date, metrics: mapBaseMetrics(values) };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const ecommerceRows = parseReportRows(ecommerce)
    .map((values) => {
      const date = extractReportDate(values);
      if (!date) return null;
      return { key: dailyMergeKey(date), date, metrics: mapEcommerceMetrics(values) };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const dates = new Map<string, string>();
  for (const row of [...baseRows, ...ecommerceRows]) dates.set(row.key, row.date);
  const merged = mergeReports(baseRows, ecommerceRows);

  return [...merged.entries()].map(([key, metrics]) => ({
    property_id: propertyId,
    date: dates.get(key) ?? key,
    ...metrics,
  }));
}

export function dailyReportSpec() {
  return {
    dimensions: [...DAILY_DIMENSIONS],
    baseMetrics: [...BASE_METRICS],
    ecommerceMetrics: [...ECOMMERCE_METRICS],
  };
}

export function reportRequestBody(range: DateRange, dimensions: string[], metrics: string[]) {
  return {
    dateRanges: [{ startDate: range.since, endDate: range.until }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
  };
}

export { CHANNEL_DIMENSIONS };
