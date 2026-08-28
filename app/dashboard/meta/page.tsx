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

export default function MetaDashboard() {
  const [range, setRange] = useState<"today" | "7d" | "30d" | "90d" | "custom">("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
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

  const query = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (range === "custom" && customFrom && customTo) {
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
    range,
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
        <div className="flex justify-between items-center mb-8">
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
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as typeof range)}
              className="px-4 py-2 bg-white rounded shadow-lg"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="custom">Custom</option>
            </select>
            {range === "custom" && (
              <>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="px-4 py-2 bg-white rounded" />
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="px-4 py-2 bg-white rounded" />
              </>
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

        <TableCard title="Campaign performance">
          <table>
            <thead>
              <tr className="border-b">
                <th className="sortable" onClick={() => toggleSort("name")}>{sortLabel("name", "Campaign")}</th>
                <th className="text-right sortable" onClick={() => toggleSort("spend")}>{sortLabel("spend", "Spend")}</th>
                <th className="text-right">Impressions</th>
                <th className="text-right sortable" onClick={() => toggleSort("ctr")}>{sortLabel("ctr", "CTR")}</th>
                <th className="text-right">LPV</th><th className="text-right">ATC</th>
                <th className="text-right">Checkout</th>
                <th className="text-right sortable" onClick={() => toggleSort("purchases")}>{sortLabel("purchases", "Purchases")}</th>
                <th className="text-right">CPA</th><th className="text-right">Value</th>
                <th className="text-right sortable" onClick={() => toggleSort("roas")}>{sortLabel("roas", "ROAS")}</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((row) => (
                <tr key={row.campaign_id} className="border-b hover:bg-gray-50">
                  <td>
                    <button className="filter-link" onClick={() => filterCampaign(row.campaign_id)}>
                      {row.campaign_name}
                    </button>
                  </td>
                  <td className="text-right">{money(row.spend, currency)}</td>
                  <td className="text-right">{num(row.impressions, 0)}</td>
                  <td className="text-right">{pct(row.ctr)}</td>
                  <td className="text-right">{num(row.landing_page_views, 0)}</td>
                  <td className="text-right">{num(row.adds_to_cart, 0)}</td>
                  <td className="text-right">{num(row.checkouts, 0)}</td>
                  <td className="text-right">{num(row.purchases, 0)}</td>
                  <td className="text-right">{money(row.cost_per_purchase, currency)}</td>
                  <td className="text-right">{money(row.purchase_value, currency)}</td>
                  <td className="text-right">{num(row.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>

        <TableCard title="Ad set performance">
          <table>
            <thead>
              <tr className="border-b">
                <th>Campaign</th>
                <th className="sortable" onClick={() => toggleSort("name")}>{sortLabel("name", "Ad set")}</th>
                <th className="text-right sortable" onClick={() => toggleSort("spend")}>{sortLabel("spend", "Spend")}</th>
                <th className="text-right sortable" onClick={() => toggleSort("ctr")}>{sortLabel("ctr", "CTR")}</th>
                <th className="text-right">LPV</th><th className="text-right">ATC</th><th className="text-right">Checkout</th>
                <th className="text-right sortable" onClick={() => toggleSort("purchases")}>{sortLabel("purchases", "Purchases")}</th>
                <th className="text-right">CPA</th>
                <th className="text-right sortable" onClick={() => toggleSort("roas")}>{sortLabel("roas", "ROAS")}</th>
              </tr>
            </thead>
            <tbody>
              {data.adsets.map((row) => (
                <tr key={row.adset_id} className="border-b hover:bg-gray-50">
                  <td>
                    <button className="filter-link" onClick={() => filterCampaign(row.campaign_id || "")}>
                      {row.campaign_name}
                    </button>
                  </td>
                  <td>
                    <button className="filter-link" onClick={() => filterAdset(row.campaign_id, row.adset_id)}>
                      {row.adset_name}
                    </button>
                  </td>
                  <td className="text-right">{money(row.spend, currency)}</td>
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
        </TableCard>

        <TableCard title="Ad performance">
          <table>
            <thead>
              <tr className="border-b">
                <th>Campaign</th><th>Ad set</th>
                <th className="sortable" onClick={() => toggleSort("name")}>{sortLabel("name", "Ad")}</th>
                <th className="text-right sortable" onClick={() => toggleSort("spend")}>{sortLabel("spend", "Spend")}</th>
                <th className="text-right sortable" onClick={() => toggleSort("frequency")}>{sortLabel("frequency", "Frequency")}</th>
                <th className="text-right sortable" onClick={() => toggleSort("ctr")}>{sortLabel("ctr", "CTR")}</th>
                <th className="text-right">LPV</th>
                <th className="text-right">ATC</th><th className="text-right">Checkout</th>
                <th className="text-right sortable" onClick={() => toggleSort("purchases")}>{sortLabel("purchases", "Purchase")}</th>
                <th className="text-right">CPA</th>
                <th className="text-right sortable" onClick={() => toggleSort("roas")}>{sortLabel("roas", "ROAS")}</th>
              </tr>
            </thead>
            <tbody>
              {data.ads.map((row) => (
                <tr key={row.ad_id} className="border-b hover:bg-gray-50">
                  <td>
                    <button className="filter-link" onClick={() => filterCampaign(row.campaign_id || "")}>
                      {row.campaign_name}
                    </button>
                  </td>
                  <td>
                    <button className="filter-link" onClick={() => filterAdset(row.campaign_id, row.adset_id || "")}>
                      {row.adset_name}
                    </button>
                  </td>
                  <td>
                    <button className="filter-link" onClick={() => filterAd(row.campaign_id, row.adset_id, row.ad_id)}>
                      {row.ad_name}
                    </button>
                  </td>
                  <td className="text-right">{money(row.spend, currency)}</td>
                  <td className="text-right">{num(row.frequency)}</td>
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
