"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusinessMetrics, BusinessPerformanceLevel, BusinessPerformanceResponse } from "@/modules/shopify/business-performance";
import { buildBusinessPerformanceQuery, isLatestBusinessPerformanceRequest } from "@/modules/shopify/business-performance-request";
import "./business.css";

type MetricKey = keyof BusinessMetrics;
const definitions: Record<string, string> = {
  grossRevenue: "Gross Revenue = SUM(original Shopify order total) for the selected Shopify order-created date cohort.",
  currentRevenue: "Current Revenue = SUM(current Shopify order total). This is the normalized current_total_price value.",
  deliveredRevenue: "Delivered Revenue = SUM(current Shopify revenue where the canonical Journey delivery outcome is DELIVERED.",
  revenueLoss: "Revenue Loss = Gross Revenue - Delivered Revenue.",
  revenueSurvivalPct: "Revenue Survival % = Delivered Revenue / Gross Revenue × 100. Unavailable when Gross Revenue is zero.",
  orders: "Orders = COUNT(DISTINCT shopify_order_id) at one row per Shopify order.",
  paid: "Paid = orders whose normalized financial_status is exactly PAID, matching existing Shopify analytics semantics.",
  aov: "AOV = Gross Revenue / Orders.",
  deliveredOrders: "Delivered Orders = orders whose canonical Journey delivery outcome is DELIVERED.",
  deliveredAov: "Delivered AOV = Delivered Revenue / Delivered Orders.",
  shipRate: "Ship Rate = canonically shipped orders / Orders × 100. is_shipped is the existing matched-Shipment flag.",
  deliveryRate: "Delivery Rate = canonically delivered orders / Orders × 100.",
  rtoRate: "RTO Rate = canonical RTO orders / canonically shipped orders × 100.",
  ndrRate: "Open NDR Rate = currently unresolved canonical is_ndr orders / canonically shipped orders × 100. Delivered and RTO orders are not counted as open NDR.",
  cancelRate: "Cancel Rate = Shopify orders cancelled in Shopify (cancelled_at is not null) / Orders × 100. This is separate from Journey shipment cancellation.",
  gross: "Revenue waterfall Gross = verified original Shopify order total.",
  current: "Revenue waterfall Current = verified current Shopify order total.",
  shippedRevenue: "Revenue waterfall Shipped = SUM(current Shopify revenue for canonically shipped orders).",
  remitted: "Revenue waterfall Remitted = SUM(effective remitted_amount for COD orders with remittance_status REMITTED). This is COD settlement evidence, not total delivered revenue.",
};

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function formatPercent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}
function valueFor(metrics: BusinessMetrics, key: MetricKey): string {
  const value = metrics[key] as number | null;
  if (key.endsWith("Revenue") || ["gross", "current", "shippedRevenue", "remitted", "revenueLoss"].includes(key)) return formatMoney(value);
  if (["revenueSurvivalPct", "shipRate", "deliveryRate", "rtoRate", "ndrRate", "cancelRate"].includes(key)) return formatPercent(value);
  if (["aov", "deliveredAov"].includes(key)) return formatMoney(value);
  return formatNumber(value);
}

function useFloatingTooltip() {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const update = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, window.innerWidth - 20);
    const left = Math.max(width / 2 + 10, Math.min(rect.left + rect.width / 2, window.innerWidth - width / 2 - 10));
    const above = rect.top > 120;
    setStyle({ left, top: above ? rect.top - 8 : rect.bottom + 8, transform: above ? "translate(-50%, -100%)" : "translateX(-50%)" });
  }, []);
  useEffect(() => {
    if (!open) return;
    update();
    const onChange = () => update();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => { window.removeEventListener("resize", onChange); window.removeEventListener("scroll", onChange, true); };
  }, [open, update]);
  return { ref, open, setOpen, style };
}

function Tip({ label, children }: { label: string; children: string }) {
  const tooltip = useFloatingTooltip();
  return <><span ref={tooltip.ref} className="business-tip-trigger" tabIndex={0} aria-label={`${label}: ${children}`} onMouseEnter={() => tooltip.setOpen(true)} onMouseLeave={() => tooltip.setOpen(false)} onFocus={() => tooltip.setOpen(true)} onBlur={() => tooltip.setOpen(false)} onKeyDown={(event) => { if (event.key === "Escape") tooltip.setOpen(false); }}>{label}</span>{tooltip.open && typeof document !== "undefined" ? createPortal(<span className="business-tip" role="tooltip" style={tooltip.style}>{children}</span>, document.body) : null}</>;
}

function MetricCard({ label, metricKey, metrics }: { label: string; metricKey: MetricKey; metrics: BusinessMetrics }) {
  return <article><Tip label={label}>{definitions[metricKey] ?? label}</Tip><strong>{valueFor(metrics, metricKey)}</strong></article>;
}

const qualityColumns: Array<[string, MetricKey]> = [["Orders", "orders"], ["Gross Revenue", "grossRevenue"], ["Current Revenue", "currentRevenue"], ["Delivered Revenue", "deliveredRevenue"], ["Revenue Survival %", "revenueSurvivalPct"], ["Ship Rate", "shipRate"], ["Delivery Rate", "deliveryRate"], ["RTO Rate", "rtoRate"], ["Open NDR Rate", "ndrRate"], ["Cancel Rate", "cancelRate"]];
const waterfallColumns: Array<[string, MetricKey]> = [["Gross", "gross"], ["Current", "current"], ["Shipped", "shippedRevenue"], ["Delivered", "deliveredRevenue"], ["Remitted", "remitted"]];
const marketingColumns: Array<[string, MetricKey]> = [["Orders", "orders"], ["Gross Revenue", "grossRevenue"], ["Current Revenue", "currentRevenue"], ["Delivered Revenue", "deliveredRevenue"], ["Revenue Survival %", "revenueSurvivalPct"], ["Delivery Rate", "deliveryRate"], ["RTO Rate", "rtoRate"], ["Open NDR Rate", "ndrRate"]];
const nextLevel: Record<BusinessPerformanceLevel, BusinessPerformanceLevel | null> = { source: "medium", medium: "campaign", campaign: "content", content: "term", term: null };

export function ShopifyBusinessPerformanceView({ embedded = false, from, to }: { embedded?: boolean; from?: string; to?: string }) {
  const [standaloneRange, setStandaloneRange] = useState<"7d" | "30d" | "90d" | "custom">("30d");
  const [standaloneFrom, setStandaloneFrom] = useState("");
  const [standaloneTo, setStandaloneTo] = useState("");
  const [level, setLevel] = useState<BusinessPerformanceLevel>("source");
  const [parents, setParents] = useState<Record<string, string>>({});
  const [data, setData] = useState<BusinessPerformanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);
  const query = useMemo(() => {
    return buildBusinessPerformanceQuery({ embedded, from, to, range: standaloneRange, customFrom: standaloneFrom, customTo: standaloneTo, level, parents });
  }, [embedded, from, to, standaloneRange, standaloneFrom, standaloneTo, level, parents]);
  useEffect(() => {
    const requestId = ++requestSequence.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/shopify/business-performance?${query}`, { credentials: "include", signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Failed to load Shopify business performance"); return body as BusinessPerformanceResponse; })
      .then((body) => {
        if (!isLatestBusinessPerformanceRequest(requestId, requestSequence.current)) return;
        setData(body);
        setLoading(false);
      }).catch((reason) => {
        if (reason.name === "AbortError" || !isLatestBusinessPerformanceRequest(requestId, requestSequence.current)) return;
        setError(reason instanceof Error ? reason.message : "Failed to load Shopify business performance");
        setLoading(false);
      });
    return () => controller.abort();
  }, [query]);
  const selectGroup = (label: string) => { const next = nextLevel[level]; if (!next) return; setParents((current) => ({ ...current, [level]: label })); setLevel(next); };
  const goTo = (target: BusinessPerformanceLevel | "root") => {
    if (target === "root") { setParents({}); setLevel("source"); return; }
    const order: BusinessPerformanceLevel[] = ["source", "medium", "campaign", "content", "term"];
    const index = order.indexOf(target); setParents((current) => Object.fromEntries(Object.entries(current).filter(([key]) => order.indexOf(key as BusinessPerformanceLevel) < index))); setLevel(target);
  };
  const shellClass = embedded ? "business-page business-embedded" : "business-page";
  const responseScope = data?.range;
  const requestedScope = embedded && from && to ? { from, to } : null;
  const scope = responseScope || requestedScope;
  const scopeLabel = scope ? `${new Date(scope.from).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} → ${new Date(scope.to).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "Loading selected range…";
  if (error) return <main className={shellClass}><p className="business-error">{error}</p></main>;
  if (!data) return <main className={shellClass}><p className="business-scope">Selected Shopify cohort: {scopeLabel} · Basis: Shopify order-created date</p><p>{loading ? "Loading Shopify Business Performance…" : "No Shopify Business Performance data available."}</p></main>;
  const m = data.metrics;
  return <main className={shellClass}>
    <header className="business-header"><div>{!embedded && <Link href="/dashboard/shopify">← Shopify Analytics</Link>}<h1>Shopify Business Performance</h1><p>Shopify-order-centric performance using canonical Journey delivery and effective COD remittance evidence.</p><p className="business-scope">Selected Shopify cohort: {scopeLabel} · Basis: Shopify order-created date</p></div>{!embedded && <div className="business-controls"><select value={standaloneRange} onChange={(event) => setStandaloneRange(event.target.value as typeof standaloneRange)}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="custom">Custom</option></select>{standaloneRange === "custom" && <><input type="date" value={standaloneFrom} onChange={(event) => setStandaloneFrom(event.target.value)} /><input type="date" value={standaloneTo} onChange={(event) => setStandaloneTo(event.target.value)} /></>}</div>}</header>
    <section><h2>Business KPIs</h2><div className="business-cards">{[["Gross Revenue", "grossRevenue"], ["Current Revenue", "currentRevenue"], ["Delivered Revenue", "deliveredRevenue"], ["Revenue Loss", "revenueLoss"], ["Revenue Survival %", "revenueSurvivalPct"], ["Orders", "orders"], ["Paid", "paid"], ["AOV", "aov"], ["Delivered AOV", "deliveredAov"]].map(([label, key]) => <MetricCard key={key} label={label} metricKey={key as MetricKey} metrics={m} />)}</div></section>
    <section><h2>Order Quality</h2><MetricTable metrics={m} columns={qualityColumns} /></section>
    <section><h2>Revenue Waterfall</h2><MetricTable metrics={m} columns={waterfallColumns} /></section>
    <section><h2>Payment Quality</h2><div className="business-table-wrap"><table><thead><tr><th>Payment</th>{qualityColumns.map(([label, key]) => <th key={key}><Tip label={label}>{definitions[key] ?? label}</Tip></th>)}</tr></thead><tbody>{(["COD", "PREPAID"] as const).map((payment) => <tr key={payment}><th>{payment}</th>{qualityColumns.map(([, key]) => <td key={key}>{valueFor(data.payment[payment], key)}</td>)}</tr>)}</tbody></table>{data.unknownPaymentOrders > 0 && <p className="business-note">{formatNumber(data.unknownPaymentOrders)} orders have UNKNOWN/OTHER payment classification and are not silently merged into COD or PREPAID.</p>}</div></section>
    <section><h2>Marketing Source Quality</h2><nav className="business-breadcrumb"><button onClick={() => goTo("root")}>Source</button>{(["source", "medium", "campaign", "content", "term"] as BusinessPerformanceLevel[]).filter((item) => parents[item]).map((item) => <span key={item}>› <button onClick={() => goTo(item)}>{parents[item]}</button></span>)}<strong>› {level}</strong></nav><div className="business-table-wrap"><table><thead><tr><th>{level}</th>{marketingColumns.map(([label, key]) => <th key={key}><Tip label={label}>{definitions[key] ?? label}</Tip></th>)}</tr></thead><tbody>{data.marketing.map((row) => <tr key={row.key} onClick={() => selectGroup(row.label)}><th>{row.label}</th>{marketingColumns.map(([, key]) => <td key={key}>{valueFor(row.metrics, key)}</td>)}</tr>)}</tbody></table></div></section>
    <p className="business-footnote">Base grain: {data.grain}. Rows: {formatNumber(data.baseRows)} · distinct orders: {formatNumber(data.distinctOrders)} · Journey rows: {formatNumber(data.postJourneyRows)} · post-remittance rows: {formatNumber(data.postRemittanceRows)}. Remitted is COD settlement evidence; prepaid orders do not enter Shiprocket COD remittance.</p>
  </main>;
}

export default function ShopifyBusinessPerformancePage() {
  return <ShopifyBusinessPerformanceView />;
}

function MetricTable({ metrics, columns }: { metrics: BusinessMetrics; columns: Array<[string, MetricKey]> }) {
  return <div className="business-table-wrap"><table><thead><tr>{columns.map(([label, key]) => <th key={key}><Tip label={label}>{definitions[key] ?? label}</Tip></th>)}</tr></thead><tbody><tr>{columns.map(([, key]) => <td key={key}>{valueFor(metrics, key)}</td>)}</tr></tbody></table></div>;
}
