"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./journey.css";

type Row = Record<string, unknown> & { shopify_order_id: string };
type ProfitRow = Record<string, unknown>;
type Summary = {
  totalOrders: number; knownChannel: number; unknownChannel: number; metaChannelOrders: number; metaAttributedOrders: number; exactMetaEntityOrders: number; exactAdOrders: number; metaSourceOnlyOrders: number; shiprocketMatched: number;
  delivered: number; rto: number; ndr: number; hadNdr: number; deliveredNotRemitted: number; deliveredCod: number;
  remittedCod: number; remittanceMatched: number; hierarchyConflicts: number; attributedRevenue: number; deliveredRevenue: number;
  averageRemittanceDelayDays: number | null;
  channelBreakdown: Record<string, number>; metaBreakdown: Record<string, number>;
};
type Detail = { order: Row; attribution: Record<string, unknown> | null; shipment: Record<string, unknown> | null; remittances: Record<string, unknown>[]; timeline: Record<string, unknown>[] };

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

const EMPTY_SUMMARY: Summary = { totalOrders: 0, knownChannel: 0, unknownChannel: 0, metaChannelOrders: 0, metaAttributedOrders: 0, exactMetaEntityOrders: 0, exactAdOrders: 0, metaSourceOnlyOrders: 0, shiprocketMatched: 0, delivered: 0, rto: 0, ndr: 0, hadNdr: 0, deliveredNotRemitted: 0, deliveredCod: 0, remittedCod: 0, remittanceMatched: 0, hierarchyConflicts: 0, averageRemittanceDelayDays: null, attributedRevenue: 0, deliveredRevenue: 0, channelBreakdown: {}, metaBreakdown: {} };

function text(value: unknown, fallback = "NOT AVAILABLE") {
  return value == null || value === "" ? fallback : String(value);
}
function money(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);
}
function number(value: unknown) { return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
function percent(part: number, whole: number) { return whole ? `${((part / whole) * 100).toFixed(1)}%` : "—"; }
function date(value: unknown, includeTime = false) {
  if (!value) return "NOT AVAILABLE";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return parsed.toLocaleString("en-IN", includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}
function badge(value: unknown) {
  const label = text(value);
  const tone = /DELIVERED|REMITTED|EXACT_AD|MATCHED|COMPLETE/.test(label) && !/NOT|MISSING/.test(label) ? "good"
    : /RTO|CANCEL|CONFLICT|NOT MATCHED/.test(label) ? "bad"
      : /NDR|PENDING|SOURCE_ONLY|AMBIGUOUS/.test(label) ? "warn" : "neutral";
  return <span className={`journey-badge ${tone}`}>{label.replaceAll("_", " ")}</span>;
}
function metaDisplay(row: Row, value: unknown) {
  return row.channel_attribution !== "META" && !row.resolved_campaign_id && !row.resolved_adset_id && !row.resolved_ad_id
    ? "NOT APPLICABLE"
    : text(value);
}

export default function JourneyDashboard() {
  const [filters, setFilters] = useState<Record<string, string>>({ from: daysAgo(89), to: today });
  const [draftSearch, setDraftSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [cohortSummary, setCohortSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [profitRows, setProfitRows] = useState<ProfitRow[]>([]);
  const [profitTotals, setProfitTotals] = useState<Record<string, unknown>>({});
  const [profitScope, setProfitScope] = useState<{ cohort?: { from?: string | null; to?: string | null; date_basis?: string }; meta_reporting?: { from?: string | null; to?: string | null } }>({});
  const [level, setLevel] = useState<"campaign" | "adset" | "ad">("campaign");
  const [freshness, setFreshness] = useState<Record<string, unknown>>({});
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [operationalLookup, setOperationalLookup] = useState<Record<string, unknown>[]>([]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    Object.entries(filters).forEach(([key, value]) => value && p.set(key, value));
    return p;
  }, [filters, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const profitParams = new URLSearchParams({ level });
      ["from", "to", "channel", "source", "campaignId", "adsetId", "adId", "attributionStatus", "paymentCategory"].forEach((key) => {
        const value = filters[key];
        if (value) profitParams.set(key, value);
      });
      const [ordersResponse, profitResponse, freshnessResponse] = await Promise.all([
        fetch(`/api/journey/orders?${params}`),
        fetch(`/api/journey/profitability?${profitParams}`),
        fetch("/api/journey/freshness"),
      ]);
      const [orders, profit, fresh] = await Promise.all([ordersResponse.json(), profitResponse.json(), freshnessResponse.json()]);
      if (!ordersResponse.ok) throw new Error(orders.error || "Order journey request failed");
      if (!profitResponse.ok) throw new Error(profit.error || "Profitability request failed");
      setRows(orders.rows || []); setTotal(orders.total || 0); setOperationalLookup(orders.operationalLookup || []); setSummary(orders.outcomeSummary || orders.summary || EMPTY_SUMMARY); setCohortSummary(orders.cohortSummary || orders.summary || EMPTY_SUMMARY);
      setProfitRows(profit.rows || []); setProfitTotals(profit.totals || {}); setProfitScope({ cohort: profit.cohort, meta_reporting: profit.meta_reporting });
      if (freshnessResponse.ok) setFreshness(fresh);
    } catch (err) { setError(err instanceof Error ? err.message : "Journey dashboard failed"); }
    finally { setLoading(false); }
  }, [params, level, filters]);

  useEffect(() => { void load(); }, [load]);

  const update = (name: string, value: string) => {
    setPage(1);
    setFilters((current) => {
      const next = { ...current, [name]: value };
      if (name === "channel" && value && value !== "META") {
        delete next.campaignId; delete next.adsetId; delete next.adId;
      }
      return next;
    });
  };
  const drill = (row: ProfitRow) => {
    if (level === "campaign") { setFilters((f) => ({ ...f, campaignId: String(row.campaign_id || "") })); setLevel("adset"); }
    else if (level === "adset") { setFilters((f) => ({ ...f, campaignId: String(row.campaign_id || ""), adsetId: String(row.adset_id || "") })); setLevel("ad"); }
    else setFilters((f) => ({ ...f, campaignId: String(row.campaign_id || ""), adsetId: String(row.adset_id || ""), adId: String(row.ad_id || "") }));
    setPage(1);
  };
  const openOrder = async (id: string) => {
    setDetail(null);
    const response = await fetch(`/api/journey/orders/${encodeURIComponent(id)}`);
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Order detail failed"); return; }
    setDetail(body);
  };

  const cohortKpis = [
    ["Cohort Orders", cohortSummary.totalOrders], ["Known Channel", `${number(cohortSummary.knownChannel)} (${percent(cohortSummary.knownChannel, cohortSummary.totalOrders)})`], ["Unknown Channel", `${number(cohortSummary.unknownChannel)} (${percent(cohortSummary.unknownChannel, cohortSummary.totalOrders)})`],
    ["Meta Channel", `${number(cohortSummary.metaChannelOrders)} (${percent(cohortSummary.metaChannelOrders, cohortSummary.totalOrders)})`], ["Exact Meta Entity", `${number(cohortSummary.exactMetaEntityOrders)} (${percent(cohortSummary.exactMetaEntityOrders, cohortSummary.totalOrders)})`], ["Exact Meta Ad", cohortSummary.exactAdOrders], ["Meta Source Only", `${number(cohortSummary.metaSourceOnlyOrders)} (${percent(cohortSummary.metaSourceOnlyOrders, cohortSummary.totalOrders)})`], ["Shopify → Shiprocket", `${number(cohortSummary.shiprocketMatched)} (${percent(cohortSummary.shiprocketMatched, cohortSummary.totalOrders)})`],
  ];
  const outcomeKpis = [
    ["Filtered Outcome Orders", summary.totalOrders], ["Delivered", summary.delivered], ["RTO", summary.rto], ["NDR Open", summary.ndr], ["Had NDR", summary.hadNdr], ["Delivered Not Remitted", summary.deliveredNotRemitted], ["Remitted COD", `${number(summary.remittedCod)} (${percent(summary.remittedCod, summary.deliveredCod)})`], ["Avg Remittance Delay", summary.averageRemittanceDelayDays == null ? "NOT AVAILABLE" : `${number(summary.averageRemittanceDelayDays)} d`],
  ];

  return (
    <main className="journey-shell">
      <header className="journey-header">
        <div><Link href="/dashboard" className="journey-back">← All dashboards</Link><h1>Customer Journey & Profitability</h1><p>Meta acquisition → Shopify commerce → Shiprocket outcome → COD settlement</p></div>
        <div className="freshness"><strong>Data freshness</strong><span>Meta {date(freshness.meta, true)}</span><span>Shopify {date(freshness.shopify, true)}</span><span>Shiprocket {date(freshness.shiprocket, true)}</span><span>Remittance {date(freshness.remittance, true)}</span></div>
      </header>

      {error && <div className="journey-error">{error}</div>}
      {operationalLookup.length > 0 && <section className="journey-scope-note"><strong>Operational lookup:</strong> no Shopify journey row matched this exact identifier, but a Shiprocket record was found. {operationalLookup.map((item, index) => <span key={index}> {text(item.result_type)} · SR {text(item.sr_order_id)} · AWB {text(item.awb)} · {text(item.status_bucket || item.current_status)}{item.remittance ? ` · CRF ${text((item.remittance as Record<string, unknown>).crf_id)}` : ""}</span>)} This is a fulfilment/settlement result and is not inserted into the one-row-per-Shopify-order mart.</section>}

      <section className="journey-filters">
        <label>From<input type="date" value={filters.from || ""} onChange={(e) => update("from", e.target.value)} /></label>
        <label>To<input type="date" value={filters.to || ""} onChange={(e) => update("to", e.target.value)} /></label>
        <label>Channel<select value={filters.channel || ""} onChange={(e) => update("channel", e.target.value)}><option value="">All Channels</option><option>META</option><option>DIRECT</option><option>GOOGLE</option><option>KWIKENGAGE</option><option>OTHER</option><option>UNKNOWN</option></select></label>
        <label>Campaign ID<input disabled={Boolean(filters.channel && filters.channel !== "META")} value={filters.campaignId || ""} onChange={(e) => update("campaignId", e.target.value)} placeholder={filters.channel && filters.channel !== "META" ? "Not applicable" : "All campaigns"} /></label>
        <label>Ad set ID<input disabled={Boolean(filters.channel && filters.channel !== "META")} value={filters.adsetId || ""} onChange={(e) => update("adsetId", e.target.value)} placeholder={filters.channel && filters.channel !== "META" ? "Not applicable" : "All ad sets"} /></label>
        <label>Ad ID<input disabled={Boolean(filters.channel && filters.channel !== "META")} value={filters.adId || ""} onChange={(e) => update("adId", e.target.value)} placeholder={filters.channel && filters.channel !== "META" ? "Not applicable" : "All ads"} /></label>
        <label>Meta Attribution<select value={filters.attributionStatus || ""} onChange={(e) => update("attributionStatus", e.target.value)}><option value="">All Meta Attribution</option><option>EXACT_AD</option><option>EXACT_ADSET</option><option>EXACT_CAMPAIGN</option><option>META_SOURCE_ONLY</option><option>NO_META_MATCH</option></select></label>
        <label>Payment<select value={filters.paymentCategory || ""} onChange={(e) => update("paymentCategory", e.target.value)}><option value="">All</option><option>COD</option><option>PREPAID</option><option>UNKNOWN</option></select></label>
        <label>Shipment<select value={filters.shipmentStatus || ""} onChange={(e) => update("shipmentStatus", e.target.value)}><option value="">All</option><option>DELIVERED</option><option>RTO</option><option>NDR_OPEN</option><option>IN_TRANSIT</option><option>CANCELLED</option><option>NOT_SHIPPED</option></select></label>
        <label>Remittance<select value={filters.remittanceStatus || ""} onChange={(e) => update("remittanceStatus", e.target.value)}><option value="">All</option><option>REMITTED</option><option>DELIVERED_NOT_REMITTED</option><option>NOT_APPLICABLE</option><option>AMBIGUOUS</option></select></label>
        <label>Delivered<select value={filters.delivered || ""} onChange={(e) => update("delivered", e.target.value)}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></select></label>
        <label>RTO<select value={filters.rto || ""} onChange={(e) => update("rto", e.target.value)}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></select></label>
        <label>NDR Open<select value={filters.ndr || ""} onChange={(e) => update("ndr", e.target.value)}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></select></label>
        <label>Had NDR<select value={filters.hadNdr || ""} onChange={(e) => update("hadNdr", e.target.value)}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></select></label>
        <label>Courier<input value={filters.courier || ""} onChange={(e) => update("courier", e.target.value)} placeholder="Exact courier" /></label>
        <label className="wide">Search order / AWB / SR ID<div className="search-line"><input value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && update("search", draftSearch)} placeholder="#12345 or AWB" /><button onClick={() => update("search", draftSearch)}>Search</button></div></label>
        <button className="clear" onClick={() => { setFilters({ from: daysAgo(89), to: today }); setDraftSearch(""); setLevel("campaign"); }}>Clear filters</button>
      </section>

      <section className="journey-scope-note"><strong>Filter scope:</strong> acquisition/cohort filters apply to acquisition KPIs and campaign performance. Shipment, delivery, courier, remittance, and search filters apply only to outcome KPIs and the explorer. Campaign performance always uses the full selected acquisition cohort.</section>
      <section className="kpi-group"><h2>Acquisition cohort</h2><div className="journey-kpis">{cohortKpis.map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{typeof value === "string" ? value : number(value)}</strong></article>)}</div></section>
      <section className="attribution-breakdowns"><article><h3>Channel attribution</h3>{["META", "DIRECT", "GOOGLE", "KWIKENGAGE", "OTHER", "UNKNOWN"].map((key) => <div key={key}><span>{key}</span><strong>{number(cohortSummary.channelBreakdown[key] || 0)}</strong><small>{percent(cohortSummary.channelBreakdown[key] || 0, cohortSummary.totalOrders)}</small></div>)}</article><article><h3>Meta attribution</h3>{["EXACT_AD", "EXACT_ADSET", "EXACT_CAMPAIGN", "META_SOURCE_ONLY", "NO_META_MATCH"].map((key) => <div key={key}><span>{key}</span><strong>{number(cohortSummary.metaBreakdown[key] || 0)}</strong><small>{percent(cohortSummary.metaBreakdown[key] || 0, cohortSummary.totalOrders)}</small></div>)}<p>Hierarchy conflicts are a separate data-quality measure and do not change the attribution tier.</p></article></section>
      <section className="attribution-breakdowns"><article><h3>Journey quality</h3><div><span>Known channel coverage</span><strong>{percent(cohortSummary.knownChannel, cohortSummary.totalOrders)}</strong></div><div><span>Exact Meta entity coverage</span><strong>{percent(cohortSummary.exactMetaEntityOrders, cohortSummary.totalOrders)}</strong></div><div><span>Shopify → Shiprocket match</span><strong>{percent(cohortSummary.shiprocketMatched, cohortSummary.totalOrders)}</strong></div><div><span>Remittance match</span><strong>{percent(cohortSummary.remittanceMatched, cohortSummary.totalOrders)}</strong></div><div><span>Meta hierarchy conflicts</span><strong>{number(cohortSummary.hierarchyConflicts)} ({percent(cohortSummary.hierarchyConflicts, cohortSummary.totalOrders)})</strong></div></article></section>
      <section className="kpi-group"><h2>Order outcome</h2><div className="journey-kpis outcome-kpis">{outcomeKpis.map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{typeof value === "string" ? value : number(value)}</strong></article>)}</div></section>

      <section className="journey-panel">
        <div className="panel-heading"><div><h2>Campaign profitability</h2><p>Full acquisition cohort; outcome filters do not change this table. Meta and Shopify are aggregated separately before joining. Click a row to drill down.</p><p><strong>Cohort period:</strong> {profitScope.cohort?.from ? `${date(profitScope.cohort.from)} → ${date(profitScope.cohort.to)}` : "All available dates"} · <strong>Basis:</strong> {profitScope.cohort?.date_basis || "Shopify order-created date"} · <strong>Meta reporting:</strong> {profitScope.meta_reporting?.from ? `${date(profitScope.meta_reporting.from)} → ${date(profitScope.meta_reporting.to)}` : "Same cohort period"}</p><p className="journey-scope-note">Outcome filters do not change this table; they only affect Order Outcome and Order Journey Explorer.</p></div><div className="level-tabs">{(["campaign", "adset", "ad"] as const).map((item) => <button key={item} className={level === item ? "active" : ""} onClick={() => setLevel(item)}>{item}</button>)}</div></div>
        <div className="efficiency-strip"><span>Spend <b>{money(profitTotals.spend)}</b></span><span>Orders <b>{number(profitTotals.orders)}</b></span><span>Meta purchases <b>{number(profitTotals.metaPurchases)}</b></span><span>Meta purchase value <b>{money(profitTotals.metaPurchaseValue)}</b></span><span>Ordered revenue <b>{money(profitTotals.orderedRevenue)}</b></span><span>Current Shopify revenue <b>{money(profitTotals.currentRevenue)}</b></span><span>Meta ROAS <b>{number(profitTotals.metaRoas)}</b></span><span>Ordered ROAS <b>{number(profitTotals.orderedRoas)}</b></span><span>Current Shopify ROAS <b>{number(profitTotals.currentShopifyRoas)}</b></span><span>Delivered current revenue <b>{money(profitTotals.deliveredCurrentRevenue)}</b></span><span>Delivered ROAS <b>{number(profitTotals.deliveredCurrentRoas)}</b></span></div>
        <div className="table-scroll"><table className="profit-table"><thead><tr><th>{level}</th><th>Spend</th><th>Meta purchases</th><th>Meta purchase value</th><th>Orders</th><th>Ordered revenue</th><th>Current Shopify revenue</th><th>Shipped</th><th>Delivered</th><th>RTO</th><th>NDR</th><th>Delivered current revenue</th><th>Meta ROAS</th><th>Ordered ROAS</th><th>Current Shopify ROAS</th><th>Delivered ROAS</th><th>Hierarchy consistency</th></tr></thead><tbody>{profitRows.slice(0, 100).map((row, index) => <tr key={`${row.campaign_id}-${row.adset_id}-${row.ad_id}-${index}`} onClick={() => drill(row)}><td><strong>{text(level === "campaign" ? row.campaign_name : level === "adset" ? row.adset_name : row.ad_name)}</strong><small>{text(level === "campaign" ? row.campaign_id : level === "adset" ? row.adset_id : row.ad_id)}</small></td><td>{money(row.spend)}</td><td>{number(row.meta_purchases)}</td><td>{money(row.meta_purchase_value)}</td><td>{number(row.orders)}</td><td>{money(row.ordered_revenue)}</td><td>{money(row.current_revenue)}</td><td>{number(row.shipped)}</td><td>{number(row.delivered)}</td><td>{number(row.rto)}</td><td>{number(row.ndr)}</td><td>{money(row.delivered_current_revenue)}</td><td>{number(row.meta_roas)}</td><td>{number(row.ordered_roas)}</td><td>{number(row.current_shopify_roas)}</td><td>{number(row.delivered_current_roas)}</td><td>{row.attribution_coverage == null ? "—" : `${(Number(row.attribution_coverage) * 100).toFixed(1)}% hierarchy-consistent`}</td></tr>)}</tbody></table></div>
      </section>

      <section className="journey-panel">
        <div className="panel-heading"><div><h2>Order journey explorer</h2><p>One row per Shopify order. Unmatched attribution, shipment, and remittance remain visible.</p></div><span>{loading ? "Loading…" : `${number(total)} orders`}</span></div>
        <div className="table-scroll"><table className="orders-table"><thead><tr><th>Order</th><th>Date / value</th><th>Channel / UTM</th><th>Meta hierarchy / creative</th><th>Meta attribution evidence</th><th>Payment / status</th><th>Shiprocket</th><th>Delivery</th><th>Remittance</th><th>Quality</th></tr></thead><tbody>{rows.map((row) => <tr key={row.shopify_order_id} onClick={() => void openOrder(row.shopify_order_id)}><td><strong>{text(row.order_name)}</strong><small>ID {row.shopify_order_id}</small><small>Number {text(row.order_number)}</small></td><td>{date(row.created_at_shopify, true)}<small>{money(row.ordered_revenue)}</small></td><td>{text(row.channel_attribution)}<small>Raw: {text(row.channel_raw_source)} / {text(row.utm_medium_raw)}</small><small>campaign: {text(row.utm_campaign_raw)}</small><small>term: {text(row.utm_term_raw)}</small><small>content: {text(row.utm_content_raw)}</small></td><td><strong>{metaDisplay(row, row.resolved_campaign_name)}</strong><small>{metaDisplay(row, row.resolved_campaign_id)}</small><small>{metaDisplay(row, row.resolved_adset_name)} · {metaDisplay(row, row.resolved_adset_id)}</small><small>{metaDisplay(row, row.resolved_ad_name)} · {metaDisplay(row, row.resolved_ad_id)}</small><small>Creative: {metaDisplay(row, row.creative_name)} · {metaDisplay(row, row.creative_id)}</small></td><td>{badge(row.meta_attribution)}<small>{text(row.meta_attribution_method)}{row.meta_hierarchy_conflict ? " · CONFLICT" : ""}</small><small>{text(row.meta_conflict_reason, "No hierarchy conflict")}</small></td><td>{badge(row.payment_type)}<small>{text(row.financial_status)} / {text(row.fulfillment_status)}</small></td><td>{text(row.shiprocket_sr_order_id, "NOT MATCHED")}<small>Shipment {text(row.shipment_id)}</small><small>AWB {text(row.awb)} · {text(row.courier_name)}</small></td><td>{badge(row.delivery_outcome)}<small>Shipped {date(row.shipped_at)}</small><small>Delivered {date(row.delivered_at)}</small><small>NDR {row.is_ndr ? "YES" : "NO"} · RTO {row.is_rto ? "YES" : "NO"}</small></td><td>{badge(row.remittance_status)}<small>CRF {text(row.crf_id)} · UTR {text(row.utr)}</small><small>{date(row.latest_remitted_at)} · {row.has_remittance_match ? money(row.remitted_amount) : "NOT AVAILABLE"}</small><small>Delay {row.remittance_delay_days == null ? "NOT AVAILABLE" : `${row.remittance_delay_days} days`}</small></td><td>{badge(row.journey_completeness)}<small>Meta: {row.has_exact_meta_attribution ? "YES" : "NO"}</small><small>Shopify→SR: {text(row.shiprocket_match_status)}</small><small>SR→Remit: {row.has_remittance_match ? "MATCHED" : "NOT MATCHED"}</small></td></tr>)}</tbody></table></div>
        <div className="pagination"><button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span><select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select><button disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Next</button></div>
      </section>

      {detail && <div className="journey-modal-backdrop" onClick={() => setDetail(null)}><aside className="journey-modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setDetail(null)}>×</button><h2>{text(detail.order.order_name)} — complete journey</h2><p className="modal-subtitle">Only events and dates present in source data are shown.</p>
        <div className="detail-grid">
          <section><h3>Acquisition</h3><dl><dt>Channel</dt><dd>{badge(detail.order.channel_attribution)}</dd><dt>Raw source</dt><dd>{text(detail.order.channel_raw_source)}</dd><dt>Source / medium</dt><dd>{text(detail.order.utm_source_raw)} / {text(detail.order.utm_medium_raw)}</dd><dt>Channel method</dt><dd>{text(detail.order.channel_attribution_method)}</dd><dt>Channel conflict</dt><dd>{detail.order.channel_conflict ? "YES" : "NO"}</dd></dl></section>
          <section><h3>Meta attribution</h3><dl><dt>Status</dt><dd>{badge(detail.order.meta_attribution)}</dd><dt>Method</dt><dd>{text(detail.order.meta_attribution_method)}</dd><dt>Evidence</dt><dd>{text(detail.order.meta_attribution_method)}: {text(detail.order.utm_content_raw || detail.order.utm_term_raw || detail.order.utm_campaign_raw || detail.order.utm_source_raw)}</dd><dt>Resolved hierarchy</dt><dd>{metaDisplay(detail.order, detail.order.resolved_ad_id)} → {metaDisplay(detail.order, detail.order.resolved_adset_id)} → {metaDisplay(detail.order, detail.order.resolved_campaign_id)}</dd><dt>Creative</dt><dd>{metaDisplay(detail.order, detail.order.creative_name)} · {metaDisplay(detail.order, detail.order.creative_id)}</dd><dt>Conflict</dt><dd>{text(detail.order.meta_conflict_reason, "NONE")}</dd></dl></section>
          <section><h3>Shopify commerce</h3><dl><dt>Order ID</dt><dd>{detail.order.shopify_order_id}</dd><dt>Ordered value</dt><dd>{money(detail.order.ordered_revenue)}</dd><dt>Current value</dt><dd>{money(detail.order.current_revenue)}</dd><dt>Payment</dt><dd>{text(detail.order.payment_type)}</dd><dt>Financial</dt><dd>{text(detail.order.financial_status)}</dd><dt>Fulfilment</dt><dd>{text(detail.order.fulfillment_status)}</dd><dt>Customer ID</dt><dd>{text(detail.order.customer_key)}</dd></dl></section>
          <section><h3>Shipment</h3><dl><dt>SR order</dt><dd>{text(detail.order.shiprocket_sr_order_id, "NOT MATCHED")}</dd><dt>Shipment ID</dt><dd>{text(detail.order.shipment_id)}</dd><dt>AWB</dt><dd>{text(detail.order.awb)}</dd><dt>Courier</dt><dd>{text(detail.order.courier_name)}</dd><dt>Outcome</dt><dd>{text(detail.order.delivery_outcome)}</dd><dt>Shipped</dt><dd>{date(detail.order.shipped_at)}</dd><dt>Delivered</dt><dd>{date(detail.order.delivered_at)}</dd><dt>NDR / RTO</dt><dd>{detail.order.is_ndr ? "NDR" : detail.order.is_rto ? "RTO" : "NO"}</dd></dl></section>
          <section><h3>Settlement</h3><dl><dt>Status</dt><dd>{text(detail.order.remittance_status, "NOT YET REMITTED")}</dd><dt>CRF</dt><dd>{text(detail.order.crf_id)}</dd><dt>UTR</dt><dd>{text(detail.order.utr)}</dd><dt>Amount</dt><dd>{detail.order.has_remittance_match ? money(detail.order.remitted_amount) : "NOT AVAILABLE"}</dd><dt>Delay</dt><dd>{detail.order.remittance_delay_days == null ? "NOT AVAILABLE" : `${detail.order.remittance_delay_days} days`}</dd></dl></section>
        </div>
        <h3 className="timeline-title">Chronological timeline</h3><div className="timeline">{detail.timeline.length ? detail.timeline.map((event, index) => <article key={`${event.type}-${event.at}-${index}`}><time>{date(event.at, true)}</time><div><strong>{text(event.title)}</strong>{Boolean(event.detail) && <p>{text(event.detail)}</p>}{Boolean(event.location) && <small>{text(event.location)}</small>}{event.type === "REMITTANCE_RECEIVED" && <small>CRF {text(event.crf_id)} · UTR {text(event.utr)}</small>}</div></article>) : <p>NOT AVAILABLE — no dated source events.</p>}</div>
      </aside></div>}
    </main>
  );
}
