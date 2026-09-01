"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface GokwikOrder {
  shopify_order_id: string;
  order_name: string;
  order_number: string | null;
  created_at_shopify: string;
  financial_status: string | null;
  total_price: number;
  currency: string | null;
  notes_edd: string | null;
  landing_site: string | null;
  channel_source_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  meta_fbc: string | null;
  meta_fbp: string | null;
  gokwik_cid: string | null;
  cart_token: string | null;
  user_agent: string | null;
  full_url: string | null;
  customer_ip: string | null;
  deliver_order_count: string | null;
  bank_offer_code: string | null;
  gokwik_payment_id: string | null;
  payment_provider_name_attr: string | null;
  payment_provider_payment_id_attr: string | null;
  channel_information: string | null;
  shopify_payment_id: string | null;
  shopify_gateway: string | null;
}

interface OverviewData {
  range: { from: string; to: string };
  kpis: {
    total_orders: number;
    gokwik_tagged_orders: number;
    with_meta_fbc: number;
    with_meta_fbp: number;
    with_customer_ip: number;
    channel_gokwik_orders: number;
    gokwik_order_value: number;
    unique_ips: number;
  };
  orders: GokwikOrder[];
  recentGokwik: GokwikOrder[];
  channel: Array<{ channel: string; orders: number; order_value: number }>;
}

function money(n: number | null | undefined) {
  return `₹${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function dash(v: string | number | null | undefined) {
  if (v == null || String(v).trim() === "") return "—";
  return String(v);
}
function short(s: string | null | undefined, n = 28) {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default function GokwikDashboard() {
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "custom">("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<OverviewData | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ range });
    if (range === "custom" && customFrom && customTo) {
      p.set("from", new Date(customFrom).toISOString());
      // inclusive end-of-day: same-day 2026-09-01→2026-09-01 must be 00:00 → 23:59:59.999
      const toEnd = new Date(customTo);
      toEnd.setUTCHours(23, 59, 59, 999);
      p.set("to", toEnd.toISOString());
    }
    return p.toString();
  }, [range, customFrom, customTo]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/shopify/analytics/gokwik?${query}`, { credentials: "include" });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error || "Failed to load GoKwik analytics");
      }
      const j = await res.json();
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [query]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.orders;
    return data.orders.filter((o) =>
      [o.order_name, o.gokwik_cid, o.meta_fbc, o.meta_fbp, o.customer_ip, o.cart_token, o.gokwik_payment_id, o.bank_offer_code, o.utm_source, o.utm_campaign]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [data, search]);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-7xl mx-auto"><h1 className="text-3xl font-bold">Loading GoKwik dashboard…</h1></div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-7xl mx-auto"><h1 className="text-3xl font-bold">GoKwik dashboard error</h1><p className="text-red-500">{error}</p></div>
      </div>
    );
  }
  if (!data) return null;

  const kpis = [
    { label: "Total Orders", value: data.kpis.total_orders.toLocaleString(), color: "bg-blue-500" },
    { label: "GoKwik Tagged", value: data.kpis.gokwik_tagged_orders.toLocaleString(), color: "bg-green-500" },
    { label: "With meta_fbc", value: data.kpis.with_meta_fbc.toLocaleString(), color: "bg-purple-500" },
    { label: "With meta_fbp", value: data.kpis.with_meta_fbp.toLocaleString(), color: "bg-orange-500" },
    { label: "Channel GoKwik", value: data.kpis.channel_gokwik_orders.toLocaleString(), color: "bg-blue-500" },
    { label: "GoKwik Value", value: money(data.kpis.gokwik_order_value), color: "bg-green-500" },
    { label: "Unique IPs", value: data.kpis.unique_ips.toLocaleString(), color: "bg-purple-500" },
  ];

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-full mx-auto">
        <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold">GoKwik Analytics</h1>
            <p className="text-gray-600 mt-2">
              <Link href="/dashboard">Shiprocket</Link> {" · "} <Link href="/dashboard/shopify">Shopify</Link> {" · "} <strong>GoKwik</strong> {" · "} <Link href="/dashboard/meta">Meta</Link> {" · "} <Link href="/dashboard/ga4">GA4</Link>
            </p>
            <p className="text-xs text-gray-500 mt-1">Source: <code>analytics.shopify_gokwik_orders</code> pivoted from <code>data_pipeline.shopify_note_attributes</code> + <code>shopify_orders.note/landing_site</code></p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <select value={range} onChange={(e) => setRange(e.target.value as typeof range)} className="px-4 py-2 bg-white rounded shadow">
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
            <button onClick={load} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Refresh</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpis.map((c) => (
            <div key={c.label} className={`${c.color} rounded-lg p-6 text-white shadow-lg`}>
              <p className="text-sm opacity-90">{c.label}</p>
              <p className="text-2xl font-bold mt-2">{c.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-lg p-6 shadow-lg mb-8">
          <h3 className="text-lg font-semibold mb-4">Channel breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left p-2">Channel</th><th className="text-right p-2">Orders</th><th className="text-right p-2">Value</th></tr></thead>
              <tbody>
                {data.channel.map((r) => (
                  <tr key={r.channel} className="border-b hover:bg-gray-50"><td className="p-2">{dash(r.channel)}</td><td className="p-2 text-right">{r.orders}</td><td className="p-2 text-right">{money(r.order_value)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-lg">
          <div className="flex justify-between items-center mb-4 gap-4 flex-wrap">
            <h3 className="text-lg font-semibold">Orders - GoKwik attributes ({filtered.length} / {data.orders.length})</h3>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order, gokwik_cid, fbc, fbp, ip, cart_token…" className="px-4 py-2 bg-gray-100 rounded w-full sm:w-80 text-sm" />
          </div>

          {/* Desktop table - horizontally scrollable with sticky first column */}
          <div className="hidden lg:block overflow-x-auto -mx-6 px-6">
            <div className="inline-block min-w-full align-middle">
              <table className="min-w-[2600px] w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="sticky left-0 bg-gray-50 z-10 px-3 py-2.5 text-left font-semibold whitespace-nowrap border-r min-w-[90px]">Order</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[100px]">Created</th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap min-w-[90px]">Total</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[120px]">NotesEDD</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[160px]">meta_fbc</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[160px]">meta_fbp</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[130px]">gokwik_cid</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[130px]">GoKwik PayID</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[130px]">Provider PayID</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[130px]">cart_token</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[130px]">customer_ip</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[160px]">user_agent</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[180px]">full_url</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[110px]">utm_source</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[130px]">utm_campaign</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[150px]">utm_medium</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[110px]">Bank Offer</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[90px]">deliver_cnt</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[110px]">Channel</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[100px]">Gateway</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map((o) => (
                    <tr key={o.shopify_order_id} className="border-b hover:bg-gray-50">
                      <td className="sticky left-0 bg-white group-hover:bg-gray-50 px-3 py-2.5 font-mono border-r whitespace-nowrap">{dash(o.order_name)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{o.created_at_shopify.slice(0, 10)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">{money(o.total_price)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap" title={o.notes_edd ?? ""}>{short(o.notes_edd, 16)}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap" title={o.meta_fbc ?? ""}>{short(o.meta_fbc, 22)}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap" title={o.meta_fbp ?? ""}>{short(o.meta_fbp, 22)}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap" title={o.gokwik_cid ?? ""}>{short(o.gokwik_cid, 14)}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap" title={o.gokwik_payment_id ?? ""}>{short(o.gokwik_payment_id, 14)}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap" title={o.payment_provider_payment_id_attr ?? o.shopify_payment_id ?? ""}>{short(o.payment_provider_payment_id_attr ?? o.shopify_payment_id, 14)}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap" title={o.cart_token ?? ""}>{short(o.cart_token, 14)}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">{dash(o.customer_ip)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap" title={o.user_agent ?? ""}>{short(o.user_agent, 22)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap" title={o.full_url ?? o.landing_site ?? ""}>{short(o.full_url ?? o.landing_site, 24)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{dash(o.utm_source)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{dash(o.utm_campaign)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{dash(o.utm_medium)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{dash(o.bank_offer_code)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{dash(o.deliver_order_count)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{dash(o.channel_information ?? o.channel_source_name)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{dash(o.payment_provider_name_attr ?? o.shopify_gateway)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile/Tablet - card layout */}
          <div className="lg:hidden space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {filtered.slice(0, 50).map((o) => (
              <div key={o.shopify_order_id} className="border rounded-lg p-4 bg-gray-50">
                <div className="flex justify-between items-start gap-2 mb-3">
                  <span className="font-mono font-semibold text-sm">{dash(o.order_name)}</span>
                  <span className="text-xs whitespace-nowrap">{o.created_at_shopify.slice(0, 10)} · {money(o.total_price)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-500">NotesEDD:</span> <span className="font-mono" title={o.notes_edd ?? ""}>{short(o.notes_edd, 20)}</span></div>
                  <div><span className="text-gray-500">IP:</span> <span className="font-mono">{dash(o.customer_ip)}</span></div>
                  <div className="col-span-2"><span className="text-gray-500">meta_fbc:</span> <span className="font-mono break-all" title={o.meta_fbc ?? ""}>{short(o.meta_fbc, 36)}</span></div>
                  <div className="col-span-2"><span className="text-gray-500">meta_fbp:</span> <span className="font-mono break-all" title={o.meta_fbp ?? ""}>{short(o.meta_fbp, 36)}</span></div>
                  <div><span className="text-gray-500">gokwik_cid:</span> <span className="font-mono">{short(o.gokwik_cid, 16)}</span></div>
                  <div><span className="text-gray-500">cart_token:</span> <span className="font-mono">{short(o.cart_token, 16)}</span></div>
                  <div><span className="text-gray-500">GWK PayID:</span> <span className="font-mono">{short(o.gokwik_payment_id, 16)}</span></div>
                  <div><span className="text-gray-500">Prov PayID:</span> <span className="font-mono">{short(o.payment_provider_payment_id_attr ?? o.shopify_payment_id, 16)}</span></div>
                  <div className="col-span-2"><span className="text-gray-500">UTM:</span> {dash(o.utm_source)} / {dash(o.utm_campaign)} / {dash(o.utm_medium)}</div>
                  <div><span className="text-gray-500">Bank:</span> {dash(o.bank_offer_code)}</div>
                  <div><span className="text-gray-500">Deliver:</span> {dash(o.deliver_order_count)}</div>
                  <div className="col-span-2 truncate"><span className="text-gray-500">URL:</span> <span title={o.full_url ?? o.landing_site ?? ""}>{short(o.full_url ?? o.landing_site, 40)}</span></div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row justify-between gap-2 mt-3 text-xs text-gray-500">
            <span>Desktop: scroll horizontally → sticky Order column. Mobile: card view.</span>
            {filtered.length > 100 && <span>Showing 100 of {filtered.length} - use search.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
