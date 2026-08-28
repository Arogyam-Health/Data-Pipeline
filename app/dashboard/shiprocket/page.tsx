"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./shiprocket-dashboard.css";

interface FilterField {
  key: string;
  label: string;
  type: string;
  operators: string[];
  group?: string;
}

interface FilterRow {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface OrderRow {
  sr_order_id: string;
  [key: string]: unknown;
}

interface Overview {
  totalOrders: number;
  delivered: number;
  inTransit: number;
  outForDelivery: number;
  rto: number;
  ndr: number;
  deliveryRate: number;
  codOrders: number;
  prepaidOrders: number;
  totalOrderValue: number;
  settledOrders: number;
  unmatchedRemittanceOrders: number;
  remittanceAmountOnLatestCrf: number;
  orderSettlementValue: number;
  distinctCrfs: number;
  distinctUtrs: number;
  shopifyMatchPct: number;
  phoneCoveragePct: number;
}

interface AppliedFilter {
  field: string;
  operator: string;
  value?: unknown;
}

const DEFAULT_COLUMNS = [
  "sr_order_id",
  "order_id",
  "order_id_shopify_format",
  "awb",
  "shipment_status",
  "current_status",
  "courier_name",
  "customer_name_shopify",
  "customer_phone_shopify",
  "payment_method",
  "order_total",
  "delivered_date",
  "latest_crf_id",
  "latest_utr",
  "latest_remittance_status",
  "latest_remittance_date",
  "coach",
];

const MONO_COLUMNS = new Set([
  "sr_order_id",
  "order_id",
  "order_id_shopify_format",
  "awb",
  "latest_crf_id",
  "latest_utr",
  "shipment_id",
  "return_awb_code",
]);

const COLUMN_STORAGE_KEY = "shiprocket-visible-columns-v1";

const SHORTCUTS: Array<{ label: string; filters: AppliedFilter[] }> = [
  { label: "7 days", filters: [{ field: "last_webhook_sync_at", operator: "last_7_days" }] },
  { label: "30 days", filters: [{ field: "last_webhook_sync_at", operator: "last_30_days" }] },
  { label: "Delivered", filters: [{ field: "status_bucket", operator: "eq", value: "delivered" }] },
  { label: "In Transit", filters: [{ field: "status_bucket", operator: "eq", value: "in_transit" }] },
  { label: "RTO", filters: [{ field: "status_bucket", operator: "eq", value: "rto" }] },
  { label: "NDR", filters: [{ field: "status_bucket", operator: "eq", value: "ndr" }] },
  { label: "COD", filters: [{ field: "payment_bucket", operator: "eq", value: "COD" }] },
  { label: "Shopify Matched", filters: [{ field: "shopify_matched", operator: "true" }] },
  { label: "No Remittance", filters: [{ field: "remittance_match_status", operator: "eq", value: "unmatched" }] },
];

function dash(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function money(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash(value);
  if (n === 0) return "₹0.00";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
}

function persistColumns(cols: string[]) {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(cols));
  } catch {
    /* ignore */
  }
}

function filtersEqual(a: AppliedFilter[], b: AppliedFilter[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((f, i) => {
    const g = b[i];
    return f.field === g.field && f.operator === g.operator && JSON.stringify(f.value) === JSON.stringify(g.value);
  });
}

function statusBadgeClass(value: unknown): string {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("deliver")) return "sr-status-badge sr-status-delivered";
  if (text.includes("transit") || text.includes("ofd") || text.includes("out for")) return "sr-status-badge sr-status-transit";
  if (text.includes("rto")) return "sr-status-badge sr-status-rto";
  if (text.includes("ndr")) return "sr-status-badge sr-status-ndr";
  if (text.includes("remittance")) return "sr-status-badge sr-status-remittance";
  return "sr-status-badge sr-status-default";
}

function renderCell(col: string, value: unknown): ReactNode {
  if (value == null || value === "") {
    return <span className="sr-muted">—</span>;
  }
  if (col.includes("status") || col === "status_bucket") {
    return <span className={statusBadgeClass(value)}>{String(value)}</span>;
  }
  if (col === "order_total" || col.includes("settlement") || col.includes("amount")) {
    return money(value);
  }
  if (MONO_COLUMNS.has(col)) {
    return <span className="sr-mono">{String(value)}</span>;
  }
  return String(value);
}

export default function ShiprocketDashboardPage() {
  const [fields, setFields] = useState<FilterField[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [quality, setQuality] = useState<Record<string, unknown> | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilter[]>([]);
  const [sortField, setSortField] = useState("last_webhook_sync_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visible, setVisible] = useState<string[]>(DEFAULT_COLUMNS);
  const [columnQuery, setColumnQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string>("Status");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    order?: OrderRow;
    rawPayload: unknown;
    scans: unknown[];
    remittances: unknown[];
  } | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [remittances, setRemittances] = useState<{
    summary: Record<string, unknown> | null;
    crfs: Array<Record<string, unknown>>;
    imports: Array<Record<string, unknown>>;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>("");
  const columnPopoverRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!showColumns) return;
    function onDocClick(e: MouseEvent) {
      if (columnPopoverRef.current && !columnPopoverRef.current.contains(e.target as Node)) {
        setShowColumns(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showColumns]);

  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawer]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (stored) setVisible(JSON.parse(stored));
    } catch {
      /* ignore */
    }
    fetch("/api/shiprocket/filter-metadata", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setFields(data.fields || []);
        setGroups(data.groups || []);
        if (data.groups?.[0]) setOpenGroup(data.groups[0]);
      })
      .catch(() => undefined);
  }, []);

  const payload = useMemo(
    () => ({
      filters: appliedFilters,
      search: debouncedSearch,
      page,
      pageSize,
      sort: [{ field: sortField, direction: sortDir }],
    }),
    [appliedFilters, debouncedSearch, page, pageSize, sortField, sortDir]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersRes, overviewRes, qualityRes, remRes] = await Promise.all([
        fetch("/api/shiprocket/orders", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        fetch("/api/shiprocket/overview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        fetch("/api/shiprocket/quality", { credentials: "include" }),
        fetch("/api/shiprocket/remittances", { credentials: "include" }),
      ]);
      const ordersBody = await ordersRes.json();
      const overviewBody = await overviewRes.json();
      const qualityBody = await qualityRes.json();
      const remBody = await remRes.json();
      if (!ordersRes.ok) throw new Error(ordersBody.error || "Query failed");
      if (!overviewRes.ok) throw new Error(overviewBody.error || "Overview failed");
      setRows(ordersBody.rows || []);
      setTotal(ordersBody.total || 0);
      setOverview(overviewBody.overview || null);
      setQuality(qualityBody.quality || null);
      setRemittances(remBody);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setLoading(false);
    }
  }, [payload]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const groupedFields = useMemo(() => {
    const out = new Map<string, FilterField[]>();
    for (const field of fields.filter((f) => f.key !== "raw_payload")) {
      const group = field.group || "Other";
      out.set(group, [...(out.get(group) || []), field]);
    }
    return out;
  }, [fields]);

  const groupTabs = groups.length ? groups : [...groupedFields.keys()];
  const categoryFields = groupedFields.get(openGroup) || [];

  const crfSummary = useMemo(() => {
    const crfs = remittances?.crfs || [];
    const awbs = crfs.reduce((sum, row) => sum + Number(row.awb_count || 0), 0);
    return { crfCount: crfs.length, awbCount: awbs };
  }, [remittances]);

  const remittanceQuality = quality?.remittance as Record<string, unknown> | undefined;

  async function openDetail(srOrderId: string) {
    setDrawer(srOrderId);
    setShowRaw(false);
    setDetail(null);
    const res = await fetch(`/api/shiprocket/orders/${encodeURIComponent(srOrderId)}`, {
      credentials: "include",
    });
    const body = await res.json();
    setDetail({
      order: body.order,
      rawPayload: body.rawPayload,
      scans: body.scans || [],
      remittances: body.remittances || [],
    });
  }

  async function exportCsv() {
    const res = await fetch("/api/shiprocket/export", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: appliedFilters,
        search: debouncedSearch,
        sort: [{ field: sortField, direction: sortDir }],
        legacyLabels: false,
      }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shiprocket-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function applyBuilder() {
    const next = filterRows
      .filter((row) => row.field && row.operator)
      .map((row) => {
        const meta = fieldMap.get(row.field);
        let value: unknown = row.value;
        if (["in", "not_in", "is_any_of", "is_none_of"].includes(row.operator)) {
          value = row.value.split(",").map((v) => v.trim()).filter(Boolean);
        } else if (row.operator === "between") {
          const [from, to] = row.value.split("|").map((v) => v.trim());
          value = [from, to];
        } else if (row.operator === "last_n_days") {
          value = Number(row.value);
        }
        if (meta?.type === "number" && !Array.isArray(value) && !["empty", "not_empty"].includes(row.operator)) {
          value = Number(row.value);
        }
        return { field: row.field, operator: row.operator, value };
      });
    setPage(1);
    setAppliedFilters(next);
    setShowAdvancedFilters(false);
  }

  function resetFilters() {
    setAppliedFilters([]);
    setFilterRows([]);
    setSearch("");
    setPage(1);
  }

  async function uploadReport(file: File) {
    setImporting(true);
    setImportResult("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/shiprocket/remittance/import", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Import failed");
      setImportResult(
        `Imported ${body.crfRowsUpserted} CRFs, ${body.awbRowsUpserted} AWB rows, matched ${body.matchedOrders}, unmatched ${body.unmatchedOrders}, canonical orders ${body.canonicalOrdersTotal ?? 0}.` +
          (body.sampleUnmatched?.length
            ? ` Sample unmatched: ${JSON.stringify(body.sampleUnmatched.slice(0, 2))}`
            : "")
      );
      await load();
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const kpiGroups = overview
    ? [
        {
          title: "Operations",
          cards: [
            { label: "Total Orders", value: overview.totalOrders },
            {
              label: "Delivered",
              value: overview.delivered,
              note: overview.totalOrders ? `${overview.deliveryRate}% of orders` : undefined,
            },
            { label: "In Transit", value: overview.inTransit },
            { label: "Out for Delivery", value: overview.outForDelivery },
            { label: "RTO", value: overview.rto },
            { label: "NDR", value: overview.ndr },
            { label: "Delivery Rate", value: `${overview.deliveryRate}%` },
          ],
        },
        {
          title: "Commercial",
          cards: [
            { label: "COD", value: overview.codOrders },
            { label: "Prepaid", value: overview.prepaidOrders },
            { label: "Order Value", value: money(overview.totalOrderValue) },
          ],
        },
        {
          title: "Settlement",
          cards: [
            { label: "Settled Orders", value: overview.settledOrders },
            { label: "Settlement Value", value: money(overview.orderSettlementValue) },
            { label: "CRFs", value: overview.distinctCrfs },
            { label: "UTRs", value: overview.distinctUtrs },
          ],
        },
        {
          title: "Data Quality",
          cards: [
            { label: "Shopify Match", value: `${overview.shopifyMatchPct}%` },
            { label: "Phone Coverage", value: `${overview.phoneCoveragePct}%` },
          ],
        },
      ]
    : [];

  const statusChart = overview
    ? [
        { name: "Delivered", value: overview.delivered },
        { name: "In Transit", value: overview.inTransit },
        { name: "OFD", value: overview.outForDelivery },
        { name: "RTO", value: overview.rto },
        { name: "NDR", value: overview.ndr },
      ]
    : [];

  const pageStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, total);

  const pageNumbers = useMemo(() => {
    const nums: number[] = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(pages, page + 2);
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  }, [page, pages]);

  return (
    <main className="sr-page">
      <div className="sr-container">
        {/* Header */}
        <header className="sr-header">
          <div className="sr-header-main">
            <h1 className="sr-title">Shiprocket</h1>
            <p className="sr-subtitle">Operational shipment, reconciliation and remittance dashboard.</p>
            <nav className="sr-nav">
              <Link href="/dashboard">Home</Link>
              {" / "}
              <strong>Shiprocket</strong>
              {" / "}
              <Link href="/dashboard/shopify">Shopify</Link>
              {" / "}
              <Link href="/dashboard/meta">Meta</Link>
              {" / "}
              <Link href="/dashboard/ga4">GA4</Link>
            </nav>
            <div className="sr-status-row">
              <span className="sr-badge-pill">Parallel validation</span>
              <span className="sr-status-note">Legacy Apps Script + Sheet + Pabbly remain live. New Pabbly remains off.</span>
            </div>
          </div>
          <div className="sr-header-actions">
            <button type="button" onClick={exportCsv} className="sr-btn sr-btn-secondary">
              Export CSV
            </button>
            <button type="button" onClick={load} className="sr-btn sr-btn-primary">
              Refresh
            </button>
          </div>
        </header>

        {/* Search + toolbar */}
        <section className="sr-section sr-card">
          <div className="sr-toolbar">
            <div className="sr-toolbar-row">
              <input
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
                placeholder="Search orders, AWB, customer, CRF, UTR…"
                className="sr-search"
              />
              <button
                type="button"
                className="sr-btn sr-btn-secondary"
                onClick={() => {
                  setPage(1);
                  setAppliedFilters([{ field: "last_webhook_sync_at", operator: "last_30_days" }]);
                }}
              >
                Date Range: 30 days
              </button>
              <button
                type="button"
                className={`sr-btn sr-btn-secondary${showAdvancedFilters ? " sr-chip-active" : ""}`}
                onClick={() => setShowAdvancedFilters((v) => !v)}
              >
                More Filters
              </button>
              <button type="button" className="sr-btn sr-btn-secondary" onClick={resetFilters}>
                Reset
              </button>
            </div>
            <div className="sr-chips-scroll">
              {SHORTCUTS.map((shortcut) => {
                const active = filtersEqual(appliedFilters, shortcut.filters);
                return (
                  <button
                    key={shortcut.label}
                    type="button"
                    onClick={() => {
                      setPage(1);
                      setAppliedFilters(shortcut.filters);
                    }}
                    className={`sr-chip${active ? " sr-chip-active" : ""}`}
                  >
                    {shortcut.label}
                  </button>
                );
              })}
            </div>
            {appliedFilters.length > 0 && (
              <div className="sr-chips">
                {appliedFilters.map((filter, idx) => (
                  <span key={`${filter.field}-${idx}`} className="sr-filter-chip">
                    {fieldMap.get(filter.field)?.label || filter.field}{" "}
                    {filter.operator}{" "}
                    {Array.isArray(filter.value) ? filter.value.join(", ") : String(filter.value ?? "")}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {error && <div className="sr-alert sr-alert-error">{error}</div>}
        {loading && !overview && <p className="sr-loading">Loading dashboard…</p>}

        {/* KPI sections */}
        {kpiGroups.map((group) => (
          <section key={group.title} className="sr-section">
            <h2 className="sr-section-title">{group.title}</h2>
            <div className="sr-kpi-grid">
              {group.cards.map((card) => (
                <div key={card.label} className="sr-kpi-card">
                  <p className="sr-kpi-label">{card.label}</p>
                  <p className="sr-kpi-value">{dash(card.value)}</p>
                  {"note" in card && card.note ? <p className="sr-kpi-note">{card.note}</p> : null}
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* Analytics */}
        <section className="sr-section">
          <h2 className="sr-section-title">Analytics</h2>
          <div className="sr-analytics-grid">
            <div className="sr-card sr-analytics-chart">
              <h3 className="sr-card-title">Shipment Status</h3>
              <div className="sr-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="sr-card sr-analytics-side">
              <h3 className="sr-card-title">Data Quality</h3>
              <div className="sr-mini-metrics">
                <div>
                  <p className="sr-mini-metric-label">Shopify matched</p>
                  <p className="sr-mini-metric-value">{dash(quality?.shopify_matched)}</p>
                </div>
                <div>
                  <p className="sr-mini-metric-label">Shopify unmatched</p>
                  <p className="sr-mini-metric-value">{dash(quality?.shopify_unmatched)}</p>
                </div>
                <div>
                  <p className="sr-mini-metric-label">Remittance matched</p>
                  <p className="sr-mini-metric-value">{dash(remittanceQuality?.matched)}</p>
                </div>
                <div>
                  <p className="sr-mini-metric-label">Remittance unmatched</p>
                  <p className="sr-mini-metric-value">{dash(remittanceQuality?.unmatched)}</p>
                </div>
              </div>
              <p className="sr-subtitle" style={{ marginBottom: "0.75rem" }}>
                Official remittance API not verified. Upload Shiprocket Billing XLS/XLSX report.
              </p>
              <div className="sr-import-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xls,.xlsx"
                  disabled={importing}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadReport(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="sr-btn sr-btn-secondary"
                  disabled={importing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose File
                </button>
                <button type="button" className="sr-btn sr-btn-primary" disabled={importing} onClick={() => fileInputRef.current?.click()}>
                  {importing ? "Importing…" : "Import"}
                </button>
              </div>
              {importResult && <p className="sr-subtitle" style={{ marginTop: "0.5rem" }}>{importResult}</p>}
              {(remittances?.imports || []).length > 0 && (
                <div className="sr-import-history">
                  <p className="sr-mini-metric-label" style={{ marginBottom: "0.35rem" }}>Last import</p>
                  {(remittances?.imports || []).slice(0, 3).map((row) => (
                    <div key={String(row.id)} className="sr-import-item">
                      <span>{dash(row.file_name)}</span>
                      <span className={String(row.status).toLowerCase().includes("complete") ? "sr-status-success" : "sr-status-badge sr-status-default"}>
                        {dash(row.status)}
                      </span>
                      <span>{dash(row.crf_rows_read ?? row.crf_rows_upserted)} CRF</span>
                      <span>{dash(row.awb_rows_read ?? row.awb_rows_upserted)} AWBs</span>
                      <span>{dash(row.matched_orders)} matched</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* CRF settlements */}
        <section className="sr-section">
          <h2 className="sr-section-title">Settlements</h2>
          <div className="sr-card">
            <h3 className="sr-card-title">CRF Settlements</h3>
            {crfSummary.crfCount > 0 && (
              <p className="sr-card-subtitle">
                {crfSummary.crfCount} CRF{crfSummary.crfCount === 1 ? "" : "s"} · {crfSummary.awbCount} AWBs
              </p>
            )}
            <div className="sr-table-scroll">
              <table className="sr-table sr-table-crf">
                <thead>
                  <tr>
                    <th>CRF ID</th>
                    <th>UTR</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="sr-num">Amount</th>
                    <th className="sr-num">AWBs</th>
                  </tr>
                </thead>
                <tbody>
                  {(remittances?.crfs || []).slice(0, 12).map((row) => (
                    <tr key={String(row.crf_id)}>
                      <td>
                        <button
                          type="button"
                          className="sr-table-link sr-mono"
                          onClick={() => {
                            setPage(1);
                            setAppliedFilters([{ field: "latest_crf_id", operator: "eq", value: row.crf_id }]);
                          }}
                        >
                          {dash(row.crf_id)}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="sr-table-link sr-mono"
                          onClick={() => {
                            setPage(1);
                            setAppliedFilters([{ field: "latest_utr", operator: "eq", value: row.utr }]);
                          }}
                        >
                          {dash(row.utr)}
                        </button>
                      </td>
                      <td>{dash(row.remittance_date)}</td>
                      <td>
                        <span className={statusBadgeClass(row.status)}>{dash(row.status)}</span>
                      </td>
                      <td className="sr-num">{money(row.remittance_amount)}</td>
                      <td className="sr-num">{dash(row.awb_count)}</td>
                    </tr>
                  ))}
                  {(remittances?.crfs || []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="sr-muted" style={{ textAlign: "center" }}>
                        No CRF settlements imported yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Orders */}
        <section className="sr-section">
          <h2 className="sr-section-title">Orders</h2>
          <div className="sr-orders-header">
            <h2>Orders</h2>
            <div className="sr-orders-controls">
              <div className="sr-popover-wrap" ref={columnPopoverRef}>
                <button type="button" className="sr-btn sr-btn-secondary" onClick={() => setShowColumns((v) => !v)}>
                  Columns
                </button>
                {showColumns && (
                  <div className="sr-popover">
                    <div className="sr-popover-search">
                      <input
                        value={columnQuery}
                        onChange={(e) => setColumnQuery(e.target.value)}
                        placeholder="Search columns…"
                      />
                    </div>
                    <div className="sr-popover-body">
                      {groupTabs.map((group) => {
                        const cols = (groupedFields.get(group) || []).filter((f) =>
                          f.label.toLowerCase().includes(columnQuery.toLowerCase())
                        );
                        if (cols.length === 0) return null;
                        return (
                          <div key={group} className="sr-column-group">
                            <p className="sr-column-group-title">{group}</p>
                            {cols.map((f) => (
                              <label key={f.key} className="sr-column-option">
                                <input
                                  type="checkbox"
                                  checked={visible.includes(f.key)}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...visible, f.key]
                                      : visible.filter((c) => c !== f.key);
                                    setVisible(next);
                                    persistColumns(next);
                                  }}
                                />
                                {f.label}
                              </label>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <select
                value={pageSize}
                className="sr-select"
                onChange={(e) => {
                  setPage(1);
                  setPageSize(Number(e.target.value));
                }}
              >
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Advanced filters */}
          {showAdvancedFilters && (
          <div className="sr-card sr-section">
            <h3 className="sr-card-title">Advanced Filters</h3>
            <div className="sr-filter-tabs">
              {groupTabs.map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => setOpenGroup(group)}
                  className={`sr-filter-tab${openGroup === group ? " sr-filter-tab-active" : ""}`}
                >
                  {group}
                </button>
              ))}
            </div>
            {filterRows.map((row, idx) => {
              const meta = fieldMap.get(row.field);
              return (
                <div key={row.id}>
                  {idx > 0 && <p className="sr-filter-and">AND</p>}
                  <div className="sr-filter-row">
                    <select
                      value={row.field}
                      onChange={(e) =>
                        setFilterRows((rows) =>
                          rows.map((r) =>
                            r.id === row.id
                              ? { ...r, field: e.target.value, operator: fieldMap.get(e.target.value)?.operators[0] || "eq" }
                              : r
                          )
                        )
                      }
                    >
                      {categoryFields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={row.operator}
                      onChange={(e) =>
                        setFilterRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, operator: e.target.value } : r)))
                      }
                    >
                      {(meta?.operators || []).map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                    <input
                      value={row.value}
                      onChange={(e) =>
                        setFilterRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))
                      }
                      placeholder={row.operator === "between" ? "from|to" : row.operator.includes("any") ? "a, b, c" : "value"}
                    />
                    <button type="button" className="sr-btn sr-btn-ghost" onClick={() => setFilterRows((rows) => rows.filter((r) => r.id !== row.id))}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="sr-filter-actions">
              <button
                type="button"
                className="sr-btn sr-btn-secondary"
                onClick={() =>
                  setFilterRows((rows) => [
                    ...rows,
                    {
                      id: String(Date.now()),
                      field: categoryFields[0]?.key || "shipment_status",
                      operator: categoryFields[0]?.operators[0] || "eq",
                      value: "",
                    },
                  ])
                }
              >
                + Add condition
              </button>
              <button type="button" className="sr-btn sr-btn-primary" onClick={applyBuilder}>
                Apply filters
              </button>
            </div>
          </div>
          )}

          {loading && overview && <p className="sr-loading">Refreshing orders…</p>}

          <div className="sr-table-scroll sr-table-head-sticky">
            <table className="sr-table sr-orders-table">
              <thead>
                <tr>
                  {visible.map((col) => (
                    <th
                      key={col}
                      className="sr-th-sort"
                      onClick={() => {
                        setSortField(col);
                        setSortDir((d) => (sortField === col && d === "desc" ? "asc" : "desc"));
                      }}
                    >
                      {fieldMap.get(col)?.label || col}
                      {sortField === col ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.sr_order_id}>
                    {visible.map((col) => (
                      <td key={col}>{renderCell(col, row[col])}</td>
                    ))}
                    <td>
                      <button type="button" className="sr-table-link" onClick={() => openDetail(row.sr_order_id)}>
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={visible.length + 1} className="sr-muted" style={{ textAlign: "center" }}>
                      No orders match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="sr-pagination">
            <p className="sr-pagination-info">
              Showing {pageStart}–{pageEnd} of {total}
              {appliedFilters.length > 0 || debouncedSearch ? " · filtered" : ""}
            </p>
            <div className="sr-pagination-nav">
              <button type="button" className="sr-btn sr-btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              {pageNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`sr-page-num${n === page ? " sr-page-num-active" : ""}`}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ))}
              <button type="button" className="sr-btn sr-btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Detail drawer */}
      {drawer && (
        <div className="sr-drawer-overlay" onClick={() => setDrawer(null)} role="presentation">
          <aside className="sr-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Order ${drawer}`}>
            <div className="sr-drawer-header">
              <h2 className="sr-drawer-title">Order {dash(detail?.order?.order_id || drawer)}</h2>
              <button type="button" className="sr-btn sr-btn-secondary" onClick={() => setDrawer(null)}>
                ✕
              </button>
            </div>
            <div className="sr-drawer-body">
              {!detail ? (
                <p className="sr-loading">Loading order details…</p>
              ) : (
                <>
                  <DrawerSection title="Identifiers" defaultOpen>
                    <DrawerField label="SR Order Id" value={detail.order?.sr_order_id} mono />
                    <DrawerField label="Order Id" value={detail.order?.order_id} mono />
                    <DrawerField label="Shopify format" value={detail.order?.order_id_shopify_format} mono />
                    <DrawerField label="AWB" value={detail.order?.awb} mono />
                    <DrawerField label="Return AWB" value={detail.order?.return_awb_code} mono />
                    <DrawerField label="Shipment ID" value={detail.order?.shipment_id} mono />
                  </DrawerSection>
                  <DrawerSection title="Shipment Status">
                    <DrawerField label="Shipment Status" value={detail.order?.shipment_status} />
                    <DrawerField label="Current Status" value={detail.order?.current_status} />
                    <DrawerField label="Status Bucket" value={detail.order?.status_bucket} />
                    <DrawerField label="Courier" value={detail.order?.courier_name} />
                    <DrawerField label="ETD" value={detail.order?.etd} />
                    <DrawerField label="Delivered Date" value={detail.order?.delivered_date} />
                  </DrawerSection>
                  <DrawerSection title="Scan Timeline">
                    {(detail.scans || []).length === 0 ? (
                      <p className="sr-subtitle">No scan history.</p>
                    ) : (
                      (detail.scans || []).map((scan, idx) => (
                        <p key={idx} className="sr-subtitle" style={{ marginBottom: "0.35rem" }}>
                          {dash((scan as { scan_date?: string }).scan_date)} · {dash((scan as { status?: string }).status)} ·{" "}
                          {dash((scan as { location?: string }).location)} · {dash((scan as { activity?: string }).activity)}
                        </p>
                      ))
                    )}
                  </DrawerSection>
                  <DrawerSection title="Customer / Shopify">
                    <DrawerField label="Customer Name (Shopify)" value={detail.order?.customer_name_shopify} />
                    <DrawerField label="Customer Phone (Shopify)" value={detail.order?.customer_phone_shopify} />
                    <DrawerField label="Billing Name (Shiprocket)" value={detail.order?.billing_name} />
                    <DrawerField label="Billing Email" value={detail.order?.billing_email} />
                    <DrawerField label="Billing Phone" value={detail.order?.billing_phone} />
                    <DrawerField label="Email" value={detail.order?.customer_email} />
                    <DrawerField label="Coach" value={detail.order?.coach} />
                  </DrawerSection>
                  <DrawerSection title="Payment / Order">
                    <DrawerField label="Payment Method" value={detail.order?.payment_method} />
                    <DrawerField label="Payment Status" value={detail.order?.payment_status} />
                    <DrawerField label="Order Total" value={detail.order?.order_total} />
                    <DrawerField label="Products" value={detail.order?.products} />
                  </DrawerSection>
                  <DrawerSection title="Remittance / Settlement">
                    {(detail.remittances || []).length === 0 ? (
                      <p className="sr-subtitle">No remittance match.</p>
                    ) : (
                      (detail.remittances || []).map((row, idx) => {
                        const rec = row as Record<string, unknown>;
                        const crf = rec.crf as Record<string, unknown> | null;
                        return (
                          <div key={idx} style={{ marginBottom: "0.75rem" }}>
                            <DrawerField label="CRF" value={rec.crf_id} mono />
                            <DrawerField label="UTR" value={rec.utr} mono />
                            <DrawerField label="Type" value={rec.remittance_type} />
                            <DrawerField label="Order Settlement" value={money(rec.order_value)} />
                            <DrawerField label="CRF Amount" value={money(crf?.remittance_amount)} />
                            <DrawerField label="Status" value={crf?.status} />
                          </div>
                        );
                      })
                    )}
                  </DrawerSection>
                  <DrawerSection title="Sync / Data Quality">
                    <DrawerField label="Last webhook" value={detail.order?.last_webhook_sync_at} />
                    <DrawerField label="Last API" value={detail.order?.last_local_api_sync_at} />
                    <DrawerField label="Shopify enriched" value={detail.order?.last_enriched_at} />
                  </DrawerSection>
                  <details className="sr-drawer-section">
                    <summary>View Raw Shiprocket JSON</summary>
                    <div className="sr-drawer-section-content">
                      {showRaw ? (
                        <pre className="sr-raw-json">{JSON.stringify(detail.rawPayload ?? {}, null, 2)}</pre>
                      ) : (
                        <button type="button" className="sr-btn sr-btn-secondary" onClick={() => setShowRaw(true)}>
                          Load JSON
                        </button>
                      )}
                    </div>
                  </details>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function DrawerSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="sr-drawer-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="sr-drawer-section-content">{children}</div>
    </details>
  );
}

function DrawerField({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  return (
    <div className="sr-field">
      <span className="sr-field-label">{label}</span>
      <span className={`sr-field-value${mono ? " sr-mono" : ""}`}>{dash(value)}</span>
    </div>
  );
}
