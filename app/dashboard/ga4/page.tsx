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
    sessions: number;
    engaged_sessions: number;
    engagement_rate: number | null;
    bounce_rate: number | null;
    users: number;
    new_users: number;
    views: number;
    add_to_carts: number;
    begin_checkout: number;
    purchases: number;
    revenue: number;
  };
  daily: Array<{ date: string; sessions: number; users: number; purchases: number; revenue: number }>;
  funnel: {
    sessions: number;
    engaged_sessions: number;
    views: number;
    add_to_carts: number;
    begin_checkout: number;
    purchases: number;
    engagement_rate: number | null;
    atc_per_session: number | null;
    checkout_per_atc: number | null;
    purchase_per_checkout: number | null;
    purchase_per_session: number | null;
    revenue_per_session: number | null;
    avg_revenue_per_purchase: number | null;
  } | null;
  channels: {
    rows: Array<{
      channel: string;
      sessions: number;
      users: number;
      new_users: number;
      views: number;
      add_to_carts: number;
      begin_checkout: number;
      purchases: number;
      revenue: number;
      purchase_conversion_rate: number | null;
    }>;
    total: number;
    options: Array<{ channel: string }>;
  };
  utm: {
    rows: Array<{
      utm_source: string;
      utm_campaign: string;
      utm_medium: string;
      utm_content: string;
      sessions: number;
      users: number;
      purchases: number;
      revenue: number;
      purchase_conversion_rate: number | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
    options: Array<{ kind: string; value: string }>;
  };
  syncHealth: {
    datasets: Array<{
      dataset: string;
      state: {
        last_successful_sync_at: string | null;
        last_successful_from: string | null;
        last_successful_to: string | null;
        last_backfill_completed_at: string | null;
      } | null;
      lastRun: {
        status: string | null;
        last_error_message: string | null;
        retry_count: number | null;
        rows_upserted: number | null;
        started_at: string | null;
        finished_at: string | null;
      } | null;
      activeBackfill: { status: string | null } | null;
    }>;
    property: { currency_code: string | null; reporting_timezone: string | null } | null;
  };
  property: { currency_code: string | null; reporting_timezone: string | null } | null;
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

export default function Ga4Dashboard() {
  const [range, setRange] = useState<"today" | "7d" | "30d" | "90d" | "custom">("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [channel, setChannel] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [medium, setMedium] = useState("");
  const [content, setContent] = useState("");
  const [sort, setSort] = useState("revenue");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ range, sort, dir, page: String(page), pageSize: "25" });
    if (range === "custom" && customFrom && customTo) {
      params.set("from", customFrom);
      params.set("to", customTo);
    }
    if (channel) params.set("channel", channel);
    if (source) params.set("source", source);
    if (campaign) params.set("campaign", campaign);
    if (medium) params.set("medium", medium);
    if (content) params.set("content", content);
    return params.toString();
  }, [range, customFrom, customTo, channel, source, campaign, medium, content, sort, dir, page]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/ga4/analytics/overview?${query}`);
        const body = await response.json();
        if (body.disabled) throw new Error(body.error || "GA4 not configured");
        if (!response.ok) throw new Error(body.error || "Failed to load GA4 analytics");
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load GA4 analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [query]);

  const currency = data?.property?.currency_code || data?.syncHealth?.property?.currency_code || "INR";
  const sources = [...new Set((data?.utm.options ?? []).filter((row) => row.kind === "source").map((row) => row.value))];
  const campaigns = [...new Set((data?.utm.options ?? []).filter((row) => row.kind === "campaign").map((row) => row.value))];
  const mediums = [...new Set((data?.utm.options ?? []).filter((row) => row.kind === "medium").map((row) => row.value))];
  const contents = [...new Set((data?.utm.options ?? []).filter((row) => row.kind === "content").map((row) => row.value))];
  const funnelBars = data?.funnel
    ? [
        { step: "Sessions", value: data.funnel.sessions },
        { step: "Engaged", value: data.funnel.engaged_sessions },
        { step: "ATC", value: data.funnel.add_to_carts },
        { step: "Checkout", value: data.funnel.begin_checkout },
        { step: "Purchase", value: data.funnel.purchases },
      ]
    : [];

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-full mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">GA4 Analytics</h1>
            <p className="text-gray-600 mt-2">
              <Link href="/dashboard">Shiprocket</Link>
              {" · "}
              <Link href="/dashboard/shiprocket">Explorer</Link>
              {" · "}
              <Link href="/dashboard/shopify">Shopify</Link>
              {" · "}
              <Link href="/dashboard/meta">Meta</Link>
              {" · "}
              <strong>GA4</strong>
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Reads Supabase only. Currency {currency}
              {data?.property?.reporting_timezone ? ` · timezone ${data.property.reporting_timezone}` : ""}.
              {" "}Auto-refreshes every 60s. Parallel to Google Sheets — no cutover.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={range}
              onChange={(e) => {
                setPage(1);
                setRange(e.target.value as typeof range);
              }}
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
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="px-4 py-2 bg-white rounded shadow-lg" />
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="px-4 py-2 bg-white rounded shadow-lg" />
              </>
            )}
          </div>
        </div>

        {error && <p className="mb-6 text-red-600">{error}</p>}
        {loading && !data && <p className="text-gray-600">Loading GA4 analytics…</p>}

        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              <Kpi title="Sessions" value={num(data.kpis.sessions, 0)} />
              <Kpi title="Engaged Sessions" value={num(data.kpis.engaged_sessions, 0)} />
              <Kpi title="Engagement Rate" value={pct(data.kpis.engagement_rate)} />
              <Kpi title="Users" value={num(data.kpis.users, 0)} />
              <Kpi title="New Users" value={num(data.kpis.new_users, 0)} />
              <Kpi title="Views" value={num(data.kpis.views, 0)} />
              <Kpi title="Add To Cart" value={num(data.kpis.add_to_carts, 0)} />
              <Kpi title="Begin Checkout" value={num(data.kpis.begin_checkout, 0)} />
              <Kpi title="Purchases" value={num(data.kpis.purchases, 0)} />
              <Kpi title="Revenue" value={money(data.kpis.revenue, currency)} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <Card title="Daily trend">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={data.daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="sessions" stroke="#2563eb" fill="#93c5fd" name="Sessions" />
                    <Area type="monotone" dataKey="users" stroke="#059669" fill="#6ee7b7" name="Users" />
                    <Area type="monotone" dataKey="purchases" stroke="#d97706" fill="#fcd34d" name="Purchases" />
                    <Area type="monotone" dataKey="revenue" stroke="#dc2626" fill="#fca5a5" name="Revenue" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
              <Card title="Funnel">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={funnelBars}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="step" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
                {data.funnel && (
                  <p className="text-sm text-gray-600 mt-3">
                    Engagement {pct(data.funnel.engagement_rate)} · ATC/Sessions {pct(data.funnel.atc_per_session)} ·
                    Checkout/ATC {pct(data.funnel.checkout_per_atc)} · Purchase/Checkout {pct(data.funnel.purchase_per_checkout)} ·
                    Purchase/Sessions {pct(data.funnel.purchase_per_session)}
                  </p>
                )}
              </Card>
            </div>

            <Card title="Channel performance">
              <div className="filter-bar filter-bar-start mb-3">
                <select value={channel} onChange={(e) => { setPage(1); setChannel(e.target.value); }}>
                  <option value="">All channels</option>
                  {(data.channels.options ?? []).map((row) => (
                    <option key={row.channel} value={row.channel}>{row.channel}</option>
                  ))}
                </select>
              </div>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th>Sessions</th>
                      <th>Users</th>
                      <th>New Users</th>
                      <th>Views</th>
                      <th>ATC</th>
                      <th>Checkout</th>
                      <th>Purchases</th>
                      <th>Revenue</th>
                      <th>Conversion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.channels.rows.map((row) => (
                      <tr key={row.channel}>
                        <td>{row.channel}</td>
                        <td>{num(row.sessions, 0)}</td>
                        <td>{num(row.users, 0)}</td>
                        <td>{num(row.new_users, 0)}</td>
                        <td>{num(row.views, 0)}</td>
                        <td>{num(row.add_to_carts, 0)}</td>
                        <td>{num(row.begin_checkout, 0)}</td>
                        <td>{num(row.purchases, 0)}</td>
                        <td>{money(row.revenue, currency)}</td>
                        <td>{pct(row.purchase_conversion_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="UTM performance">
              <div className="filter-bar filter-bar-start mb-3">
                <select value={source} onChange={(e) => { setPage(1); setSource(e.target.value); }}>
                  <option value="">All sources</option>
                  {sources.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select value={campaign} onChange={(e) => { setPage(1); setCampaign(e.target.value); }}>
                  <option value="">All campaigns</option>
                  {campaigns.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select value={medium} onChange={(e) => { setPage(1); setMedium(e.target.value); }}>
                  <option value="">All mediums</option>
                  {mediums.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select value={content} onChange={(e) => { setPage(1); setContent(e.target.value); }}>
                  <option value="">All content</option>
                  {contents.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="revenue">Sort: revenue</option>
                  <option value="sessions">Sort: sessions</option>
                  <option value="purchases">Sort: purchases</option>
                  <option value="conversion">Sort: conversion</option>
                </select>
                <select value={dir} onChange={(e) => setDir(e.target.value as "asc" | "desc")}>
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Campaign</th>
                      <th>Medium</th>
                      <th>Content</th>
                      <th>Sessions</th>
                      <th>Users</th>
                      <th>Purchases</th>
                      <th>Revenue</th>
                      <th>Conversion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.utm.rows.map((row) => (
                      <tr key={`${row.utm_source}|${row.utm_campaign}|${row.utm_medium}|${row.utm_content}`}>
                        <td>{row.utm_source}</td>
                        <td>{row.utm_campaign}</td>
                        <td>{row.utm_medium}</td>
                        <td>{row.utm_content}</td>
                        <td>{num(row.sessions, 0)}</td>
                        <td>{num(row.users, 0)}</td>
                        <td>{num(row.purchases, 0)}</td>
                        <td>{money(row.revenue, currency)}</td>
                        <td>{pct(row.purchase_conversion_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-4 mt-4 text-sm">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
                <span>Page {data.utm.page} · {data.utm.total} combinations</span>
                <button
                  type="button"
                  disabled={data.utm.page * data.utm.pageSize >= data.utm.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </Card>

            <Card title="Sync health">
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Dataset</th>
                      <th>Last successful sync</th>
                      <th>Last 3-day range</th>
                      <th>Backfill</th>
                      <th>Last error</th>
                      <th>Rows / retries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.syncHealth.datasets ?? []).map((row) => (
                      <tr key={row.dataset}>
                        <td>{row.dataset}</td>
                        <td>{row.state?.last_successful_sync_at ?? "—"}</td>
                        <td>
                          {row.state?.last_successful_from && row.state?.last_successful_to
                            ? `${row.state.last_successful_from} → ${row.state.last_successful_to}`
                            : "—"}
                        </td>
                        <td>{row.activeBackfill?.status ?? row.state?.last_backfill_completed_at ?? "—"}</td>
                        <td>{row.lastRun?.last_error_message ?? "—"}</td>
                        <td>
                          {num(row.lastRun?.rows_upserted, 0)} / {num(row.lastRun?.retry_count, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-600">{title}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-lg shadow p-6 mb-8">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      {children}
    </section>
  );
}
