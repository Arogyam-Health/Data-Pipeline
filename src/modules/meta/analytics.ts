import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/config/env";
import { DASHBOARD_MAX_PAGE_SIZE } from "./constants";
import { getAccount } from "./repository";
import { getMetaEnv } from "./env";
import {
  emptyFilterOptions,
  groupFilterOptions,
  hasSqlFilters,
  sortRows,
  toRpcFilters,
  type MetaFilterOptionRow,
  type MetaFilters,
} from "./filters";

function getAnalyticsClient() {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "analytics" },
  });
}

export interface MetaDateRange {
  from: string;
  to: string;
}

function isMissingRpc(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return /PGRST202|42883|could not find the function/i.test(`${error.code ?? ""} ${error.message ?? ""}`);
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T[]> {
  const analytics = getAnalyticsClient();
  const { data, error } = await analytics.rpc(name, params);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

async function rpcFiltered<T>(
  filteredName: string,
  unfilteredName: string,
  range: MetaDateRange,
  filters: MetaFilters = {}
): Promise<{ rows: T[]; usedFilters: boolean }> {
  const analytics = getAnalyticsClient();
  const { data, error } = await analytics.rpc(filteredName, {
    p_from: range.from,
    p_to: range.to,
    ...toRpcFilters(filters),
  });
  if (!error) return { rows: (data ?? []) as T[], usedFilters: true };
  if (isMissingRpc(error)) {
    const rows = await rpc<T>(unfilteredName, { p_from: range.from, p_to: range.to });
    return { rows, usedFilters: false };
  }
  throw new Error(error.message);
}

const emptyKpis = {
  spend: 0,
  impressions: 0,
  reach: 0,
  frequency: null as number | null,
  clicks: 0,
  link_clicks: 0,
  landing_page_views: 0,
  ctr: null as number | null,
  link_ctr: null as number | null,
  cpc: null as number | null,
  cpm: null as number | null,
  adds_to_cart: 0,
  checkouts: 0,
  purchases: 0,
  cost_per_add_to_cart: null as number | null,
  cost_per_checkout: null as number | null,
  cost_per_purchase: null as number | null,
  purchase_value: 0,
  roas: null as number | null,
  website_purchases: 0,
  messaging_conversations: 0,
  registrations: 0,
};

export async function loadMetaKpis(range: MetaDateRange, filters: MetaFilters = {}) {
  const { rows } = await rpcFiltered<typeof emptyKpis>(
    "meta_ads_kpis_filtered",
    "meta_ads_kpis_for_range",
    range,
    filters
  );
  return rows[0] ?? emptyKpis;
}

export async function loadMetaDaily(range: MetaDateRange, filters: MetaFilters = {}) {
  const { rows } = await rpcFiltered("meta_ads_daily_filtered", "meta_ads_daily_for_range", range, filters);
  return rows;
}

export async function loadMetaCampaigns(range: MetaDateRange, filters: MetaFilters = {}) {
  const { rows } = await rpcFiltered(
    "meta_campaign_performance_filtered",
    "meta_campaign_performance_for_range",
    range,
    filters
  );
  return sortRows(rows as Array<Record<string, unknown>>, filters.sort, filters.dir);
}

export async function loadMetaAdsets(range: MetaDateRange, filters: MetaFilters = {}) {
  const { rows } = await rpcFiltered(
    "meta_adset_performance_filtered",
    "meta_adset_performance_for_range",
    range,
    filters
  );
  return sortRows(rows as Array<Record<string, unknown>>, filters.sort, filters.dir);
}

export async function loadMetaAds(range: MetaDateRange, filters: MetaFilters = {}) {
  const { rows } = await rpcFiltered(
    "meta_ad_performance_filtered",
    "meta_ad_performance_for_range",
    range,
    filters
  );
  return sortRows(rows as Array<Record<string, unknown>>, filters.sort, filters.dir);
}

export async function loadMetaFunnel(range: MetaDateRange, filters: MetaFilters = {}) {
  const { rows } = await rpcFiltered("meta_ads_funnel_filtered", "meta_ads_funnel_for_range", range, filters);
  return rows[0] ?? null;
}

export async function loadMetaVideo(range: MetaDateRange, filters: MetaFilters = {}) {
  const { rows } = await rpcFiltered("meta_ads_video_filtered", "meta_ads_video_for_range", range, filters);
  return sortRows(rows as Array<Record<string, unknown>>, filters.sort === "name" ? "name" : undefined, filters.dir);
}

export async function loadMetaActions(range: MetaDateRange, filters: MetaFilters = {}) {
  const { rows } = await rpcFiltered(
    "meta_ads_action_performance_filtered",
    "meta_ads_action_performance_for_range",
    range,
    filters
  );
  return sortRows(rows as Array<Record<string, unknown>>, filters.sort === "name" ? "name" : undefined, filters.dir);
}

export async function loadMetaPlacements(range: MetaDateRange) {
  return rpc("meta_ads_placement_for_range", { p_from: range.from, p_to: range.to });
}

export async function loadMetaDevices(range: MetaDateRange) {
  return rpc("meta_ads_device_for_range", { p_from: range.from, p_to: range.to });
}

export async function loadMetaDemographics(range: MetaDateRange) {
  return rpc("meta_ads_demographic_for_range", { p_from: range.from, p_to: range.to });
}

export async function loadMetaGeo(range: MetaDateRange) {
  return rpc("meta_ads_geo_for_range", { p_from: range.from, p_to: range.to });
}

export async function loadMetaFilterOptions(range: MetaDateRange) {
  try {
    const rows = await rpc<MetaFilterOptionRow>("meta_ads_filter_options", {
      p_from: range.from,
      p_to: range.to,
    });
    return groupFilterOptions(rows);
  } catch {
    return emptyFilterOptions;
  }
}

export async function loadMetaSyncHealth() {
  const analytics = getAnalyticsClient();
  const { data, error } = await analytics.from("meta_ads_sync_health").select("*").limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function loadMetaAccount() {
  try {
    return await getAccount(getMetaEnv().META_AD_ACCOUNT_ID);
  } catch {
    return null;
  }
}

export async function loadMetaOverview(range: MetaDateRange, filters: MetaFilters = {}) {
  const [kpis, daily, campaigns, adsets, ads, funnel, video, actions, health, account, filterOptions] =
    await Promise.all([
      loadMetaKpis(range, filters),
      loadMetaDaily(range, filters),
      loadMetaCampaigns(range, filters),
      loadMetaAdsets(range, filters),
      loadMetaAds(range, filters),
      loadMetaFunnel(range, filters),
      loadMetaVideo(range, filters),
      loadMetaActions(range, filters),
      loadMetaSyncHealth(),
      loadMetaAccount(),
      loadMetaFilterOptions(range),
    ]);

  const filterSqlReady = filterOptions.campaigns.length > 0 || filterOptions.objectives.length > 0;
  const options = filterSqlReady
    ? filterOptions
    : groupFilterOptions([
          ...campaigns.map((row) => ({
            kind: "campaign",
            id: String(row.campaign_id ?? ""),
            label: String(row.campaign_name ?? row.campaign_id ?? ""),
            campaign_id: String(row.campaign_id ?? ""),
            adset_id: null,
          })),
          ...adsets.map((row) => ({
            kind: "adset",
            id: String(row.adset_id ?? ""),
            label: String(row.adset_name ?? row.adset_id ?? ""),
            campaign_id: String(row.campaign_id ?? ""),
            adset_id: String(row.adset_id ?? ""),
          })),
          ...ads.map((row) => ({
            kind: "ad",
            id: String(row.ad_id ?? ""),
            label: String(row.ad_name ?? row.ad_id ?? ""),
            campaign_id: String(row.campaign_id ?? ""),
            adset_id: String(row.adset_id ?? ""),
          })),
        ]);

  return {
    kpis,
    daily,
    campaigns,
    adsets,
    ads,
    funnel,
    video,
    actions,
    syncHealth: health,
    account,
    filterOptions: options,
    filtersApplied: hasSqlFilters(filters),
    filterSqlReady,
    breakdownsEnabled: process.env.META_BREAKDOWN_SYNC_ENABLED === "true",
    metadataEnabled: process.env.META_METADATA_SYNC_ENABLED === "true",
  };
}

export function clampPageSize(pageSize: number): number {
  return Math.min(Math.max(1, pageSize), DASHBOARD_MAX_PAGE_SIZE);
}

export function paginate<T>(rows: T[], page: number, pageSize: number): { rows: T[]; total: number } {
  const size = clampPageSize(pageSize);
  const start = Math.max(0, (page - 1) * size);
  return { rows: rows.slice(start, start + size), total: rows.length };
}
