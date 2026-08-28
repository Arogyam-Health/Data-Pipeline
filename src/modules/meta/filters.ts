export interface MetaFilters {
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  objective?: string;
  search?: string;
  purchaseStatus?: "all" | "with" | "without";
  videoStatus?: "all" | "has_video";
  funnelStatus?: "all" | "has_lpv" | "has_atc" | "has_checkout";
  messagingStatus?: "all" | "with" | "without";
  minSpend?: number;
  maxSpend?: number;
  minRoas?: number;
  maxRoas?: number;
  minFrequency?: number;
  maxFrequency?: number;
  minPurchases?: number;
  sort?: "spend" | "purchases" | "roas" | "ctr" | "frequency" | "name";
  dir?: "asc" | "desc";
}

export interface MetaFilterOptionRow {
  kind: string;
  id: string;
  label: string | null;
  campaign_id: string | null;
  adset_id: string | null;
}

export interface MetaFilterOptions {
  campaigns: Array<{ id: string; label: string }>;
  adsets: Array<{ id: string; label: string; campaign_id: string | null }>;
  ads: Array<{ id: string; label: string; campaign_id: string | null; adset_id: string | null }>;
  objectives: Array<{ id: string; label: string }>;
}

export function sanitizeMetaSearch(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[%_(),]/g, "").trim();
  return cleaned || null;
}

function blankToNull(value: string | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

function statusOrNull(value: string | undefined): string | null {
  if (!value || value === "all") return null;
  return value;
}

export function toRpcFilters(filters: MetaFilters): Record<string, string | number | null> {
  return {
    p_campaign_id: blankToNull(filters.campaignId),
    p_adset_id: blankToNull(filters.adsetId),
    p_ad_id: blankToNull(filters.adId),
    p_objective: blankToNull(filters.objective),
    p_search: sanitizeMetaSearch(filters.search),
    p_purchase_status: statusOrNull(filters.purchaseStatus),
    p_video_status: statusOrNull(filters.videoStatus),
    p_min_spend: filters.minSpend ?? null,
    p_max_spend: filters.maxSpend ?? null,
    p_min_roas: filters.minRoas ?? null,
    p_max_roas: filters.maxRoas ?? null,
    p_min_frequency: filters.minFrequency ?? null,
    p_funnel_status: statusOrNull(filters.funnelStatus),
    p_messaging_status: statusOrNull(filters.messagingStatus),
    p_min_purchases: filters.minPurchases ?? null,
    p_max_frequency: filters.maxFrequency ?? null,
  };
}

export function hasSqlFilters(filters: MetaFilters | undefined): boolean {
  if (!filters) return false;
  return Object.values(toRpcFilters(filters)).some((value) => value != null);
}

export function groupFilterOptions(rows: MetaFilterOptionRow[]): MetaFilterOptions {
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  return {
    campaigns: rows
      .filter((row) => row.kind === "campaign")
      .map((row) => ({ id: row.id, label: row.label || row.id }))
      .sort(byLabel),
    adsets: rows
      .filter((row) => row.kind === "adset")
      .map((row) => ({
        id: row.id,
        label: row.label || row.id,
        campaign_id: row.campaign_id,
      }))
      .sort(byLabel),
    ads: rows
      .filter((row) => row.kind === "ad")
      .map((row) => ({
        id: row.id,
        label: row.label || row.id,
        campaign_id: row.campaign_id,
        adset_id: row.adset_id,
      }))
      .sort(byLabel),
    objectives: rows
      .filter((row) => row.kind === "objective")
      .map((row) => ({ id: row.id, label: row.label || row.id }))
      .sort(byLabel),
  };
}

export const emptyFilterOptions: MetaFilterOptions = {
  campaigns: [],
  adsets: [],
  ads: [],
  objectives: [],
};

export function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  sort: MetaFilters["sort"] = "spend",
  dir: MetaFilters["dir"] = "desc"
): T[] {
  const keys =
    sort === "name"
      ? ["ad_name", "campaign_name", "adset_name", "action_type"]
      : [sort ?? "spend"];
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    for (const field of keys) {
      const av = a[field];
      const bv = b[field];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        const cmp = av.localeCompare(bv);
        if (cmp !== 0) return cmp * (sort === "name" ? 1 : sign);
        continue;
      }
      const cmp = Number(av) - Number(bv);
      if (cmp !== 0) return cmp * sign;
    }
    return 0;
  });
}
