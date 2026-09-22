"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusinessMetrics, BusinessPerformanceLevel, BusinessPerformanceResponse, PostShipmentOutcome } from "@/modules/shopify/business-performance";
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
  notShipped: "Not Shipped = Shopify orders where canonical Journey is_shipped is not true. This is the complement of the physical shipment cohort.",
  shipped: "Shipped = Shopify orders where canonical Journey is_shipped is true. AWB assignment alone is not sufficient.",
  paid: "Paid = orders whose normalized financial_status is exactly PAID, matching existing Shopify analytics semantics.",
  aov: "AOV = Gross Revenue / Orders.",
  deliveredOrders: "Delivered Orders = orders whose canonical Journey delivery outcome is DELIVERED.",
  deliveredAov: "Delivered AOV = Delivered Revenue / Delivered Orders.",
  shipRate: "Ship Rate = physically shipped orders / Orders × 100. Canonical is_shipped requires matched Shiprocket lifecycle evidence; AWB assignment alone is excluded.",
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

const waterfallColumns: Array<[string, MetricKey]> = [["Gross", "gross"], ["Current", "current"], ["Shipped", "shippedRevenue"], ["Delivered", "deliveredRevenue"], ["Remitted", "remitted"]];
const nextLevel: Record<BusinessPerformanceLevel, BusinessPerformanceLevel | null> = { source: "medium", medium: "campaign", campaign: "content", content: "term", term: null };

function postShipmentPercent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

function formatCountWithRate(count: number, rate: number | null): string {
  return `${formatNumber(count)} (${postShipmentPercent(rate)})`;
}

type DrilldownSelection = { title: string; orderIds: string[] };

type JourneyDetail = {
  order: Record<string, unknown>;
  attribution: Record<string, unknown> | null;
  shipment: Record<string, unknown> | null;
  remittances: Record<string, unknown>[];
  timeline: Record<string, unknown>[];
};

function detailText(value: unknown, fallback = "NOT AVAILABLE"): string {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value)) return value.map(String).join(", ") || fallback;
  return String(value);
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  return <div className="business-detail-field"><dt>{label}</dt><dd>{detailText(value)}</dd></div>;
}

function JourneyDetailModal({ detail, loading, error, onClose }: { detail: JourneyDetail | null; loading: boolean; error: string | null; onClose: () => void }) {
  if (!loading && !error && !detail) return null;
  const order = detail?.order ?? {};
  const attribution = detail?.attribution ?? {};
  const shipment = detail?.shipment ?? {};
  const remittance = detail?.remittances?.[0] ?? {};
  const metaNotApplicable = String(order.meta_attribution_state ?? "").toUpperCase() === "NO_META_MATCH" || !order.resolved_campaign_id && !order.resolved_adset_id && !order.resolved_ad_id;
  const metaValue = (value: unknown) => metaNotApplicable ? "NOT APPLICABLE" : detailText(value);
  return <div className="business-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="business-detail-modal" role="dialog" aria-modal="true" aria-label="Order Journey detail"><div className="business-drilldown-heading"><strong>Order Journey · {detailText(order.order_name || order.order_number || order.shopify_order_id)}</strong><button type="button" onClick={onClose}>Close</button></div>{loading && <p>Loading Journey detail…</p>}{error && <p className="business-error">{error}</p>}{detail && <div className="business-detail-content">
    <section><h3>Shopify</h3><dl><DetailField label="Order Number" value={order.order_number || order.order_name} /><DetailField label="Shopify Order ID" value={order.shopify_order_id} /><DetailField label="Created At" value={order.created_at_shopify} /><DetailField label="Ordered / Gross Revenue" value={order.ordered_revenue} /><DetailField label="Current Revenue" value={order.current_revenue} /><DetailField label="Total Discounts" value={order.total_discounts} /><DetailField label="Financial Status" value={order.financial_status} /><DetailField label="Fulfillment Status" value={order.fulfillment_status} /><DetailField label="Payment Type" value={order.payment_type} /><DetailField label="Payment Gateway" value={order.shopify_payment_gateway_names} /><DetailField label="Shopify Cancelled At" value={order.cancelled_at} /><DetailField label="Cancel Reason" value={order.cancel_reason} /><DetailField label="Shopify Source" value={order.source_name} /></dl></section>
    <section><h3>Marketing / Attribution</h3><dl><DetailField label="Channel" value={order.channel || attribution.channel} /><DetailField label="UTM Source" value={attribution.utm_source_raw} /><DetailField label="UTM Medium" value={attribution.utm_medium_raw} /><DetailField label="UTM Campaign" value={attribution.utm_campaign_raw} /><DetailField label="UTM Content" value={attribution.utm_content_raw} /><DetailField label="UTM Term" value={attribution.utm_term_raw} /><DetailField label="Meta Attribution State" value={order.meta_attribution_state} /><DetailField label="Attribution Method" value={order.attribution_method || attribution.attribution_method} /><DetailField label="Tracking Quality" value={attribution.tracking_quality} /><DetailField label="Hierarchy Conflict" value={order.hierarchy_conflict} /><DetailField label="Campaign" value={metaNotApplicable ? "NOT APPLICABLE" : `${detailText(order.resolved_campaign_id)} · ${detailText(order.resolved_campaign_name)}`} /><DetailField label="Ad Set" value={metaNotApplicable ? "NOT APPLICABLE" : `${detailText(order.resolved_adset_id)} · ${detailText(order.resolved_adset_name)}`} /><DetailField label="Ad" value={metaNotApplicable ? "NOT APPLICABLE" : `${detailText(order.resolved_ad_id)} · ${detailText(order.resolved_ad_name)}`} /><DetailField label="Creative" value={metaValue(order.creative_name || order.creative_id)} /></dl></section>
    <section><h3>Shiprocket</h3><dl><DetailField label="Shiprocket Order ID" value={order.shiprocket_sr_order_id || shipment.sr_order_id} /><DetailField label="AWB" value={order.awb || shipment.awb} /><DetailField label="Shipment ID" value={order.shipment_id || shipment.shipment_id} /><DetailField label="Courier" value={order.courier_name || shipment.courier_name} /><DetailField label="is_shipped" value={order.is_shipped} /><DetailField label="Delivery Outcome" value={order.delivery_outcome} /><DetailField label="Shipment Status" value={shipment.shipment_status || order.shiprocket_status_raw} /><DetailField label="Current Status" value={shipment.current_status || order.shiprocket_current_status_raw} /><DetailField label="Shipment Status ID" value={shipment.shipment_status_id || order.shiprocket_status_id} /><DetailField label="Current Status ID" value={shipment.current_status_id || order.shiprocket_current_status_id} /><DetailField label="Shipped At" value={order.shipped_at} /><DetailField label="Delivered At" value={order.delivered_at || shipment.delivered_date} /><DetailField label="is_delivered" value={order.is_delivered} /><DetailField label="is_rto" value={order.is_rto} /><DetailField label="is_ndr" value={order.is_ndr} /><DetailField label="had_ndr" value={order.had_ndr} /><DetailField label="Undelivered Reason" value={shipment.undelivered_reason || order.undelivered_reason} /><DetailField label="Undelivered Reason Code" value={shipment.undelivered_reason_code || order.undelivered_reason_code} /><DetailField label="Delivery Attempts" value={shipment.delivery_attempt_count || order.delivery_attempt_count} /></dl></section>
    <section><h3>Remittance</h3>{order.payment_type === "PREPAID" ? <p>COD remittance is not applicable for prepaid orders.</p> : <dl><DetailField label="Remittance Status" value={order.remittance_status} /><DetailField label="CRF" value={order.crf_id || remittance.crf_id} /><DetailField label="UTR" value={order.utr || remittance.utr} /><DetailField label="Remittance Date" value={order.latest_remittance_date || remittance.remittance_date} /><DetailField label="Order Value" value={order.remittance_order_value_total || remittance.order_value} /><DetailField label="Adjusted Amount" value={order.latest_total_adjusted_amt || remittance.total_adjusted_amt} /><DetailField label="Match Status" value={order.remittance_status || remittance.match_status} /><DetailField label="Match Method" value={remittance.match_method} /></dl>}</section>
    <section><h3>Shipment Timeline</h3>{detail.timeline.length === 0 ? <p>NO TIMELINE EVENTS</p> : <ol className="business-timeline">{detail.timeline.map((event, index) => <li key={`${String(event.at)}-${index}`}><strong>{detailText(event.title)}</strong><time>{detailText(event.at)}</time><span>{detailText(event.detail, "")}{event.location ? ` · ${detailText(event.location)}` : ""}</span></li>)}</ol>}</section>
  </div>}</section></div>;
}

function PostShipmentOutcomeSection({ data, onSelect }: { data: BusinessPerformanceResponse; onSelect: (selection: DrilldownSelection) => void }) {
  const metrics = data.metrics.postShipment;
  const selectOutcome = (outcome: PostShipmentOutcome, title: string) => onSelect({ title, orderIds: data.postShipmentOrders.filter((row) => row.outcome === outcome).map((row) => row.shopify_order_id) });
  return <section>
    <h2>Post-Shipment Outcome</h2>
    <p className="business-note">Every shipped order must resolve to Active Shipment, Delivered, or RTO + Open NDR. Percentages use shipped orders as the denominator.</p>
    <div className="business-table-wrap"><table className="post-shipment-table"><thead><tr><th>Outcome</th><th>Orders</th><th>% of Shipped</th></tr></thead><tbody>
      {([["ACTIVE", "Active Shipment", metrics.active, metrics.activeRate], ["DELIVERED", "Delivered", metrics.delivered, metrics.deliveredRate], ["RTO_NDR", "RTO + Open NDR", metrics.rtoNdr, metrics.rtoNdrRate]] as Array<[PostShipmentOutcome, string, number, number | null]>).map(([key, label, count, pct]) => <tr key={key}><th><button type="button" className="business-outcome-button" onClick={() => selectOutcome(key, `${label} orders`)}>{label}</button>{key === "ACTIVE" && <small>Picked Up · Shipped · In Transit · Out for Delivery</small>}{key === "RTO_NDR" && <small>RTO: {metrics.rto} · Open NDR: {metrics.openNdr}</small>}</th><td><button type="button" className="business-cell-button" onClick={() => selectOutcome(key, `${label} orders`)}>{formatNumber(count)}</button></td><td>{postShipmentPercent(pct)}</td></tr>)}
      <tr className="business-total-row"><th><button type="button" className="business-outcome-button" onClick={() => onSelect({ title: "All shipped orders", orderIds: data.postShipmentOrders.filter((row) => row.outcome !== "NOT_SHIPPED").map((row) => row.shopify_order_id) })}>Total Shipped</button></th><td>{formatNumber(metrics.shipped)}</td><td>100.00%</td></tr>
    </tbody></table></div>
    <p className={`business-reconciliation ${metrics.countReconciles && metrics.percentReconciles ? "good" : "warning"}`}>{metrics.countReconciles && metrics.percentReconciles ? "Post-shipment buckets reconcile to shipped orders and 100%." : `POST_SHIPMENT_UNCLASSIFIED: ${metrics.unclassified}. The three-bucket reconciliation is not complete.`}</p>
    {metrics.unclassified > 0 && <div className="business-unclassified"><button type="button" className="business-outcome-button" onClick={() => onSelect({ title: "Unclassified shipped orders", orderIds: data.postShipmentOrders.filter((row) => row.outcome === "UNCLASSIFIED").map((row) => row.shopify_order_id) })}>Data quality: {metrics.unclassified} shipped orders require shipment classification</button></div>}
  </section>;
}

function BusinessDrilldown({ data, selection, onClose, onOpenOrder }: { data: BusinessPerformanceResponse; selection: DrilldownSelection | null; onClose: () => void; onOpenOrder: (shopifyOrderId: string) => void }) {
  const pageSize = 50;
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [selection]);
  if (!selection) return null;
  const selected = new Set(selection.orderIds);
  const rows = data.postShipmentOrders.filter((row) => selected.has(row.shopify_order_id));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);
  return <div className="business-drilldown"><div className="business-drilldown-heading"><strong>Contributing Orders · {selection.title} ({formatNumber(rows.length)})</strong><button type="button" onClick={onClose}>Close</button></div><div className="business-table-wrap business-drilldown-table"><table><thead><tr><th>Order #</th><th>Order Date</th><th>Gross / Ordered</th><th>Current</th><th>Payment</th><th>Channel / UTM</th><th>Campaign</th><th>Ad Set</th><th>Ad</th><th>AWB</th><th>Courier</th><th>Physical State</th><th>Outcome</th><th>Shiprocket Status</th><th>NDR / RTO</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.shopify_order_id}><td><button type="button" className="business-order-button" onClick={() => onOpenOrder(row.shopify_order_id)}>{row.order_name || row.order_number || row.shopify_order_id}</button><small>{row.shopify_order_id}</small></td><td>{detailText(row.created_at_shopify)}</td><td>{formatMoney(row.ordered_revenue)}</td><td>{formatMoney(row.current_revenue)}</td><td>{detailText(row.payment_type)}</td><td>{detailText(row.channel)}<small>{detailText(row.utm_source_raw, "")}{row.utm_medium_raw ? ` / ${row.utm_medium_raw}` : ""}</small></td><td>{detailText(row.resolved_campaign_name || row.resolved_campaign_id)}</td><td>{detailText(row.resolved_adset_name || row.resolved_adset_id)}</td><td>{detailText(row.resolved_ad_name || row.resolved_ad_id)}</td><td>{detailText(row.awb)}</td><td>{detailText(row.courier_name)}</td><td>{row.outcome === "NOT_SHIPPED" ? detailText(row.shipmentReason) : row.shiprocket_status_bucket || "PHYSICAL"}</td><td>{detailText(row.outcome)}</td><td>{detailText(row.shiprocket_current_status_raw || row.shiprocket_status_raw)}</td><td>{row.is_rto ? "RTO" : row.is_ndr ? "NDR" : "—"}</td></tr>)}</tbody></table></div>{pageCount > 1 && <div className="business-pagination"><button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div>}</div>;
}

export function ShopifyBusinessPerformanceView({ embedded = false, from, to }: { embedded?: boolean; from?: string; to?: string }) {
  const [standaloneRange, setStandaloneRange] = useState<"7d" | "30d" | "90d" | "custom">("30d");
  const [standaloneFrom, setStandaloneFrom] = useState("");
  const [standaloneTo, setStandaloneTo] = useState("");
  const [level, setLevel] = useState<BusinessPerformanceLevel>("source");
  const [parents, setParents] = useState<Record<string, string>>({});
  const [data, setData] = useState<BusinessPerformanceResponse | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownSelection | null>(null);
  const [journeyDetail, setJourneyDetail] = useState<JourneyDetail | null>(null);
  const [journeyDetailLoading, setJourneyDetailLoading] = useState(false);
  const [journeyDetailError, setJourneyDetailError] = useState<string | null>(null);
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
  const selectRows = (title: string, predicate: (row: BusinessPerformanceResponse["postShipmentOrders"][number]) => boolean) => {
    if (!data) return;
    setDrilldown({ title, orderIds: data.postShipmentOrders.filter(predicate).map((row) => row.shopify_order_id) });
  };
  const marketingMatches = (row: BusinessPerformanceResponse["postShipmentOrders"][number]) => Object.entries(data?.parents ?? {}).every(([key, value]) => `${key}_raw` in row && (String(row[`${key}_raw` as keyof typeof row] ?? "").trim() || "(not set)") === value);
  const openJourneyDetail = (shopifyOrderId: string) => {
    setJourneyDetail(null);
    setJourneyDetailError(null);
    setJourneyDetailLoading(true);
    fetch(`/api/journey/orders/${encodeURIComponent(shopifyOrderId)}`, { credentials: "include" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Journey detail failed"); return body as JourneyDetail & { success?: boolean }; })
      .then((body) => setJourneyDetail(body))
      .catch((reason) => setJourneyDetailError(reason instanceof Error ? reason.message : "Journey detail failed"))
      .finally(() => setJourneyDetailLoading(false));
  };
  if (error) return <main className={shellClass}><p className="business-error">{error}</p></main>;
  if (!data) return <main className={shellClass}><p className="business-scope">Selected Shopify cohort: {scopeLabel} · Basis: Shopify order-created date</p><p>{loading ? "Loading Shopify Business Performance…" : "No Shopify Business Performance data available."}</p></main>;
  const m = data.metrics;
  return <main className={shellClass}>
    <header className="business-header"><div>{!embedded && <Link href="/dashboard/shopify">← Shopify Analytics</Link>}<h1>Shopify Business Performance</h1><p>Shopify-order-centric performance using canonical Journey delivery and effective COD remittance evidence.</p><p className="business-scope">Selected Shopify cohort: {scopeLabel} · Basis: Shopify order-created date</p></div>{!embedded && <div className="business-controls"><select value={standaloneRange} onChange={(event) => setStandaloneRange(event.target.value as typeof standaloneRange)}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="custom">Custom</option></select>{standaloneRange === "custom" && <><input type="date" value={standaloneFrom} onChange={(event) => setStandaloneFrom(event.target.value)} /><input type="date" value={standaloneTo} onChange={(event) => setStandaloneTo(event.target.value)} /></>}</div>}</header>
    <section><h2>Business KPIs</h2><div className="business-cards">{[["Gross Revenue", "grossRevenue"], ["Current Revenue", "currentRevenue"], ["Delivered Revenue", "deliveredRevenue"], ["Revenue Loss", "revenueLoss"], ["Revenue Survival %", "revenueSurvivalPct"], ["Orders", "orders"], ["Paid", "paid"], ["AOV", "aov"], ["Delivered AOV", "deliveredAov"]].map(([label, key]) => <MetricCard key={key} label={label} metricKey={key as MetricKey} metrics={m} />)}</div></section>
    <section><h2>Fulfillment</h2><div className="business-table-wrap"><table><thead><tr><th>Metric</th><th>Orders</th></tr></thead><tbody>
      <tr><th>Orders</th><td><button type="button" className="business-cell-button" onClick={() => selectRows("All Shopify orders", () => true)}>{formatNumber(m.orders)}</button></td></tr>
      <tr><th>Not Shipped</th><td><button type="button" className="business-cell-button" onClick={() => selectRows("Not shipped orders", (row) => row.outcome === "NOT_SHIPPED")}>{formatNumber(m.notShipped)}</button></td></tr>
      <tr><th>Shipped</th><td><button type="button" className="business-cell-button" onClick={() => selectRows("All shipped orders", (row) => row.outcome !== "NOT_SHIPPED")}>{formatNumber(m.shipped)}</button></td></tr>
      <tr><th>Ship Rate</th><td><button type="button" className="business-cell-button" onClick={() => selectRows("All shipped orders", (row) => row.outcome !== "NOT_SHIPPED")}>{formatPercent(m.shipRate)}</button></td></tr>
      <tr><th>Cancel Rate</th><td><button type="button" className="business-cell-button" onClick={() => selectRows("Shopify cancelled orders", (row) => row.cancelled_at != null)}>{formatPercent(m.cancelRate)}</button></td></tr>
    </tbody></table></div></section>
    <PostShipmentOutcomeSection data={data} onSelect={setDrilldown} />
    <BusinessDrilldown data={data} selection={drilldown} onClose={() => setDrilldown(null)} onOpenOrder={openJourneyDetail} />
    <section><h2>Revenue Waterfall</h2><MetricTable metrics={m} columns={waterfallColumns} /></section>
    <section><h2>Payment Quality</h2><div className="business-table-wrap"><table><thead><tr><th>Payment</th><th>Orders</th><th>Not Shipped</th><th>Shipped</th><th>Ship Rate</th><th>Active Shipment</th><th>Delivered</th><th>RTO + Open NDR</th><th>Revenue Survival %</th><th>Cancel Rate</th></tr></thead><tbody>{(["COD", "PREPAID"] as const).map((payment) => { const item = data.payment[payment]; const choose = (title: string, predicate: (row: BusinessPerformanceResponse["postShipmentOrders"][number]) => boolean) => selectRows(`${payment} · ${title}`, (row) => row.payment_type === payment && predicate(row)); return <tr key={payment}><th>{payment}</th><td><button type="button" className="business-cell-button" onClick={() => choose("orders", () => true)}>{formatNumber(item.orders)}</button></td><td><button type="button" className="business-cell-button" onClick={() => choose("not shipped", (row) => row.outcome === "NOT_SHIPPED")}>{formatCountWithRate(item.notShipped, item.orders ? item.notShipped / item.orders * 100 : null)}</button></td><td><button type="button" className="business-cell-button" onClick={() => choose("shipped", (row) => row.outcome !== "NOT_SHIPPED")}>{formatCountWithRate(item.shipped, item.shipRate)}</button></td><td><button type="button" className="business-cell-button" onClick={() => choose("shipped", (row) => row.outcome !== "NOT_SHIPPED")}>{formatPercent(item.shipRate)}</button></td><td><button type="button" className="business-cell-button" onClick={() => choose("active", (row) => row.outcome === "ACTIVE")}>{formatCountWithRate(item.postShipment.active, item.postShipment.activeRate)}</button></td><td><button type="button" className="business-cell-button" onClick={() => choose("delivered", (row) => row.outcome === "DELIVERED")}>{formatCountWithRate(item.postShipment.delivered, item.postShipment.deliveredRate)}</button></td><td><button type="button" className="business-cell-button" onClick={() => choose("RTO + open NDR", (row) => row.outcome === "RTO_NDR")}>{formatCountWithRate(item.postShipment.rtoNdr, item.postShipment.rtoNdrRate)}</button></td><td>{formatPercent(item.revenueSurvivalPct)}</td><td><button type="button" className="business-cell-button" onClick={() => choose("cancelled", (row) => row.cancelled_at != null)}>{formatPercent(item.cancelRate)}</button></td></tr>; })}</tbody></table>{data.unknownPaymentOrders > 0 && <p className="business-note">{formatNumber(data.unknownPaymentOrders)} orders have UNKNOWN/OTHER payment classification and are not silently merged into COD or PREPAID.</p>}</div></section>
    <section><h2>Marketing Source Quality</h2><nav className="business-breadcrumb"><button onClick={() => goTo("root")}>Source</button>{(["source", "medium", "campaign", "content", "term"] as BusinessPerformanceLevel[]).filter((item) => parents[item]).map((item) => <span key={item}>› <button onClick={() => goTo(item)}>{parents[item]}</button></span>)}<strong>› {level}</strong></nav><div className="business-table-wrap"><table><thead><tr><th>{level}</th><th>Orders</th><th>Not Shipped</th><th>Shipped</th><th>Ship Rate</th><th>Active Shipment</th><th>Delivered</th><th>RTO + Open NDR</th><th>Revenue Survival %</th></tr></thead><tbody>{data.marketing.map((row) => { const groupPredicate = (item: BusinessPerformanceResponse["postShipmentOrders"][number]) => marketingMatches(item) && (String(item[`${level}_raw` as keyof typeof item] ?? "").trim() || "(not set)") === row.label; return <tr key={row.key} onClick={() => selectGroup(row.label)}><th>{row.label}</th><td><button type="button" className="business-cell-button" onClick={(event) => { event.stopPropagation(); selectRows(`${row.label} orders`, groupPredicate); }}>{formatNumber(row.metrics.orders)}</button></td><td><button type="button" className="business-cell-button" onClick={(event) => { event.stopPropagation(); selectRows(`${row.label} · not shipped`, (item) => groupPredicate(item) && item.outcome === "NOT_SHIPPED"); }}>{formatCountWithRate(row.metrics.notShipped, row.metrics.orders ? row.metrics.notShipped / row.metrics.orders * 100 : null)}</button></td><td><button type="button" className="business-cell-button" onClick={(event) => { event.stopPropagation(); selectRows(`${row.label} · shipped`, (item) => groupPredicate(item) && item.outcome !== "NOT_SHIPPED"); }}>{formatCountWithRate(row.metrics.shipped, row.metrics.shipRate)}</button></td><td><button type="button" className="business-cell-button" onClick={(event) => { event.stopPropagation(); selectRows(`${row.label} · shipped`, (item) => groupPredicate(item) && item.outcome !== "NOT_SHIPPED"); }}>{formatPercent(row.metrics.shipRate)}</button></td><td><button type="button" className="business-cell-button" onClick={(event) => { event.stopPropagation(); selectRows(`${row.label} · active`, (item) => groupPredicate(item) && item.outcome === "ACTIVE"); }}>{formatCountWithRate(row.metrics.postShipment.active, row.metrics.postShipment.activeRate)}</button></td><td><button type="button" className="business-cell-button" onClick={(event) => { event.stopPropagation(); selectRows(`${row.label} · delivered`, (item) => groupPredicate(item) && item.outcome === "DELIVERED"); }}>{formatCountWithRate(row.metrics.postShipment.delivered, row.metrics.postShipment.deliveredRate)}</button></td><td><button type="button" className="business-cell-button" onClick={(event) => { event.stopPropagation(); selectRows(`${row.label} · RTO + open NDR`, (item) => groupPredicate(item) && item.outcome === "RTO_NDR"); }}>{formatCountWithRate(row.metrics.postShipment.rtoNdr, row.metrics.postShipment.rtoNdrRate)}</button></td><td>{formatPercent(row.metrics.revenueSurvivalPct)}</td></tr>; })}</tbody></table></div></section>
    <p className="business-footnote">Base grain: {data.grain}. Rows: {formatNumber(data.baseRows)} · distinct orders: {formatNumber(data.distinctOrders)} · Journey rows: {formatNumber(data.postJourneyRows)} · post-remittance rows: {formatNumber(data.postRemittanceRows)}. Remitted is COD settlement evidence; prepaid orders do not enter Shiprocket COD remittance.</p>
    <JourneyDetailModal detail={journeyDetail} loading={journeyDetailLoading} error={journeyDetailError} onClose={() => { setJourneyDetail(null); setJourneyDetailError(null); setJourneyDetailLoading(false); }} />
  </main>;
}

export default function ShopifyBusinessPerformancePage() {
  return <ShopifyBusinessPerformanceView />;
}

function MetricTable({ metrics, columns }: { metrics: BusinessMetrics; columns: Array<[string, MetricKey]> }) {
  return <div className="business-table-wrap"><table><thead><tr>{columns.map(([label, key]) => <th key={key}><Tip label={label}>{definitions[key] ?? label}</Tip></th>)}</tr></thead><tbody><tr>{columns.map(([, key]) => <td key={key}>{valueFor(metrics, key)}</td>)}</tr></tbody></table></div>;
}
