import { logger } from "@/lib/logger";
import { INTEGRATION } from "./constants";
import type { MetaGraphClient } from "./client";
import { MetaInvalidFieldError, sanitizeMetaError } from "./errors";
import { breakdownFields, coreInsightsFields, extendedFieldGroups, fieldGroup } from "./fields";
import type { DateRange, MetaInsightRow } from "./types";

export async function fetchCoreInsights(
  client: MetaGraphClient,
  range: DateRange,
  adAccountId: string
): Promise<MetaInsightRow[]> {
  return client.getPaged<MetaInsightRow>(`${adAccountId}/insights`, {
    level: "ad",
    time_increment: "1",
    limit: String(client.env.META_PAGE_LIMIT),
    fields: coreInsightsFields(),
    use_unified_attribution_setting: "true",
    time_range: JSON.stringify({ since: range.since, until: range.until }),
  });
}

export async function fetchExtendedInsights(
  client: MetaGraphClient,
  range: DateRange,
  adAccountId: string,
  enabled: boolean
): Promise<{ rows: MetaInsightRow[]; warning: string | null; disabledGroups: string[] }> {
  if (!enabled) {
    return { rows: [], warning: null, disabledGroups: [] };
  }

  const disabledGroups: string[] = [];
  const warnings: string[] = [];
  const merged = new Map<string, MetaInsightRow>();

  for (const group of extendedFieldGroups()) {
    try {
      const rows = await client.getPaged<MetaInsightRow>(`${adAccountId}/insights`, {
        level: "ad",
        time_increment: "1",
        limit: String(client.env.META_PAGE_LIMIT),
        fields: ["date_start", "campaign_id", "adset_id", "ad_id", ...fieldGroup(group)].join(","),
        use_unified_attribution_setting: "true",
        time_range: JSON.stringify({ since: range.since, until: range.until }),
      });
      for (const row of rows) {
        const key = insightKey(row);
        merged.set(key, { ...(merged.get(key) ?? {}), ...row });
      }
    } catch (err) {
      if (err instanceof MetaInvalidFieldError) {
        disabledGroups.push(group);
        warnings.push(`Skipped optional ${group} field group: ${sanitizeMetaError(err.message)}`);
        logger.warn("Meta extended insights group skipped", {
          provider: INTEGRATION,
          field_group: group,
        });
        continue;
      }
      throw err;
    }
  }

  return {
    rows: [...merged.values()],
    warning: warnings.length > 0 ? warnings.join("; ") : null,
    disabledGroups,
  };
}

export async function fetchBreakdownInsights(
  client: MetaGraphClient,
  range: DateRange,
  adAccountId: string,
  breakdowns: string[],
  includeReach: boolean
): Promise<{ rows: MetaInsightRow[]; warning: string | null }> {
  try {
    const rows = await client.getPaged<MetaInsightRow>(`${adAccountId}/insights`, {
      level: "ad",
      time_increment: "1",
      limit: String(client.env.META_PAGE_LIMIT),
      fields: breakdownFields(includeReach),
      breakdowns: breakdowns.join(","),
      use_unified_attribution_setting: "true",
      time_range: JSON.stringify({ since: range.since, until: range.until }),
    });
    return { rows, warning: null };
  } catch (err) {
    if (err instanceof MetaInvalidFieldError) {
      return {
        rows: [],
        warning: `Breakdown ${breakdowns.join(",")} skipped: ${sanitizeMetaError(err.message)}`,
      };
    }
    throw err;
  }
}

export function insightKey(row: Pick<MetaInsightRow, "date_start" | "campaign_id" | "adset_id" | "ad_id">): string {
  return [row.date_start ?? "", row.campaign_id ?? "", row.adset_id ?? "", row.ad_id ?? ""].join("|");
}

export function mergeInsightRows(core: MetaInsightRow[], extra: MetaInsightRow[]): MetaInsightRow[] {
  if (extra.length === 0) return core;
  const extras = new Map(extra.map((row) => [insightKey(row), row]));
  return core.map((row) => ({ ...row, ...(extras.get(insightKey(row)) ?? {}) }));
}
