import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/config/env";
import { DASHBOARD_MAX_PAGE_SIZE } from "./constants";
import { getGa4Env, getGa4PropertyId } from "./env";
import { getProperty } from "./repository";
import { getSyncStatus } from "./sync";

function getAnalyticsClient() {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "analytics" },
  });
}

export interface Ga4DateRange {
  from: string;
  to: string;
}

export interface Ga4AnalyticsQuery {
  channel?: string;
  source?: string;
  campaign?: string;
  medium?: string;
  content?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T[]> {
  const analytics = getAnalyticsClient();
  const { data, error } = await analytics.rpc(name, params);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

async function rpcValue<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const analytics = getAnalyticsClient();
  const { data, error } = await analytics.rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

export function clampPageSize(size?: number, fallback = 50): number {
  const value = size ?? fallback;
  return Math.min(Math.max(1, value), DASHBOARD_MAX_PAGE_SIZE);
}

const emptyOverview = {
  sessions: 0,
  engaged_sessions: 0,
  engagement_rate: null as number | null,
  bounce_rate: null as number | null,
  users: 0,
  new_users: 0,
  views: 0,
  add_to_carts: 0,
  items_added_to_cart: 0,
  begin_checkout: 0,
  purchases: 0,
  revenue: 0,
};

export async function loadGa4Overview(range: Ga4DateRange) {
  const rows = await rpc<typeof emptyOverview>("ga4_overview_range", {
    p_from: range.from,
    p_to: range.to,
  });
  return rows[0] ?? emptyOverview;
}

export async function loadGa4Daily(range: Ga4DateRange) {
  return rpc("ga4_daily_range", { p_from: range.from, p_to: range.to });
}

export async function loadGa4Funnel(range: Ga4DateRange) {
  const rows = await rpc("ga4_funnel_range", { p_from: range.from, p_to: range.to });
  return rows[0] ?? null;
}

export async function loadGa4Channels(range: Ga4DateRange, query: Ga4AnalyticsQuery = {}) {
  const pageSize = clampPageSize(query.pageSize, 100);
  const page = query.page ?? 1;
  const offset = (page - 1) * pageSize;
  const [rows, total, options] = await Promise.all([
    rpc("ga4_channel_performance_range", {
      p_from: range.from,
      p_to: range.to,
      p_channel: query.channel ?? null,
      p_sort: query.sort ?? "revenue",
      p_dir: query.dir ?? "desc",
      p_limit: pageSize,
      p_offset: offset,
    }),
    rpcValue<number>("ga4_channel_performance_count", {
      p_from: range.from,
      p_to: range.to,
      p_channel: query.channel ?? null,
    }),
    rpc<{ channel: string }>("ga4_channel_filter_options", {
      p_from: range.from,
      p_to: range.to,
    }),
  ]);
  return { rows, total: Number(total ?? 0), page, pageSize, options };
}

export async function loadGa4Utm(range: Ga4DateRange, query: Ga4AnalyticsQuery = {}) {
  const pageSize = clampPageSize(query.pageSize, 50);
  const page = query.page ?? 1;
  const offset = (page - 1) * pageSize;
  const [rows, total, options] = await Promise.all([
    rpc("ga4_utm_performance_range", {
      p_from: range.from,
      p_to: range.to,
      p_source: query.source ?? null,
      p_campaign: query.campaign ?? null,
      p_medium: query.medium ?? null,
      p_content: query.content ?? null,
      p_sort: query.sort ?? "revenue",
      p_dir: query.dir ?? "desc",
      p_limit: pageSize,
      p_offset: offset,
    }),
    rpcValue<number>("ga4_utm_performance_count", {
      p_from: range.from,
      p_to: range.to,
      p_source: query.source ?? null,
      p_campaign: query.campaign ?? null,
      p_medium: query.medium ?? null,
      p_content: query.content ?? null,
    }),
    rpc<{ kind: string; value: string }>("ga4_utm_filter_options", {
      p_from: range.from,
      p_to: range.to,
    }),
  ]);
  return { rows, total: Number(total ?? 0), page, pageSize, options };
}

export async function loadGa4SyncHealth() {
  return getSyncStatus();
}

export async function loadGa4DashboardBundle(range: Ga4DateRange, query: Ga4AnalyticsQuery = {}) {
  const env = getGa4Env();
  const [kpis, daily, funnel, channels, utm, syncHealth] = await Promise.all([
    loadGa4Overview(range),
    loadGa4Daily(range),
    loadGa4Funnel(range),
    loadGa4Channels(range, query),
    loadGa4Utm(range, query),
    loadGa4SyncHealth(),
  ]);
  const property = await getProperty(getGa4PropertyId(env));
  return {
    kpis,
    daily,
    funnel,
    channels,
    utm,
    syncHealth,
    property,
  };
}

export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}
