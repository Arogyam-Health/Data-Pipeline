import { BASE_METRICS, CHANNEL_DIMENSIONS, ECOMMERCE_METRICS, NOT_SET } from "./constants";
import { mergeReports } from "./merge";
import { extractReportDate, normalizeNotSet, parseReportRows } from "./normalizer";
import { mapBaseMetrics, mapEcommerceMetrics } from "./metrics";
import type { Ga4ReportResponse, NormalizedChannelRow } from "./types";

export function channelMergeKey(date: string, channel: string): string {
  return `${date}||${channel}`;
}

export function normalizeChannelValue(value: string | undefined): string {
  return normalizeNotSet(value) === NOT_SET ? NOT_SET : normalizeNotSet(value);
}

export function normalizeChannelRows(
  propertyId: string,
  base: Ga4ReportResponse,
  ecommerce: Ga4ReportResponse
): NormalizedChannelRow[] {
  const toPartial = (
    values: Record<string, string | undefined>,
    kind: "base" | "ecommerce"
  ) => {
    const date = extractReportDate(values);
    if (!date) return null;
    const channel = normalizeChannelValue(values.sessionDefaultChannelGroup);
    return {
      key: channelMergeKey(date, channel),
      date,
      channel,
      metrics: kind === "base" ? mapBaseMetrics(values) : mapEcommerceMetrics(values),
    };
  };

  const baseRows = parseReportRows(base)
    .map((values) => toPartial(values, "base"))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const ecommerceRows = parseReportRows(ecommerce)
    .map((values) => toPartial(values, "ecommerce"))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const identity = new Map<string, { date: string; channel: string }>();
  for (const row of [...baseRows, ...ecommerceRows]) {
    identity.set(row.key, { date: row.date, channel: row.channel });
  }
  const merged = mergeReports(baseRows, ecommerceRows);

  return [...merged.entries()].map(([key, metrics]) => {
    const id = identity.get(key)!;
    return {
      property_id: propertyId,
      date: id.date,
      channel: id.channel,
      ...metrics,
    };
  });
}

export function channelReportSpec() {
  return {
    dimensions: [...CHANNEL_DIMENSIONS],
    baseMetrics: [...BASE_METRICS],
    ecommerceMetrics: [...ECOMMERCE_METRICS],
  };
}
