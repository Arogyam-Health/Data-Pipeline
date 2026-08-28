import { BASE_METRICS, ECOMMERCE_METRICS, NOT_SET, UTM_DIMENSIONS } from "./constants";
import { mergeReports } from "./merge";
import { buildUtmKey, extractReportDate, isAllNotSet, normalizeNotSet, parseReportRows } from "./normalizer";
import { mapBaseMetrics, mapEcommerceMetrics } from "./metrics";
import type { Ga4ReportResponse, NormalizedUtmRow } from "./types";

export function utmMergeKey(input: {
  date: string;
  source: string;
  campaign: string;
  medium: string;
  content: string;
}): string {
  return [input.date, input.source, input.campaign, input.medium, input.content].join("||");
}

export function shouldKeepUtmRow(source: string, campaign: string, medium: string, content: string): boolean {
  return !isAllNotSet([source, campaign, medium, content]);
}

export function normalizeUtmRows(
  propertyId: string,
  base: Ga4ReportResponse,
  ecommerce: Ga4ReportResponse
): NormalizedUtmRow[] {
  const toPartial = (
    values: Record<string, string | undefined>,
    kind: "base" | "ecommerce"
  ) => {
    const date = extractReportDate(values);
    if (!date) return null;
    const source = normalizeNotSet(values.sessionManualSource);
    const campaign = normalizeNotSet(values.sessionManualCampaignName);
    const medium = normalizeNotSet(values.sessionManualMedium);
    const content = normalizeNotSet(values.sessionManualAdContent);
    if (!shouldKeepUtmRow(source, campaign, medium, content)) return null;
    return {
      key: utmMergeKey({ date, source, campaign, medium, content }),
      date,
      source,
      campaign,
      medium,
      content,
      metrics: kind === "base" ? mapBaseMetrics(values) : mapEcommerceMetrics(values),
    };
  };

  const baseRows = parseReportRows(base)
    .map((values) => toPartial(values, "base"))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const ecommerceRows = parseReportRows(ecommerce)
    .map((values) => toPartial(values, "ecommerce"))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const identity = new Map<string, { date: string; source: string; campaign: string; medium: string; content: string }>();
  for (const row of [...baseRows, ...ecommerceRows]) {
    identity.set(row.key, {
      date: row.date,
      source: row.source,
      campaign: row.campaign,
      medium: row.medium,
      content: row.content,
    });
  }
  const merged = mergeReports(baseRows, ecommerceRows);

  return [...merged.entries()].map(([key, metrics]) => {
    const id = identity.get(key)!;
    return {
      property_id: propertyId,
      date: id.date,
      utm_key: buildUtmKey(id.source, id.campaign, id.medium, id.content),
      utm_source: id.source,
      utm_campaign: id.campaign,
      utm_medium: id.medium,
      utm_content: id.content,
      ...metrics,
    };
  });
}

export function utmReportSpec() {
  return {
    dimensions: [...UTM_DIMENSIONS],
    baseMetrics: [...BASE_METRICS],
    ecommerceMetrics: [...ECOMMERCE_METRICS],
    excludedWhenAllNotSet: NOT_SET,
  };
}
