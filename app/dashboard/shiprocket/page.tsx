"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDateInTimeZone } from "@/modules/meta/dates";
import "./shiprocket-dashboard.css";

type DatePreset = "today" | "yesterday" | "last_7d" | "last_14d" | "last_28d" | "last_30d" | "this_week" | "last_week" | "this_month" | "last_month" | "maximum" | "custom";
function formatDisplayDate(iso: string): string {
  const [year, month, day] = formatDateInTimeZone(new Date(`${iso}T00:00:00Z`), "Asia/Kolkata").split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function getPresetRange(preset: DatePreset, todayIso: string): { from: string; to: string; label: string } {
  const addDays = (iso: string, n: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const today = todayIso;
  const yesterday = addDays(today, -1);
  const startOfWeek = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(iso, diff);
  };
  const startOfMonth = (iso: string) => iso.slice(0, 7) + "-01";
  const endOfMonth = (iso: string) => {
    const [y, m] = iso.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  };
  const lastMonthIso = addDays(startOfMonth(today), -1);
  switch (preset) {
    case "today": return { from: today, to: today, label: `Today: ${formatDisplayDate(today)}` };
    case "yesterday": return { from: yesterday, to: yesterday, label: `Yesterday: ${formatDisplayDate(yesterday)}` };
    case "last_7d": return { from: addDays(today, -6), to: today, label: `Last 7 days` };
    case "last_14d": return { from: addDays(today, -13), to: today, label: `Last 14 days` };
    case "last_28d": return { from: addDays(today, -27), to: today, label: `Last 28 days` };
    case "last_30d": return { from: addDays(today, -29), to: today, label: `Last 30 days` };
    case "this_week": return { from: startOfWeek(today), to: today, label: `This week` };
    case "last_week": { const s = startOfWeek(today); return { from: addDays(s, -7), to: addDays(s, -1), label: `Last week` }; }
    case "this_month": return { from: startOfMonth(today), to: today, label: `This month` };
    case "last_month": { const s = startOfMonth(lastMonthIso); return { from: s, to: endOfMonth(lastMonthIso), label: `Last month` }; }
    case "maximum": return { from: addDays(today, -89), to: today, label: `Maximum (90 days)` };
    default: return { from: today, to: today, label: "Custom" };
  }
}
function addCalendarDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
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
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (<div key={d} style={{ textAlign: "center", padding: "2px 0" }}>{d}</div>))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "1px" }}>
        {cells.map((iso, i) => iso ? (
          <button key={iso} onClick={() => onPick(iso)} style={{ height: "28px", borderRadius: "6px", fontSize: "12px", fontWeight: iso >= from && iso <= to ? 600 : 400, background: iso >= from && iso <= to ? "#2563eb" : "transparent", color: iso >= from && iso <= to ? "white" : "#1f2937", border: iso === from || iso === to ? "1px solid #1e40af" : "1px solid transparent" }}>{Number(iso.slice(8, 10))}</button>
        ) : (<div key={`e-${i}`} style={{ height: "28px" }} />))}
      </div>
    </div>
  );
}

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
  codOrders: number | null;
  prepaidOrders: number | null;
  totalOrderValue: number | null;
  settledOrders: number;
  unmatchedRemittanceOrders: number;
  remittanceAmountOnLatestCrf: number;
  orderSettlementValue: number;
  settlementAmountAvailable: boolean;
  distinctCrfs: number;
  distinctUtrs: number;
  remittanceDataAvailable: boolean;
  remittanceStatus: string;
  remittanceRowsTotal: number;
  remittanceMatched: number;
  remittanceUnmatched: number;
  remittanceMatchRate: number | null;
  deliveredCodOrders: number;
  deliveredRemittedOrders: number;
  deliveredNotRemittedOrders: number;
  remittedNotDeliveredOrders: number;
  deliveredOrdersWithRemittance?: number;
  deliveredOrdersWithoutRemittance?: number;
  paymentUnknownOrders?: number;
  commercialDataAvailable: boolean;
  commercialSource: string;
  shopifyMatchPct: number;
  phoneCoveragePct: number;
  pabblySent?: number;
  pabblyFailed?: number;
  pabblyPending?: number;
  pabblyRetrying?: number;
  pabblyTotalDeliveries?: number;
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
  "coach",
  "etd",
  "undelivered_reason",
  "return_awb_code",
  "payment_method",
  "order_total",
  "pabbly_status",
  "pabbly_attempt_count",
  "pabbly_sent_at",
  "latest_crf_id",
  "latest_utr",
  "reconciliation_status",
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
  "pabbly_sent_at",
]);

const COLUMN_STORAGE_KEY = "shiprocket-visible-columns-v3";

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
  { label: "Pabbly Sent", filters: [{ field: "pabbly_status", operator: "eq", value: "sent" }] },
  { label: "Pabbly Failed", filters: [{ field: "pabbly_status", operator: "eq", value: "failed" }] },
  { label: "Pabbly Pending", filters: [{ field: "pabbly_status", operator: "in", value: ["pending", "retrying", "processing"] }] },
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

function pabblyBadgeClass(value: unknown): string {
  const text = String(value ?? "").toLowerCase();
  if (text === "sent") return "sr-pabbly-badge sr-pabbly-sent";
  if (text === "failed") return "sr-pabbly-badge sr-pabbly-failed";
  if (text === "pending") return "sr-pabbly-badge sr-pabbly-pending";
  if (text === "retrying") return "sr-pabbly-badge sr-pabbly-retrying";
  if (text === "processing") return "sr-pabbly-badge sr-pabbly-processing";
  return "sr-pabbly-badge sr-pabbly-none";
}

function renderCell(col: string, value: unknown): ReactNode {
  if (value == null || value === "") {
    return <span className="sr-muted">—</span>;
  }
  if (col === "pabbly_status") {
    return <span className={pabblyBadgeClass(value)}>{String(value)}</span>;
  }
  if (col.includes("status") || col === "status_bucket") {
    return <span className={statusBadgeClass(value)}>{String(value)}</span>;
  }
  if (col === "order_total" || col.includes("settlement") || col.includes("amount")) {
    return money(value);
  }
  if (col === "pabbly_sent_at" && value) {
    return <span className="sr-mono">{new Date(String(value)).toLocaleString("en-IN")}</span>;
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
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const todayIso = formatDateInTimeZone(new Date(), "Asia/Kolkata");
  const [preset, setPreset] = useState<DatePreset>("maximum");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => getPresetRange("maximum", formatDateInTimeZone(new Date(), "Asia/Kolkata")).from);
  const [customTo, setCustomTo] = useState(() => getPresetRange("maximum", formatDateInTimeZone(new Date(), "Asia/Kolkata")).to);

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

  useEffect(() => {
    if (preset !== "custom") {
      const r = getPresetRange(preset, todayIso);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
  }, [preset, todayIso]);

  const payload = useMemo(() => {
    const dateFilter = preset === "maximum" ? [] : [
      { field: "awb_assigned_date", operator: "gte", value: customFrom },
      { field: "awb_assigned_date", operator: "lt", value: addCalendarDay(customTo) },
    ];
    return {
      filters: [...appliedFilters, ...dateFilter],
      search: debouncedSearch,
      page,
      pageSize,
      sort: [{ field: sortField, direction: sortDir }],
    };
  }, [appliedFilters, debouncedSearch, page, pageSize, sortField, sortDir, preset, customFrom, customTo]);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const [ordersRes, overviewRes, qualityRes, remRes] = await Promise.all([
        fetch("/api/shiprocket/orders", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(payload),
        }),
        fetch("/api/shiprocket/overview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(payload),
        }),
        fetch("/api/shiprocket/quality", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal }),
        fetch("/api/shiprocket/remittances", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal }),
      ]);
      const ordersBody = await ordersRes.json();
      const overviewBody = await overviewRes.json();
      const qualityBody = await qualityRes.json();
      const remBody = await remRes.json();
      if (!ordersRes.ok) throw new Error(ordersBody.error || "Query failed");
      if (!overviewRes.ok) throw new Error(overviewBody.error || "Overview failed");
      if (currentRequest === requestId.current) {
        setRows(ordersBody.rows || []);
        setTotal(ordersBody.total || 0);
        setOverview(overviewBody.overview || null);
        setQuality(qualityBody.quality || null);
        setRemittances(remBody);
        setError(null);
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError" && currentRequest === requestId.current) {
        setError(err instanceof Error ? err.message : "Query failed");
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
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
        filters: [
          ...appliedFilters,
          ...(preset === "maximum"
            ? []
            : [
                { field: "awb_assigned_date", operator: "gte", value: customFrom },
                { field: "awb_assigned_date", operator: "lt", value: addCalendarDay(customTo) },
              ]),
        ],
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
            { label: "COD", value: overview.commercialDataAvailable ? overview.codOrders : "NOT AVAILABLE" },
            { label: "Prepaid", value: overview.commercialDataAvailable ? overview.prepaidOrders : "NOT AVAILABLE" },
            { label: "Order Value", value: overview.commercialDataAvailable ? money(overview.totalOrderValue) : "NOT AVAILABLE" },
          ],
        },
        {
          title: "Data Quality",
          cards: [
            { label: "Shopify Match", value: `${overview.shopifyMatchPct}%` },
            { label: "Phone Coverage", value: `${overview.phoneCoveragePct}%` },
            { label: "Remittance", value: overview.remittanceStatus.replaceAll("_", " ") },
          ],
        },
        {
          title: "Pabbly",
          cards: [
            { label: "Pabbly Sent", value: overview.pabblySent ?? 0 },
            { label: "Pabbly Failed", value: overview.pabblyFailed ?? 0 },
            { label: "Pabbly Pending", value: overview.pabblyPending ?? 0 },
            { label: "Pabbly Retrying", value: overview.pabblyRetrying ?? 0 },
            { label: "Pabbly Success Rate", value: overview.pabblyTotalDeliveries ? `${Math.round(((overview.pabblySent ?? 0) / overview.pabblyTotalDeliveries) * 100)}%` : "—" },
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
              <span className="sr-badge-pill">Pabbly test</span>
              <span className="sr-status-note">Pabbly dispatch enabled. Apps Script Sheet + Pabbly URL temporarily disabled.</span>
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
              <button type="button" onClick={() => setCalendarOpen((v) => !v)} className="sr-btn sr-btn-secondary">
                📅 {preset === "custom" ? `${formatDisplayDate(customFrom)} - ${formatDisplayDate(customTo)}` : getPresetRange(preset, todayIso).label} ▼
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

        {calendarOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "12px" }} onClick={() => setCalendarOpen(false)}>
            <div style={{ background: "white", borderRadius: "12px", padding: "16px", width: "820px", maxWidth: "95vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", gap: "16px" }}>
                <div style={{ width: "180px", fontSize: "14px", borderRight: "1px solid #e5e7eb", paddingRight: "12px" }}>
                  {[
                    ["today", "Today"],
                    ["yesterday", "Yesterday"],
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
                  <div style={{ display: "flex", flexDirection: "column", gap: "24px", alignItems: "center" }}>
                    <CalendarGrid monthIso={customFrom.slice(0, 7)} from={customFrom} to={customTo} onPick={(iso) => { if (preset !== "custom") setPreset("custom"); if (iso < customFrom || Math.abs(new Date(iso).getTime() - new Date(customFrom).getTime()) < Math.abs(new Date(iso).getTime() - new Date(customTo).getTime())) setCustomFrom(iso); else setCustomTo(iso); if (iso > customTo) setCustomTo(iso); }} />
                    <CalendarGrid monthIso={(() => { const [y, m] = customFrom.slice(0, 7).split("-").map(Number); const d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 7); })()} from={customFrom} to={customTo} onPick={(iso) => { if (preset !== "custom") setPreset("custom"); setCustomTo(iso); }} />
                  </div>
                  <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "8px", borderTop: "1px solid #e5e7eb", paddingTop: "12px" }}>
                    <input type="date" value={customFrom} onChange={(e) => { setPreset("custom"); setCustomFrom(e.target.value); }} style={{ fontSize: "13px", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "6px" }} />
                    <span>-</span>
                    <input type="date" value={customTo} onChange={(e) => { setPreset("custom"); setCustomTo(e.target.value); }} style={{ fontSize: "13px", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "6px" }} />
                  </div>
                  <p style={{ fontSize: "11px", color: "#6b7280", marginTop: "8px" }}>Dates filter awb_assigned_date (shipment date) behind Basic Auth</p>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                    <button onClick={() => setCalendarOpen(false)} style={{ padding: "8px 16px", fontSize: "14px", border: "1px solid #e5e7eb", borderRadius: "6px", background: "white" }}>Cancel</button>
                    <button onClick={() => { setCalendarOpen(false); setPage(1); }} style={{ padding: "8px 16px", fontSize: "14px", background: "#2563eb", color: "white", borderRadius: "6px" }}>Update</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && <div className="sr-alert sr-alert-error">{error}</div>}
        {loading && !overview && <p className="sr-loading">Loading dashboard…</p>}
        {loading && overview && <div className="sr-loading-overlay" role="status">Loading filtered data…</div>}

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
                  <p className="sr-mini-metric-label">Remittance reconciliation</p>
                  <p className="sr-mini-metric-value">{String(remittanceQuality?.status || "NO_REMITTANCE_DATA").replaceAll("_", " ")}</p>
                </div>
                {Boolean(remittanceQuality?.data_available) && <>
                  <div><p className="sr-mini-metric-label">Remittance matched</p><p className="sr-mini-metric-value">{dash(remittanceQuality?.matched)}</p></div>
                  <div><p className="sr-mini-metric-label">Remittance unmatched</p><p className="sr-mini-metric-value">{dash(remittanceQuality?.unmatched)}</p></div>
                  <div><p className="sr-mini-metric-label">Remittance match rate</p><p className="sr-mini-metric-value">{remittanceQuality?.match_rate == null ? "NOT AVAILABLE" : `${remittanceQuality.match_rate}%`}</p></div>
                </>}
              </div>
              <p className="sr-subtitle" style={{ marginBottom: "0.75rem" }}>
                {remittanceQuality?.data_available ? "Actual remittance rows for the selected scope." : "No remittance file covers the selected period. Upload a Shiprocket Billing / CRF-UTR XLS/XLSX report to enable reconciliation."}
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
        {overview?.remittanceDataAvailable && (
          <section className="sr-section">
            <div className="sr-card">
              <h3 className="sr-card-title">Universal delivery reconciliation</h3>
              <p className="sr-subtitle">Remittance matching is independent of payment classification.</p>
              <div className="sr-mini-metrics">
                <div><p className="sr-mini-metric-label">Delivered orders</p><p className="sr-mini-metric-value">{overview.delivered}</p></div>
                <div><p className="sr-mini-metric-label">Delivered + remitted</p><p className="sr-mini-metric-value">{overview.deliveredOrdersWithRemittance ?? overview.deliveredRemittedOrders}</p></div>
                <div><p className="sr-mini-metric-label">Delivered + not remitted</p><p className="sr-mini-metric-value">{overview.deliveredOrdersWithoutRemittance ?? overview.deliveredNotRemittedOrders}</p></div>
                <div><p className="sr-mini-metric-label">Remitted but not delivered</p><p className="sr-mini-metric-value">{overview.remittedNotDeliveredOrders}</p></div>
              </div>
            </div>
          </section>
        )}

        <section className="sr-section">
          <h2 className="sr-section-title">Settlements</h2>
          {!overview?.remittanceDataAvailable ? <div className="sr-card sr-empty-state"><h3 className="sr-card-title">No remittance data available for this period</h3><p className="sr-subtitle">Shipment and delivery data are available. Upload a Shiprocket Billing / CRF-UTR XLS/XLSX report covering the selected period to enable COD settlement reconciliation.</p><div className="sr-import-row"><button type="button" className="sr-btn sr-btn-secondary" disabled={importing} onClick={() => fileInputRef.current?.click()}>Choose File</button><button type="button" className="sr-btn sr-btn-primary" disabled={importing} onClick={() => fileInputRef.current?.click()}>{importing ? "Importing…" : "Import"}</button></div></div> : <div className="sr-card"><h3 className="sr-card-title">Settlement summary</h3><div className="sr-mini-metrics"><div><p className="sr-mini-metric-label">Remittance rows</p><p className="sr-mini-metric-value">{overview.remittanceRowsTotal}</p></div><div><p className="sr-mini-metric-label">Matched rows</p><p className="sr-mini-metric-value">{overview.remittanceMatched}</p></div><div><p className="sr-mini-metric-label">Unmatched rows</p><p className="sr-mini-metric-value">{overview.remittanceUnmatched}</p></div><div><p className="sr-mini-metric-label">CRFs / UTRs</p><p className="sr-mini-metric-value">{overview.distinctCrfs} / {overview.distinctUtrs}</p></div><div><p className="sr-mini-metric-label">Settlement value</p><p className="sr-mini-metric-value">{overview.settlementAmountAvailable ? money(overview.orderSettlementValue) : "NOT AVAILABLE"}</p></div></div><h3 className="sr-card-title" style={{ marginTop: "1rem" }}>Delivery reconciliation</h3><div className="sr-mini-metrics"><div><p className="sr-mini-metric-label">Delivered COD</p><p className="sr-mini-metric-value">{overview.deliveredCodOrders}</p></div><div><p className="sr-mini-metric-label">Delivered + remitted</p><p className="sr-mini-metric-value">{overview.deliveredRemittedOrders}</p></div><div><p className="sr-mini-metric-label">Delivered + not remitted</p><p className="sr-mini-metric-value">{overview.deliveredNotRemittedOrders}</p></div><div><p className="sr-mini-metric-label">Remitted but not delivered</p><p className="sr-mini-metric-value">{overview.remittedNotDeliveredOrders}</p></div></div></div>}
          {overview?.remittanceDataAvailable &&
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
                    <th>Reconciliation</th>
                    <th className="sr-num">Amount</th>
                    <th className="sr-num">AWBs</th>
                    <th className="sr-num">Matched</th>
                    <th className="sr-num">Delivered</th>
                    <th className="sr-num">Not delivered</th>
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
                      <td>{Number(row.matched || 0) === Number(row.awb_count || 0) && Number(row.awb_count || 0) > 0 ? "FULLY RECONCILED" : Number(row.matched || 0) === 0 ? "UNMATCHED" : "PARTIALLY RECONCILED"}</td>
                      <td className="sr-num">{row.settlement_amount == null || row.settlement_amount === "" ? "NOT AVAILABLE" : money(row.settlement_amount)}</td>
                      <td className="sr-num">{dash(row.awb_count)}</td>
                      <td className="sr-num">{dash(row.matched)}</td>
                      <td className="sr-num">{dash(row.delivered)}</td>
                      <td className="sr-num">{dash(row.not_delivered)}</td>
                    </tr>
                  ))}
                  {(remittances?.crfs || []).length === 0 && (
                    <tr>
                      <td colSpan={10} className="sr-muted" style={{ textAlign: "center" }}>
                        No remittance data available for this period. Upload a Shiprocket Billing / CRF-UTR report to enable settlement reconciliation.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>}
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
                  <DrawerSection title="Pabbly Delivery">
                    <DrawerField label="Pabbly Status" value={detail.order?.pabbly_status} />
                    <DrawerField label="Attempt Count" value={detail.order?.pabbly_attempt_count} />
                    <DrawerField label="First Attempt" value={detail.order?.pabbly_first_attempt_at} />
                    <DrawerField label="Last Attempt" value={detail.order?.pabbly_last_attempt_at} />
                    <DrawerField label="Sent At" value={detail.order?.pabbly_sent_at} />
                    <DrawerField label="Delivery Count" value={detail.order?.pabbly_delivery_count} />
                    <DrawerField label="Sent Count" value={detail.order?.pabbly_sent_count} />
                    <DrawerField label="Failed Count" value={detail.order?.pabbly_failed_count} />
                    <DrawerField label="Last Error" value={detail.order?.pabbly_last_error} />
                    <DrawerField label="Next Attempt" value={detail.order?.pabbly_next_attempt_at} />
                    <DrawerField label="Final Failure" value={detail.order?.pabbly_final_failure_at} />
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
