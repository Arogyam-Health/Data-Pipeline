import { NOT_SET } from "./constants";
import { ga4DateToIso } from "./dates";
import { emptyMetrics, mapBaseMetrics, mapEcommerceMetrics } from "./metrics";
import type { Ga4ReportResponse, Ga4ReportRow } from "./types";

export function normalizeNotSet(value: string | undefined | null): string {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" || trimmed.toLowerCase() === "(not set)" ? NOT_SET : trimmed;
}

export function buildUtmKey(
  source: string,
  campaign: string,
  medium: string,
  content: string
): string {
  return [source, campaign, medium, content].join("||");
}

export function isAllNotSet(values: string[]): boolean {
  return values.every((value) => normalizeNotSet(value) === NOT_SET);
}

export function headerMap(headers: Array<{ name?: string }> | undefined): string[] {
  return (headers ?? []).map((header) => header.name ?? "");
}

export function rowToNamedValues(
  row: Ga4ReportRow,
  headers: string[]
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  headers.forEach((name, index) => {
    values[name] = row.dimensionValues?.[index]?.value ?? row.metricValues?.[index]?.value;
  });
  return values;
}

export function parseReportRows(response: Ga4ReportResponse): Array<Record<string, string | undefined>> {
  const dimensionNames = headerMap(response.dimensionHeaders);
  const metricNames = headerMap(response.metricHeaders);
  return (response.rows ?? []).map((row) => {
    const dimensions: Record<string, string | undefined> = {};
    dimensionNames.forEach((name, index) => {
      dimensions[name] = row.dimensionValues?.[index]?.value;
    });
    const metrics: Record<string, string | undefined> = {};
    metricNames.forEach((name, index) => {
      metrics[name] = row.metricValues?.[index]?.value;
    });
    return { ...dimensions, ...metrics };
  });
}

export function extractReportDate(values: Record<string, string | undefined>): string | null {
  return ga4DateToIso(values.date);
}

export function applyBaseOrEcommerce(
  values: Record<string, string | undefined>,
  kind: "base" | "ecommerce"
) {
  return kind === "base" ? { ...emptyMetrics(), ...mapBaseMetrics(values) } : { ...emptyMetrics(), ...mapEcommerceMetrics(values) };
}
