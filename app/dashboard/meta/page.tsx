"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface OverviewData {
  range: { from: string; to: string };
  kpis: {
    spend: number;
    impressions: number;
    reach: number;
    frequency: number | null;
    clicks: number;
    link_clicks: number;
    landing_page_views: number;
    ctr: number | null;
    link_ctr: number | null;
    cpc: number | null;
    cpm: number | null;
    adds_to_cart: number;
    checkouts: number;
    purchases: number;
    cost_per_purchase: number | null;
    purchase_value: number;
    roas: number | null;
  };
  daily: Array<{ date: string; spend: number; purchases: number; purchase_value: number; roas: number | null }>;
  filterOptions?: {
    campaigns: Array<{ id: string; label: string }>;
    adsets: Array<{ id: string; label: string; campaign_id: string | null }>;
    ads: Array<{ id: string; label: string; campaign_id: string | null; adset_id: string | null }>;
    objectives: Array<{ id: string; label: string }>;
  };
  filtersApplied?: boolean;
  filterSqlReady?: boolean;
  campaigns: Array<{
    campaign_id: string;
    campaign_name: string;
    spend: number;
    impressions: number;
    ctr: number | null;
    landing_page_views: number;
    adds_to_cart: number;
    checkouts: number;
    purchases: number;
    cost_per_purchase: number | null;
    purchase_value: number;
    roas: number | null;
  }>;
  adsets: Array<{
    campaign_id?: string;
    campaign_name: string;
    adset_id: string;
    adset_name: string;
    spend: number;
    impressions: number;
    ctr: number | null;
    landing_page_views: number;
    adds_to_cart: number;
    checkouts: number;
    purchases: number;
    cost_per_purchase: number | null;
    purchase_value: number;
    roas: number | null;
  }>;
  ads: Array<{
    campaign_id?: string;
    campaign_name: string;
    adset_id?: string;
    adset_name: string;
    ad_id: string;
    ad_name: string;
    spend: number;
    frequency: number | null;
    ctr: number | null;
    landing_page_views: number;
    adds_to_cart: number;
    checkouts: number;
    purchases: number;
    cost_per_purchase: number | null;
    roas: number | null;
  }>;
  funnel: {
    impressions: number;
    clicks: number;
    landing_page_views: number;
    adds_to_cart: number;
    checkouts: number;
    purchases: number;
    ctr: number | null;
    lpv_rate: number | null;
    atc_rate: number | null;
    checkout_rate: number | null;
    purchase_rate: number | null;
  } | null;
  video: Array<{
    ad_id: string;
    ad_name: string;
    video_plays: number;
    video_plays_25: number;
    video_plays_50: number;
    video_plays_75: number;
    video_plays_95: number;
    video_plays_100: number;
    thruplays: number;
    video_avg_play_time: number | null;
    retention_25: number | null;
    retention_50: number | null;
    retention_95: number | null;
  }>;
  actions: Array<{
    action_type: string;
    total_actions: number;
    ads_with_action: number;
    campaigns_with_action: number;
    first_seen: string;
    last_seen: string;
    conversion_value: number;
  }>;
  syncHealth: {
    last_successful_today_sync_at: string | null;
    last_successful_recent_repair_at: string | null;
    last_backfill_completed_at: string | null;
    last_duration_seconds: number | null;
    last_rows_fetched: number | null;
    last_pages_fetched: number | null;
    last_retry_count: number | null;
    last_error_code: string | null;
    last_error_message: string | null;
    backfill_status: string | null;
    account_currency: string | null;
    account_timezone: string | null;
  } | null;
  account: { currency: string | null; timezone_name: string | null } | null;
  breakdownsEnabled: boolean;
}

function money(n: number | null | undefined, currency = "INR"): string {
  return `${currency} ${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function num(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(Number(n) * 100).toFixed(2)}%`;
}

type SortKey = "spend" | "purchases" | "roas" | "ctr" | "frequency" | "name";

function setParam(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
}

type DatePreset =
  | "today"
  | "yesterday"
  | "today_yesterday"
  | "last_7d"
  | "last_14d"
  | "last_28d"
  | "last_30d"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "maximum"
  | "custom";

function formatDisplayDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function getPresetRange(preset: DatePreset, todayIso: string): { from: string; to: string; label: string } {
  const addDaysInner = (iso: string, n: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const today = todayIso;
  const yesterday = addDaysInner(today, -1);
  const startOfWeek = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    const day = d.getUTCDay(); // 0 Sun
    const diff = day === 0 ? -6 : 1 - day; // Monday start like Meta
    return addDaysInner(iso, diff);
  };
  const startOfMonth = (iso: string) => iso.slice(0, 7) + "-01";
  const endOfMonth = (iso: string) => {
    const [y, m] = iso.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  };
  const lastMonthIso = addDaysInner(startOfMonth(today), -1);
  switch (preset) {
    case "today":
      return { from: today, to: today, label: `Today: ${formatDisplayDate(today)}` };
    case "yesterday":
      return { from: yesterday, to: yesterday, label: `Yesterday: ${formatDisplayDate(yesterday)}` };
    case "today_yesterday":
      return { from: yesterday, to: today, label: `${formatDisplayDate(yesterday)} - ${formatDisplayDate(today)}` };
    case "last_7d":
      return { from: addDaysInner(today, -6), to: today, label: `Last 7 days: ${formatDisplayDate(addDaysInner(today, -6))} - ${formatDisplayDate(today)}` };
    case "last_14d":
      return { from: addDaysInner(today, -13), to: today, label: `Last 14 days` };
    case "last_28d":
      return { from: addDaysInner(today, -27), to: today, label: `Last 28 days` };
    case "last_30d":
      return { from: addDaysInner(today, -29), to: today, label: `Last 30 days` };
    case "this_week":
      return { from: startOfWeek(today), to: today, label: `This week` };
    case "last_week": {
      const s = startOfWeek(today);
      const prevS = addDaysInner(s, -7);
      const prevE = addDaysInner(s, -1);
      return { from: prevS, to: prevE, label: `Last week` };
    }
    case "this_month":
      return { from: startOfMonth(today), to: today, label: `This month` };
    case "last_month": {
      const s = startOfMonth(lastMonthIso);
      const e = endOfMonth(lastMonthIso);
      return { from: s, to: e, label: `Last month` };
    }
    case "maximum":
      return { from: addDaysInner(today, -89), to: today, label: `Maximum (90 days)` };
    case "custom":
    default:
      return { from: today, to: today, label: "Custom" };
  }
}

function CalendarGrid({ monthIso, from, to, onPick }: { monthIso: string; from: string; to: string; onPick: (iso: string) => void }) {
  const [y, m] = monthIso.split("-").map(Number);
  const firstDay = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const cells: (string | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return (
    <div style={{ width: "224px", flexShrink: 0 }}>
      <div style={{ textAlign: "center", fontWeight: 600, marginBottom: "8px", fontSize: "14px" }}>{monthLabel}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "1px", fontSize: "11px", color: "#6b7280", marginBottom: "4px" }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} style={{ textAlign: "center", padding: "2px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "1px" }}>
        {cells.map((iso, i) =>
          iso ? (
            <button
              key={iso}
              onClick={() => onPick(iso)}
              style={{
                height: "28px",
                minWidth: "28px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: iso >= from && iso <= to ? 600 : 400,
                background: iso >= from && iso <= to ? "#2563eb" : "transparent",
                color: iso >= from && iso <= to ? "white" : "#1f2937",
                border: iso === from || iso === to ? "1px solid #1e40af" : "1px solid transparent",
                lineHeight: "28px",
                padding: 0,
                margin: 0,
              }}
            >
              {Number(iso.slice(8, 10))}
            </button>
          ) : (
            <div key={`e-${i}`} style={{ height: "28px" }} />
          )
        )}
      </div>
    </div>
  );
}

export default function MetaDashboard() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [preset, setPreset] = useState<DatePreset>("last_30d");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const initial = getPresetRange("last_30d", todayIso);
  const [customFrom, setCustomFrom] = useState(initial.from);
  const [customTo, setCustomTo] = useState(initial.to);
  const [compare, setCompare] = useState(false);
  const [comparePreset, setComparePreset] = useState("previous_period");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [adsetId, setAdsetId] = useState("");
  const [adId, setAdId] = useState("");
  const [objective, setObjective] = useState("");
  const [purchaseStatus, setPurchaseStatus] = useState("all");
  const [videoStatus, setVideoStatus] = useState("all");
  const [funnelStatus, setFunnelStatus] = useState("all");
  const [messagingStatus, setMessagingStatus] = useState("all");
  const [minSpend, setMinSpend] = useState("");
  const [maxSpend, setMaxSpend] = useState("");
  const [minRoas, setMinRoas] = useState("");
  const [maxRoas, setMaxRoas] = useState("");
  const [minFrequency, setMinFrequency] = useState("");
  const [maxFrequency, setMaxFrequency] = useState("");
  const [minPurchases, setMinPurchases] = useState("");
  const [sort, setSort] = useState<SortKey>("spend");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [actionSearch, setActionSearch] = useState("");
  const [data, setData] = useState<OverviewData | null>(null);
  const [placements, setPlacements] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const presetRange = useMemo(() => getPresetRange(preset, todayIso), [preset, todayIso]);
  // when preset changes, sync customFrom/To except custom keeps manual
  useEffect(() => {
    if (preset !== "custom") {
      const r = getPresetRange(preset, todayIso);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
  }, [preset, todayIso]);

  const query = useMemo(() => {
    // map preset to legacy range param for API compatibility
    const legacyRange = preset === "today" ? "today" : preset === "maximum" ? "90d" : preset === "last_7d" ? "7d" : preset === "last_30d" ? "30d" : preset === "last_14d" ? "custom" : preset === "last_28d" ? "custom" : "custom";
    const params = new URLSearchParams({ range: legacyRange });
    if (customFrom && customTo) {
      params.set("from", customFrom);
      params.set("to", customTo);
    }
    setParam(params, "search", search);
    setParam(params, "campaignId", campaignId);
    setParam(params, "adsetId", adsetId);
    setParam(params, "adId", adId);
    setParam(params, "objective", objective);
    if (purchaseStatus !== "all") params.set("purchaseStatus", purchaseStatus);
    if (videoStatus !== "all") params.set("videoStatus", videoStatus);
    if (funnelStatus !== "all") params.set("funnelStatus", funnelStatus);
    if (messagingStatus !== "all") params.set("messagingStatus", messagingStatus);
    setParam(params, "minSpend", minSpend);
    setParam(params, "maxSpend", maxSpend);
    setParam(params, "minRoas", minRoas);
    setParam(params, "maxRoas", maxRoas);
    setParam(params, "minFrequency", minFrequency);
    setParam(params, "maxFrequency", maxFrequency);
    setParam(params, "minPurchases", minPurchases);
    if (sort !== "spend") params.set("sort", sort);
    if (dir !== "desc") params.set("dir", dir);
    return params.toString();
  }, [
    preset,
    customFrom,
    customTo,
    search,
    campaignId,
    adsetId,
    adId,
    objective,
    purchaseStatus,
    videoStatus,
    funnelStatus,
    messagingStatus,
    minSpend,
    maxSpend,
    minRoas,
    maxRoas,
    minFrequency,
    maxFrequency,
    minPurchases,
    sort,
    dir,
  ]);

  async function load(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    try {
      const [overviewRes, placementRes] = await Promise.all([
        fetch(`/api/meta/analytics/overview?${query}`, { credentials: "include" }),
        fetch(`/api/meta/analytics/placements?${query}`, { credentials: "include" }),
      ]);
      if (!overviewRes.ok) {
        const body = (await overviewRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Failed to load Meta analytics");
      }
      const overview = await overviewRes.json();
      setData(overview);
      if (placementRes.ok) {
        const body = await placementRes.json();
        setPlacements(body.placements ?? []);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load({ silent: true });
    }, 60_000);
    return () => clearInterval(interval);
  }, [query]);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Loading Meta dashboard...</h1>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Meta dashboard error</h1>
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const options = data.filterOptions ?? { campaigns: [], adsets: [], ads: [], objectives: [] };
  const visibleAdsets = options.adsets.filter((row) => !campaignId || row.campaign_id === campaignId);
  const visibleAds = options.ads.filter(
    (row) => (!campaignId || row.campaign_id === campaignId) && (!adsetId || row.adset_id === adsetId)
  );
  const activeFilters = [
    search && { key: "search", label: `Search: ${search}` },
    campaignId && { key: "campaignId", label: `Campaign: ${options.campaigns.find((row) => row.id === campaignId)?.label || campaignId}` },
    adsetId && { key: "adsetId", label: `Ad set: ${options.adsets.find((row) => row.id === adsetId)?.label || adsetId}` },
    adId && { key: "adId", label: `Ad: ${options.ads.find((row) => row.id === adId)?.label || adId}` },
    objective && { key: "objective", label: `Objective: ${objective}` },
    purchaseStatus !== "all" && { key: "purchaseStatus", label: `Purchases: ${purchaseStatus}` },
    videoStatus !== "all" && { key: "videoStatus", label: "Has video" },
    funnelStatus !== "all" && { key: "funnelStatus", label: `Funnel: ${funnelStatus.replace("has_", "")}` },
    messagingStatus !== "all" && { key: "messagingStatus", label: `Messaging: ${messagingStatus}` },
    minSpend && { key: "minSpend", label: `Min spend ${minSpend}` },
    maxSpend && { key: "maxSpend", label: `Max spend ${maxSpend}` },
    minRoas && { key: "minRoas", label: `Min ROAS ${minRoas}` },
    maxRoas && { key: "maxRoas", label: `Max ROAS ${maxRoas}` },
    minFrequency && { key: "minFrequency", label: `Min freq ${minFrequency}` },
    maxFrequency && { key: "maxFrequency", label: `Max freq ${maxFrequency}` },
    minPurchases && { key: "minPurchases", label: `Min purchases ${minPurchases}` },
  ].filter(Boolean) as Array<{ key: string; label: string }>;
  const filtersActive = activeFilters.length > 0;
  const noRows = Number(data.kpis.spend) === 0 && data.campaigns.length === 0;
  const visibleActions = actionSearch
    ? data.actions.filter((row) => row.action_type.toLowerCase().includes(actionSearch.toLowerCase()))
    : data.actions;

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setCampaignId("");
    setAdsetId("");
    setAdId("");
    setObjective("");
    setPurchaseStatus("all");
    setVideoStatus("all");
    setFunnelStatus("all");
    setMessagingStatus("all");
    setMinSpend("");
    setMaxSpend("");
    setMinRoas("");
    setMaxRoas("");
    setMinFrequency("");
    setMaxFrequency("");
    setMinPurchases("");
    setSort("spend");
    setDir("desc");
    setActionSearch("");
  }

  function clearOne(key: string) {
    if (key === "search") {
      setSearchInput("");
      setSearch("");
    }
    if (key === "campaignId") {
      setCampaignId("");
      setAdsetId("");
      setAdId("");
    }
    if (key === "adsetId") {
      setAdsetId("");
      setAdId("");
    }
    if (key === "adId") setAdId("");
    if (key === "objective") setObjective("");
    if (key === "purchaseStatus") setPurchaseStatus("all");
    if (key === "videoStatus") setVideoStatus("all");
    if (key === "funnelStatus") setFunnelStatus("all");
    if (key === "messagingStatus") setMessagingStatus("all");
    if (key === "minSpend") setMinSpend("");
    if (key === "maxSpend") setMaxSpend("");
    if (key === "minRoas") setMinRoas("");
    if (key === "maxRoas") setMaxRoas("");
    if (key === "minFrequency") setMinFrequency("");
    if (key === "maxFrequency") setMaxFrequency("");
    if (key === "minPurchases") setMinPurchases("");
  }

  function filterCampaign(id: string) {
    setCampaignId(id);
    setAdsetId("");
    setAdId("");
  }

  function filterAdset(nextCampaignId: string | undefined, nextAdsetId: string) {
    if (nextCampaignId) setCampaignId(nextCampaignId);
    setAdsetId(nextAdsetId);
    setAdId("");
  }

  function filterAd(nextCampaignId: string | undefined, nextAdsetId: string | undefined, nextAdId: string) {
    if (nextCampaignId) setCampaignId(nextCampaignId);
    if (nextAdsetId) setAdsetId(nextAdsetId);
    setAdId(nextAdId);
  }

  function toggleSort(key: SortKey) {
    if (sort === key) {
      setDir((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSort(key);
    setDir(key === "name" ? "asc" : "desc");
  }

  function sortLabel(key: SortKey, label: string) {
    if (sort !== key) return label;
    return `${label} ${dir === "asc" ? "↑" : "↓"}`;
  }

  const currency = data.account?.currency || data.syncHealth?.account_currency || "INR";
  const kpis = [
    { label: "Spend", value: money(data.kpis.spend, currency), color: "bg-blue-500" },
    { label: "Impressions", value: num(data.kpis.impressions, 0), color: "bg-green-500" },
    { label: "Reach", value: num(data.kpis.reach, 0), color: "bg-purple-500" },
    { label: "Frequency", value: num(data.kpis.frequency), color: "bg-orange-500" },
    { label: "Link Clicks", value: num(data.kpis.link_clicks, 0), color: "bg-blue-500" },
    { label: "Landing Page Views", value: num(data.kpis.landing_page_views, 0), color: "bg-green-500" },
    { label: "CTR", value: pct(data.kpis.ctr), color: "bg-purple-500" },
    { label: "CPC", value: money(data.kpis.cpc, currency), color: "bg-orange-500" },
    { label: "CPM", value: money(data.kpis.cpm, currency), color: "bg-blue-500" },
    { label: "Adds To Cart", value: num(data.kpis.adds_to_cart, 0), color: "bg-green-500" },
    { label: "Checkouts", value: num(data.kpis.checkouts, 0), color: "bg-purple-500" },
    { label: "Purchases", value: num(data.kpis.purchases, 0), color: "bg-orange-500" },
    { label: "Cost Per Purchase", value: money(data.kpis.cost_per_purchase, currency), color: "bg-blue-500" },
    { label: "Purchase Value", value: money(data.kpis.purchase_value, currency), color: "bg-green-500" },
    { label: "ROAS", value: num(data.kpis.roas), color: "bg-purple-500" },
  ];

  const funnelRows = data.funnel
    ? [
        { name: "Impressions", value: data.funnel.impressions },
        { name: "Clicks", value: data.funnel.clicks },
        { name: "LPV", value: data.funnel.landing_page_views },
        { name: "ATC", value: data.funnel.adds_to_cart },
        { name: "Checkout", value: data.funnel.checkouts },
        { name: "Purchase", value: data.funnel.purchases },
      ]
    : [];

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-full mx-auto">
        <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold">Meta Ads Analytics</h1>
            <p className="text-gray-600 mt-2">
              <Link href="/dashboard">Shiprocket</Link>
              {" · "}
              <Link href="/dashboard/shiprocket">Explorer</Link>
              {" · "}
              <Link href="/dashboard/shopify">Shopify</Link>
              {" · "}
              <strong>Meta</strong>
              {" · "}
              <Link href="/dashboard/ga4">GA4</Link>
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Reads Supabase only. Currency {currency}
              {data.syncHealth?.account_timezone ? ` · timezone ${data.syncHealth.account_timezone}` : ""}.
              {" "}Auto-refreshes every 60s.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCalendarOpen((v) => !v)}
              className="px-4 py-2 bg-white rounded shadow border flex items-center gap-2"
            >
              <span>📅</span>
              <span>{preset === "custom" ? `${formatDisplayDate(customFrom)} - ${formatDisplayDate(customTo)}` : getPresetRange(preset, todayIso).label}</span>
              <span className="text-gray-400">▼</span>
            </button>
            {calendarOpen && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "12px" }} onClick={() => setCalendarOpen(false)}>
                <div className="meta-modal" style={{ background: "white", borderRadius: "12px", padding: "16px", width: "800px", maxWidth: "95vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                <div className="meta-calendar-row" style={{ display: "flex", gap: "16px" }}>
                  <div style={{ width: "180px", fontSize: "14px", borderRight: "1px solid #e5e7eb", paddingRight: "12px" }}>
                    {[
                      ["today", "Today"],
                      ["yesterday", "Yesterday"],
                      ["today_yesterday", "Today and yesterday"],
                      ["last_7d", "Last 7 days"],
                      ["last_14d", "Last 14 days"],
                      ["last_28d", "Last 28 days"],
                      ["last_30d", "Last 30 days"],
                      ["this_week", "This week"],
                      ["last_week", "Last week"],
                      ["this_month", "This month"],
                      ["last_month", "Last month"],
                      ["maximum", "Maximum"],
                      ["custom", "Custom"],
                    ].map(([v, l]) => (
                      <label key={v} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 4px", cursor: "pointer" }}>
                        <input type="radio" checked={preset === v} onChange={() => setPreset(v as DatePreset)} />
                        <span>{l}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="meta-calendar-row" style={{ display: "flex", gap: "24px", justifyContent: "center", flexWrap: "wrap" }}>
                      <CalendarGrid
                        monthIso={customFrom.slice(0, 7)}
                        from={customFrom}
                        to={customTo}
                        onPick={(iso) => {
                          if (preset !== "custom") setPreset("custom");
                          if (iso < customFrom || Math.abs(new Date(iso).getTime() - new Date(customFrom).getTime()) < Math.abs(new Date(iso).getTime() - new Date(customTo).getTime())) setCustomFrom(iso);
                          else setCustomTo(iso);
                          if (iso > customTo) setCustomTo(iso);
                        }}
                      />
                      <CalendarGrid
                        monthIso={(() => { const [y,m]=customFrom.slice(0,7).split("-").map(Number); const d=new Date(Date.UTC(y,m,1)); return d.toISOString().slice(0,7); })()}
                        from={customFrom}
                        to={customTo}
                        onPick={(iso) => {
                          if (preset !== "custom") setPreset("custom");
                          setCustomTo(iso);
                        }}
                      />
                    </div>
                    <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "8px", borderTop: "1px solid #e5e7eb", paddingTop: "12px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
                        <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                        Compare
                      </label>
                      <select value={comparePreset} onChange={(e) => setComparePreset(e.target.value)} style={{ fontSize: "13px", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "6px 8px", flex: 1 }} disabled={!compare}>
                        <option value="previous_period">Previous period</option>
                        <option value="previous_year">Previous year</option>
                      </select>
                      <input type="date" value={customFrom} onChange={(e) => { setPreset("custom"); setCustomFrom(e.target.value); }} style={{ fontSize: "13px", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "6px" }} />
                      <span>-</span>
                      <input type="date" value={customTo} onChange={(e) => { setPreset("custom"); setCustomTo(e.target.value); }} style={{ fontSize: "13px", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "6px" }} />
                    </div>
                    <p style={{ fontSize: "11px", color: "#6b7280", marginTop: "8px" }}>Dates are shown in Asia/Calcutta</p>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                      <button onClick={() => setCalendarOpen(false)} style={{ padding: "8px 16px", fontSize: "14px", border: "1px solid #e5e7eb", borderRadius: "6px", background: "white" }}>Cancel</button>
                      <button onClick={() => { setCalendarOpen(false); void load(); }} style={{ padding: "8px 16px", fontSize: "14px", background: "#2563eb", color: "white", borderRadius: "6px" }}>Update</button>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            )}
            <button onClick={() => void load()} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              Refresh
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 mb-8 shadow-lg">
          <div className="flex justify-between items-start mb-4 gap-4 flex-wrap">
            <div>
              <h3 className="text-lg font-semibold">Query filters</h3>
              <p className="text-sm text-gray-600 mt-2">
                Filters run in SQL against the selected date range. KPIs, charts, and tables all use the same set.
                Click a campaign, ad set, or ad name in a table to drill in.
              </p>
            </div>
            {filtersActive && (
              <button onClick={clearFilters} className="px-4 py-2 bg-gray-100 rounded">
                Clear filters
              </button>
            )}
          </div>
          <div className="filter-bar filter-bar-start mb-3">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or id"
              className="px-4 py-2 bg-white rounded"
            />
            <select
              value={campaignId}
              onChange={(e) => filterCampaign(e.target.value)}
              className="px-4 py-2 bg-white rounded"
            >
              <option value="">All campaigns</option>
              {options.campaigns.map((row) => (
                <option key={row.id} value={row.id}>{row.label}</option>
              ))}
            </select>
            <select
              value={adsetId}
              onChange={(e) => {
                const next = visibleAdsets.find((row) => row.id === e.target.value);
                filterAdset(next?.campaign_id || campaignId, e.target.value);
              }}
              className="px-4 py-2 bg-white rounded"
            >
              <option value="">All ad sets</option>
              {visibleAdsets.map((row) => (
                <option key={row.id} value={row.id}>{row.label}</option>
              ))}
            </select>
            <select
              value={adId}
              onChange={(e) => {
                const next = visibleAds.find((row) => row.id === e.target.value);
                filterAd(next?.campaign_id || campaignId, next?.adset_id || adsetId, e.target.value);
              }}
              className="px-4 py-2 bg-white rounded"
            >
              <option value="">All ads</option>
              {visibleAds.map((row) => (
                <option key={row.id} value={row.id}>{row.label}</option>
              ))}
            </select>
            <select value={objective} onChange={(e) => setObjective(e.target.value)} className="px-4 py-2 bg-white rounded">
              <option value="">All objectives</option>
              {options.objectives.map((row) => (
                <option key={row.id} value={row.id}>{row.label}</option>
              ))}
            </select>
            <select value={purchaseStatus} onChange={(e) => setPurchaseStatus(e.target.value)} className="px-4 py-2 bg-white rounded">
              <option value="all">All purchase status</option>
              <option value="with">Has purchases</option>
              <option value="without">No purchases</option>
            </select>
            <select value={videoStatus} onChange={(e) => setVideoStatus(e.target.value)} className="px-4 py-2 bg-white rounded">
              <option value="all">All creatives</option>
              <option value="has_video">Has video plays</option>
            </select>
            <select value={funnelStatus} onChange={(e) => setFunnelStatus(e.target.value)} className="px-4 py-2 bg-white rounded">
              <option value="all">All funnel stages</option>
              <option value="has_lpv">Has landing page views</option>
              <option value="has_atc">Has add to cart</option>
              <option value="has_checkout">Has checkout</option>
            </select>
            <select value={messagingStatus} onChange={(e) => setMessagingStatus(e.target.value)} className="px-4 py-2 bg-white rounded">
              <option value="all">All messaging</option>
              <option value="with">Has conversations</option>
              <option value="without">No conversations</option>
            </select>
            <input type="number" min="0" step="any" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} placeholder="Min spend" className="px-4 py-2 bg-white rounded" />
            <input type="number" min="0" step="any" value={maxSpend} onChange={(e) => setMaxSpend(e.target.value)} placeholder="Max spend" className="px-4 py-2 bg-white rounded" />
            <input type="number" min="0" step="any" value={minRoas} onChange={(e) => setMinRoas(e.target.value)} placeholder="Min ROAS" className="px-4 py-2 bg-white rounded" />
            <input type="number" min="0" step="any" value={maxRoas} onChange={(e) => setMaxRoas(e.target.value)} placeholder="Max ROAS" className="px-4 py-2 bg-white rounded" />
            <input type="number" min="0" step="any" value={minFrequency} onChange={(e) => setMinFrequency(e.target.value)} placeholder="Min frequency" className="px-4 py-2 bg-white rounded" />
            <input type="number" min="0" step="any" value={maxFrequency} onChange={(e) => setMaxFrequency(e.target.value)} placeholder="Max frequency" className="px-4 py-2 bg-white rounded" />
            <input type="number" min="0" step="any" value={minPurchases} onChange={(e) => setMinPurchases(e.target.value)} placeholder="Min purchases" className="px-4 py-2 bg-white rounded" />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="px-4 py-2 bg-white rounded">
              <option value="spend">Sort by spend</option>
              <option value="purchases">Sort by purchases</option>
              <option value="roas">Sort by ROAS</option>
              <option value="ctr">Sort by CTR</option>
              <option value="frequency">Sort by frequency</option>
              <option value="name">Sort by name</option>
            </select>
            <select value={dir} onChange={(e) => setDir(e.target.value as "asc" | "desc")} className="px-4 py-2 bg-white rounded">
              <option value="desc">High to low</option>
              <option value="asc">Low to high</option>
            </select>
          </div>
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {activeFilters.map((chip) => (
                <button key={chip.key} className="filter-chip" onClick={() => clearOne(chip.key)}>
                  {chip.label} ×
                </button>
              ))}
            </div>
          )}
        </div>

        {data.daily.length > 0 && (
          <div className="bg-white rounded-lg p-6 mb-8 shadow-lg">
            <p className="text-gray-600">
              In this date filter: {data.range.from} → {data.range.to}
              {" · "}
              {data.ads.length} matching ad{data.ads.length === 1 ? "" : "s"}
              {" · "}
              {data.daily.length} day{data.daily.length === 1 ? "" : "s"} with facts
              {" · "}
              last today sync {data.syncHealth?.last_successful_today_sync_at ?? "—"}
              {" · "}
              last recent repair {data.syncHealth?.last_successful_recent_repair_at ?? "not run yet"}
            </p>
            <p className="text-sm text-gray-600 mt-2">
              New and changing days keep arriving while <code>npm run dev</code> is running
              (<code>META_SYNC_ENABLED=true</code>): today every 15 minutes, recent 3 calendar days every 12 hours.
              A 90-day backfill is separate and resumable.
            </p>
          </div>
        )}

        {filtersActive && data.filterSqlReady === false && !noRows && (
          <div className="bg-white rounded-lg p-6 mb-8 shadow-lg">
            <h3 className="text-lg font-semibold mb-2">Filter SQL is not installed yet</h3>
            <p className="text-gray-600">
              Apply <code>supabase/migrations/017_meta_ads_filters.sql</code> in the Supabase SQL editor,
              then refresh. Until then, dropdowns still work for browsing but KPIs are not filtered in the database.
            </p>
          </div>
        )}

        {noRows && filtersActive && (
          <div className="bg-white rounded-lg p-6 mb-8 shadow-lg">
            <h3 className="text-lg font-semibold mb-2">No ads match these filters</h3>
            <p className="text-gray-600 mb-2">
              The selected date range has facts, but the current query filters exclude every ad.
              Clear one chip or reset the filter bar.
            </p>
            <button onClick={clearFilters} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              Clear filters
            </button>
          </div>
        )}

        {noRows && !filtersActive && (
          <div className="bg-white rounded-lg p-6 mb-8 shadow-lg">
            <h3 className="text-lg font-semibold mb-2">No Meta data in Supabase yet</h3>
            <p className="text-gray-600 mb-2">
              This page reads <code>data_pipeline.meta_ads_daily</code> only. It does not call the Meta API
              or the Google Sheet. Charts stay empty until a sync has written rows.
            </p>
            <p className="text-gray-600 mb-2">
              1. Put the existing Apps Script token and ad account id in <code>.env</code> as
              {" "}<code>META_ACCESS_TOKEN</code> and <code>META_AD_ACCOUNT_ID</code>.
            </p>
            <p className="text-gray-600 mb-2">
              2. Also set <code>META_INTERNAL_SYNC_SECRET</code>, then restart <code>npm run dev</code>.
            </p>
            <p className="text-gray-600">
              3. Run a one-day test sync, then refresh this page:
            </p>
            <pre className="bg-gray-100 p-4 mt-2 rounded text-sm overflow-x-auto">{`curl -X POST http://localhost:3000/api/internal/meta/sync/test \\
  -H "Authorization: Bearer <META_INTERNAL_SYNC_SECRET>" \\
  -H "Content-Type: application/json" \\
  -d '{"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}'`}</pre>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {kpis.map((card) => (
            <div key={card.label} className={`${card.color} rounded-lg p-6 text-white shadow-lg`}>
              <p className="text-sm opacity-90">{card.label}</p>
              <p className="text-3xl font-bold mt-2">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Daily spend / purchases / value / ROAS</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="spend" stroke="#0088FE" fill="#0088FE" />
                <Area type="monotone" dataKey="purchases" stroke="#00C49F" fill="#00C49F" />
                <Area type="monotone" dataKey="purchase_value" stroke="#FFBB28" fill="#FFBB28" />
                <Area type="monotone" dataKey="roas" stroke="#8884d8" fill="#8884d8" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Funnel</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={funnelRows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#0088FE" />
              </BarChart>
            </ResponsiveContainer>
            {data.funnel && (
              <p className="text-sm text-gray-600 mt-2">
                CTR {pct(data.funnel.ctr)} · LPV rate {pct(data.funnel.lpv_rate)} · ATC {pct(data.funnel.atc_rate)} ·
                Checkout {pct(data.funnel.checkout_rate)} · Purchase {pct(data.funnel.purchase_rate)}
              </p>
            )}
          </div>
        </div>

        <TableCard title="Campaign performance — matches Ads Manager Columns: Performance">
          <div className="flex gap-2 mb-3 text-xs">
            <span className="px-2 py-1 bg-blue-100 rounded">All ads</span>
            <span className="px-2 py-1 bg-gray-100 rounded">ROAS reporting</span>
            <span className="px-2 py-1 bg-gray-100 rounded">Had delivery</span>
            <span className="px-2 py-1 bg-gray-100 rounded">Active ads</span>
            <span className="ml-auto text-gray-500">Columns: Performance ▾ &nbsp; Breakdown ▾ &nbsp; ↕ &nbsp; ⬇ &nbsp; 🖼</span>
          </div>
          <table>
            <thead>
              <tr className="border-b text-xs">
                <th>Off</th>
                <th className="sortable" onClick={() => toggleSort("name")}>{sortLabel("name", "Campaign")}</th>
                <th>Delivery</th>
                <th className="text-right">Results</th>
                <th className="text-right">Cost per result</th>
                <th className="text-right">Budget</th>
                <th className="text-right sortable" onClick={() => toggleSort("spend")}>{sortLabel("spend", "Amount spent")}</th>
                <th className="text-right">Impressions</th>
                <th className="text-right">Reach</th>
                <th className="text-right">Frequency</th>
                <th className="text-right">CPM</th>
                <th className="text-right sortable" onClick={() => toggleSort("purchases")}>{sortLabel("purchases", "Purchases")}</th>
                <th className="text-right">Ends</th>
                <th className="text-right">Attribution</th>
                <th className="text-right">Bid strategy</th>
                <th className="text-right sortable" onClick={() => toggleSort("roas")}>{sortLabel("roas", "Purchase ROAS")}</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((row: any) => {
                const isActive = (row.delivery || row.effective_status || "").toLowerCase().includes("active");
                return (
                <tr key={row.campaign_id} className="border-b hover:bg-gray-50 text-sm">
                  <td><span className={`w-3 h-3 inline-block rounded-full ${isActive ? "bg-green-500" : "bg-gray-300"}`} title={row.delivery || row.status || "—"}></span></td>
                  <td>
                    <button className="filter-link text-blue-600 hover:underline text-left" onClick={() => filterCampaign(row.campaign_id)}>
                      {row.campaign_name}
                    </button>
                  </td>
                  <td><span className={isActive ? "text-green-700" : "text-gray-500"}>● {row.delivery || row.effective_status || row.status || "—"}</span></td>
                  <td className="text-right">{num((row as any).website_purchases ?? row.purchases, 0)}<div className="text-xs text-gray-500">Website purchases</div></td>
                  <td className="text-right">{money((row as any).website_purchases ? Number(row.spend)/(row as any).website_purchases : row.cost_per_purchase, currency)}<div className="text-xs text-gray-500">Per purchase</div></td>
                  <td className="text-right">{row.budget ? money(row.budget, currency) : row.daily_budget ? money(row.daily_budget, currency) : row.lifetime_budget ? money(row.lifetime_budget, currency) : <span title="needs meta_campaigns daily_budget">—</span>}</td>
                  <td className="text-right">{money(row.spend, currency)}</td>
                  <td className="text-right">{num(row.impressions, 0)}</td>
                  <td className="text-right">{row.reach != null ? num(row.reach, 0) : "—"}</td>
                  <td className="text-right">{(row as any).frequency != null ? num((row as any).frequency) : "—"}</td>
                  <td className="text-right">{(row as any).cpm != null ? money((row as any).cpm, currency) : row.impressions ? money(Number(row.spend) / Number(row.impressions) * 1000, currency) : "—"}</td>
                  <td className="text-right">{num((row as any).website_purchases ?? row.purchases, 0)}</td>
                  <td className="text-right">{row.ends ? new Date(row.ends).toLocaleDateString() : row.stop_time ? new Date(row.stop_time).toLocaleDateString() : "Ongoing"}</td>
                  <td className="text-right text-xs">{row.attribution_setting || "—"}</td>
                  <td className="text-right text-xs">—</td>
                  <td className="text-right">{num((row as any).website_roas ?? row.roas)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">Run <code>POST /api/internal/meta/sync/metadata</code> after <code>META_METADATA_SYNC_ENABLED=true</code> to populate Delivery/Budget/Ends/Bid. Attribution requires new migration 018.</p>
        </TableCard>

        <TableCard title="Ad set performance — Ad sets for 1 Campaign (with Landing Page Views)">
          <table>
            <thead>
              <tr className="border-b text-xs">
                <th>Campaign</th>
                <th className="sortable" onClick={() => toggleSort("name")}>{sortLabel("name", "Ad set")}</th>
                <th className="text-right sortable" onClick={() => toggleSort("spend")}>{sortLabel("spend", "Amount spent")}</th>
                <th className="text-right">Impressions</th>
                <th className="text-right">Reach</th>
                <th className="text-right">Frequency</th>
                <th className="text-right">CPM</th>
                <th className="text-right">LPV</th><th className="text-right">ATC</th><th className="text-right">Checkout</th>
                <th className="text-right sortable" onClick={() => toggleSort("purchases")}>{sortLabel("purchases", "Purchases")}</th>
                <th className="text-right">CPA</th>
                <th className="text-right">Budget</th>
                <th className="text-right sortable" onClick={() => toggleSort("roas")}>{sortLabel("roas", "ROAS")}</th>
              </tr>
            </thead>
            <tbody>
              {data.adsets.map((row: any) => (
                <tr key={row.adset_id} className="border-b hover:bg-gray-50 text-sm">
                  <td>
                    <button className="filter-link text-blue-600 hover:underline" onClick={() => filterCampaign(row.campaign_id || "")}>
                      {row.campaign_name}
                    </button>
                  </td>
                  <td>
                    <button className="filter-link text-blue-600 hover:underline" onClick={() => filterAdset(row.campaign_id, row.adset_id)}>
                      {row.adset_name}
                    </button>
                  </td>
                  <td className="text-right">{money(row.spend, currency)}</td>
                  <td className="text-right">{num(row.impressions, 0)}</td>
                  <td className="text-right">{row.reach != null ? num(row.reach, 0) : num(row.impressions, 0)}</td>
                  <td className="text-right">{row.frequency != null ? num(row.frequency) : "—"}</td>
                  <td className="text-right">{row.cpm != null ? money(row.cpm, currency) : row.impressions ? money(Number(row.spend)/Number(row.impressions)*1000, currency) : "—"}</td>
                  <td className="text-right">{num(row.landing_page_views, 0)}</td>
                  <td className="text-right">{num(row.adds_to_cart, 0)}</td>
                  <td className="text-right">{num(row.checkouts, 0)}</td>
                  <td className="text-right">{num(row.purchases, 0)}</td>
                  <td className="text-right">{money(row.cost_per_purchase, currency)}</td>
                  <td className="text-right">{row.daily_budget ? money(row.daily_budget, currency) : "Using ad set budget"}</td>
                  <td className="text-right">{num(row.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">Ad set grain - click Ad set name to filter Ad table. LPV = Landing Page Views.</p>
        </TableCard>

        <TableCard title="Ad performance — Ads for 1 Campaign (search by name, ID or metrics)">
          <div className="flex gap-2 mb-3">
            <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search to filter by: name, ID or metrics" className="flex-1 px-3 py-2 border rounded text-sm" />
          </div>
          <table>
            <thead>
              <tr className="border-b text-xs">
                <th>Campaign</th><th>Ad set</th>
                <th className="sortable" onClick={() => toggleSort("name")}>{sortLabel("name", "Ad")}</th>
                <th className="text-right">Delivery</th>
                <th className="text-right sortable" onClick={() => toggleSort("spend")}>{sortLabel("spend", "Amount spent")}</th>
                <th className="text-right">Impressions</th>
                <th className="text-right">Reach</th>
                <th className="text-right sortable" onClick={() => toggleSort("frequency")}>{sortLabel("frequency", "Frequency")}</th>
                <th className="text-right">CPM</th>
                <th className="text-right sortable" onClick={() => toggleSort("ctr")}>{sortLabel("ctr", "CTR")}</th>
                <th className="text-right">LPV</th>
                <th className="text-right">ATC</th><th className="text-right">Checkout</th>
                <th className="text-right sortable" onClick={() => toggleSort("purchases")}>{sortLabel("purchases", "Purchases")}</th>
                <th className="text-right">CPA</th>
                <th className="text-right sortable" onClick={() => toggleSort("roas")}>{sortLabel("roas", "ROAS")}</th>
              </tr>
            </thead>
            <tbody>
              {data.ads.map((row: any) => (
                <tr key={row.ad_id} className="border-b hover:bg-gray-50 text-sm">
                  <td>
                    <button className="filter-link text-blue-600 hover:underline" onClick={() => filterCampaign(row.campaign_id || "")}>
                      {row.campaign_name}
                    </button>
                  </td>
                  <td>
                    <button className="filter-link text-blue-600 hover:underline" onClick={() => filterAdset(row.campaign_id, row.adset_id || "")}>
                      {row.adset_name}
                    </button>
                  </td>
                  <td>
                    <button className="filter-link text-blue-600 hover:underline text-left" onClick={() => filterAd(row.campaign_id, row.adset_id, row.ad_id)}>
                      {row.ad_name}
                    </button>
                  </td>
                  <td>{(row as any).delivery || (row as any).effective_status ? <span className={String((row as any).delivery||"").toLowerCase().includes("active")?"text-green-700":"text-gray-500"}>● {(row as any).delivery||(row as any).effective_status}</span> : <span className="text-green-700">● Active</span>}</td>
                  <td className="text-right">{money(row.spend, currency)}</td>
                  <td className="text-right">{(row as any).impressions != null ? num((row as any).impressions, 0) : "—"}</td>
                  <td className="text-right">{(row as any).reach != null ? num((row as any).reach, 0) : "—"}</td>
                  <td className="text-right">{num(row.frequency)}</td>
                  <td className="text-right">{row.cpm != null ? money(row.cpm, currency) : "—"}</td>
                  <td className="text-right">{pct(row.ctr)}</td>
                  <td className="text-right">{num(row.landing_page_views, 0)}</td>
                  <td className="text-right">{num(row.adds_to_cart, 0)}</td>
                  <td className="text-right">{num(row.checkouts, 0)}</td>
                  <td className="text-right">{num(row.purchases, 0)}</td>
                  <td className="text-right">{money(row.cost_per_purchase, currency)}</td>
                  <td className="text-right">{num(row.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">Results from {data.ads.length} ads · includes Landing Page Views, ATC, Checkout. Search filters name/ID/metrics.</p>
        </TableCard>

        <TableCard title="Video performance">
          <table>
            <thead>
              <tr className="border-b">
                <th>Ad</th><th className="text-right">Plays</th><th className="text-right">25%</th>
                <th className="text-right">50%</th><th className="text-right">75%</th><th className="text-right">95%</th>
                <th className="text-right">100%</th><th className="text-right">ThruPlay</th>
                <th className="text-right">Avg play</th><th className="text-right">25% ret.</th>
              </tr>
            </thead>
            <tbody>
              {data.video.map((row) => (
                <tr key={row.ad_id} className="border-b hover:bg-gray-50">
                  <td>
                    <button className="filter-link" onClick={() => filterAd(undefined, undefined, row.ad_id)}>
                      {row.ad_name}
                    </button>
                  </td>
                  <td className="text-right">{num(row.video_plays, 0)}</td>
                  <td className="text-right">{num(row.video_plays_25, 0)}</td>
                  <td className="text-right">{num(row.video_plays_50, 0)}</td>
                  <td className="text-right">{num(row.video_plays_75, 0)}</td>
                  <td className="text-right">{num(row.video_plays_95, 0)}</td>
                  <td className="text-right">{num(row.video_plays_100, 0)}</td>
                  <td className="text-right">{num(row.thruplays, 0)}</td>
                  <td className="text-right">{num(row.video_avg_play_time)}</td>
                  <td className="text-right">{pct(row.retention_25)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>

        <TableCard
          title="Action explorer"
          toolbar={
            <input
              type="search"
              value={actionSearch}
              onChange={(e) => setActionSearch(e.target.value)}
              placeholder="Filter action types"
              className="px-4 py-2 bg-white rounded"
            />
          }
        >
          <table>
            <thead>
              <tr className="border-b">
                <th>Action type</th><th className="text-right">Total</th><th className="text-right">Ads</th>
                <th className="text-right">Campaigns</th><th>First seen</th><th>Last seen</th>
                <th className="text-right">Conversion value</th>
              </tr>
            </thead>
            <tbody>
              {visibleActions.map((row) => (
                <tr key={row.action_type} className="border-b hover:bg-gray-50">
                  <td>{row.action_type}</td>
                  <td className="text-right">{num(row.total_actions, 0)}</td>
                  <td className="text-right">{num(row.ads_with_action, 0)}</td>
                  <td className="text-right">{num(row.campaigns_with_action, 0)}</td>
                  <td>{row.first_seen}</td>
                  <td>{row.last_seen}</td>
                  <td className="text-right">{money(row.conversion_value, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>

        <div className="bg-white rounded-lg p-6 shadow-lg mb-8">
          <h3 className="text-lg font-semibold mb-4">Placement / device / demographic / geo</h3>
          {!data.breakdownsEnabled || !placements || placements.length === 0 ? (
            <p className="text-gray-600">Breakdown sync not enabled</p>
          ) : (
            <p className="text-gray-600">{placements.length} placement rows loaded for this range.</p>
          )}
        </div>

        <div className="bg-white rounded-lg p-6 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Sync health</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div><p className="text-sm text-gray-600">Last today sync</p><p>{data.syncHealth?.last_successful_today_sync_at ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Last recent repair</p><p>{data.syncHealth?.last_successful_recent_repair_at ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Backfill</p><p>{data.syncHealth?.backfill_status ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Duration</p><p>{data.syncHealth?.last_duration_seconds ?? "—"}s</p></div>
            <div><p className="text-sm text-gray-600">Rows fetched</p><p>{data.syncHealth?.last_rows_fetched ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">API pages</p><p>{data.syncHealth?.last_pages_fetched ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Retries</p><p>{data.syncHealth?.last_retry_count ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Last error</p><p>{data.syncHealth?.last_error_code ?? "—"}</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TableCard({ title, toolbar, children }: { title: string; toolbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white rounded-lg p-6 shadow-lg mb-8">
      <div className="flex justify-between items-center mb-4 gap-4 flex-wrap">
        <h3 className="text-lg font-semibold">{title}</h3>
        {toolbar}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
