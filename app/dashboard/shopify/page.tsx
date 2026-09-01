"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8", "#82CA9D", "#FFC658", "#8DD1E1"];

interface OverviewData {
  range: { from: string; to: string };
  kpis: {
    total_orders: number;
    paid_orders: number;
    cancelled_orders: number;
    fulfilled_orders: number;
    units_sold: number;
    unique_customers: number;
    gross_order_value: number;
    paid_order_value: number;
    average_order_value: number;
    total_discounts: number;
  };
  daily: Array<{ date: string; orders: number; paid_orders: number; gross_order_value: number }>;
  financial: Array<{ financial_status: string; order_count: number; order_value: number }>;
  fulfillment: Array<{ fulfillment_status: string; order_count: number; order_value: number }>;
  products: Array<{ sku: string; product: string; variant: string | null; orders_containing_product: number; units: number; item_revenue: number }>;
  payments: Array<{ payment_gateway: string; payment_category: string; order_count: number; order_value: number }>;
  utm: Array<{
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_content?: string;
    utm_term?: string;
    orders: number;
    paid_orders: number;
    order_value: number;
  }>;
  discounts: Array<{ discount_code: string; orders: number; discount_amount: number; gross_value: number }>;
  geo: Array<{ province: string; city: string; order_count: number; paid_order_value: number }>;
  cancellations: Array<{ cancel_reason: string; count: number; value: number }>;
  recentOrders: Array<{
    shopify_order_id: string;
    order_name: string;
    created_at_shopify: string;
    customer_display_name: string | null;
    email?: string | null;
    phone?: string | null;
    shipping_phone?: string | null;
    shipping_zip?: string | null;
    billing_city?: string | null;
    financial_status: string;
    fulfillment_status: string;
    line_items?: string | null;
    currency?: string | null;
    order_value: number;
    total_discounts?: number | null;
    items: number;
    city: string;
    payment_method: string;
    cancelled_at: string | null;
    cancel_reason?: string | null;
    staff_note?: string | null;
    transactions_count?: number | null;
    customer_number_of_orders?: number | null;
    discount_codes?: string | null;
    last_order_discount_code?: string | null;
  }>;
  syncHealth: {
    last_successful_sync_at: string | null;
    last_attempted_sync_at: string | null;
    last_status: string | null;
    last_duration_seconds: number | null;
    last_orders_fetched: number | null;
    last_retry_count: number | null;
    last_error_code: string | null;
    last_error_message: string | null;
    history_warning: string | null;
  } | null;
}

function money(n: number | null | undefined): string {
  return `₹${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatIst(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function dash(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  return String(value);
}

export default function ShopifyDashboard() {
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "custom">("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<OverviewData | null>(null);
  const [orders, setOrders] = useState<OverviewData["recentOrders"]>([]);
  const [page, setPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [financialFilter, setFinancialFilter] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [cancelledFilter, setCancelledFilter] = useState("");
  const [cancelReasonFilter, setCancelReasonFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (range === "custom" && customFrom && customTo) {
      params.set("from", new Date(customFrom).toISOString());
      params.set("to", new Date(customTo).toISOString());
    }
    return params.toString();
  }, [range, customFrom, customTo]);

  async function load() {
    setLoading(true);
    try {
      const orderQuery = new URLSearchParams(query);
      orderQuery.set("page", String(page));
      orderQuery.set("pageSize", "15");
      if (financialFilter) orderQuery.set("financialStatus", financialFilter);
      if (fulfillmentFilter) orderQuery.set("fulfillmentStatus", fulfillmentFilter);
      if (paymentFilter) orderQuery.set("paymentCategory", paymentFilter);
      if (cancelledFilter) orderQuery.set("cancelled", cancelledFilter);
      if (cancelReasonFilter) orderQuery.set("cancelReason", cancelReasonFilter);
      if (search.trim()) orderQuery.set("search", search.trim());

      const [overviewRes, ordersRes] = await Promise.all([
        fetch(`/api/shopify/analytics/overview?${query}`, { credentials: "include" }),
        fetch(`/api/shopify/orders?${orderQuery.toString()}`, { credentials: "include" }),
      ]);
      if (!overviewRes.ok || !ordersRes.ok) {
        const failed = !overviewRes.ok ? overviewRes : ordersRes;
        const body = (await failed.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Failed to load Shopify analytics");
      }
      const overview = await overviewRes.json();
      const orderPage = await ordersRes.json();
      setData(overview);
      setOrders(orderPage.orders ?? []);
      setTotalOrders(orderPage.total ?? 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [query, page, financialFilter, fulfillmentFilter, paymentFilter, cancelledFilter, cancelReasonFilter, search]);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Loading Shopify dashboard...</h1>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Shopify dashboard error</h1>
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const kpis = [
    { label: "Total Orders", value: data.kpis.total_orders.toLocaleString(), color: "bg-blue-500" },
    { label: "Paid Orders", value: data.kpis.paid_orders.toLocaleString(), color: "bg-green-500" },
    { label: "Cancelled Orders", value: data.kpis.cancelled_orders.toLocaleString(), color: "bg-orange-500" },
    { label: "Fulfilled Orders", value: data.kpis.fulfilled_orders.toLocaleString(), color: "bg-purple-500" },
    { label: "Units Sold", value: data.kpis.units_sold.toLocaleString(), color: "bg-blue-500" },
    { label: "Gross Order Value", value: money(data.kpis.gross_order_value), color: "bg-green-500" },
    { label: "Paid Order Value", value: money(data.kpis.paid_order_value), color: "bg-purple-500" },
    { label: "Average Order Value", value: money(data.kpis.average_order_value), color: "bg-orange-500" },
    { label: "Unique Customers", value: data.kpis.unique_customers.toLocaleString(), color: "bg-blue-500" },
    { label: "Total Discounts", value: money(data.kpis.total_discounts), color: "bg-green-500" },
  ];

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-full mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Shopify Analytics</h1>
            <p className="text-gray-600 mt-2">
              <Link href="/dashboard">Shiprocket</Link>
              {" · "}
              <Link href="/dashboard/shiprocket">Explorer</Link>
              {" · "}
              <strong>Shopify</strong>
              {" · "}
              <Link href="/dashboard/gokwik">GoKwik</Link>
              {" · "}
              <Link href="/dashboard/meta">Meta</Link>
              {" · "}
              <Link href="/dashboard/ga4">GA4</Link>
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
            <button onClick={load} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              Refresh
            </button>
          </div>
        </div>

        {data.syncHealth?.history_warning && (
          <div className="bg-white rounded-lg p-4 mb-8 shadow-lg">
            <strong>History warning:</strong> {data.syncHealth.history_warning}
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
            <h3 className="text-lg font-semibold mb-4">Order / sales trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="orders" stroke="#0088FE" fill="#0088FE" />
                <Area type="monotone" dataKey="paid_orders" stroke="#00C49F" fill="#00C49F" />
                <Area type="monotone" dataKey="gross_order_value" stroke="#FFBB28" fill="#FFBB28" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Financial status</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={data.financial} dataKey="order_count" nameKey="financial_status" cx="50%" cy="50%" outerRadius={100} label>
                  {data.financial.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Fulfillment status</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.fulfillment}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="fulfillment_status" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="order_count" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Payment method</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.payments}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="payment_category" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="order_count" fill="#00C49F" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-lg mb-8">
          <h3 className="text-lg font-semibold mb-4">Product performance</h3>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr className="border-b">
                  <th>SKU</th><th>Product</th><th>Variant</th><th className="text-right">Orders</th><th className="text-right">Units</th><th className="text-right">Item revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.products.slice(0, 15).map((p) => (
                  <tr key={`${p.sku}-${p.product}-${p.variant}`} className="border-b hover:bg-gray-50">
                    <td>{p.sku}</td>
                    <td>{p.product}</td>
                    <td>{p.variant}</td>
                    <td className="text-right">{p.orders_containing_product}</td>
                    <td className="text-right">{p.units}</td>
                    <td className="text-right">{money(p.item_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">UTM performance</h3>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr className="border-b">
                    <th>Source</th><th>Medium</th><th>Campaign</th><th className="text-right">Orders</th><th className="text-right">Paid</th><th className="text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.utm.slice(0, 10).map((u, i) => (
                    <tr
                      key={`${u.utm_source}-${u.utm_medium}-${u.utm_campaign}-${u.utm_content ?? ""}-${u.utm_term ?? ""}-${i}`}
                      className="border-b"
                    >
                      <td>{u.utm_source}</td>
                      <td>{u.utm_medium}</td>
                      <td>{u.utm_campaign}</td>
                      <td className="text-right">{u.orders}</td>
                      <td className="text-right">{u.paid_orders}</td>
                      <td className="text-right">{money(u.order_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Discounts</h3>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr className="border-b">
                    <th>Code</th><th className="text-right">Orders</th><th className="text-right">Discount</th><th className="text-right">Order value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.discounts.slice(0, 10).map((d) => (
                    <tr key={d.discount_code} className="border-b">
                      <td>{d.discount_code}</td>
                      <td className="text-right">{d.orders}</td>
                      <td className="text-right">{money(d.discount_amount)}</td>
                      <td className="text-right">{money(d.gross_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Geography</h3>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr className="border-b">
                    <th>Province</th><th>City</th><th className="text-right">Orders</th><th className="text-right">Paid value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.geo.slice(0, 10).map((g) => (
                    <tr key={`${g.province}-${g.city}`} className="border-b">
                      <td>{g.province}</td>
                      <td>{g.city}</td>
                      <td className="text-right">{g.order_count}</td>
                      <td className="text-right">{money(g.paid_order_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Cancellations</h3>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr className="border-b">
                    <th>Reason</th><th className="text-right">Count</th><th className="text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cancellations.map((c) => (
                    <tr key={c.cancel_reason} className="border-b">
                      <td>{c.cancel_reason}</td>
                      <td className="text-right">{c.count}</td>
                      <td className="text-right">{money(c.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-lg mb-8">
          <h3 className="text-lg font-semibold mb-4">Sync health</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div><p className="text-sm text-gray-600">Last success</p><p>{data.syncHealth?.last_successful_sync_at ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Last attempt</p><p>{data.syncHealth?.last_attempted_sync_at ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Status</p><p>{data.syncHealth?.last_status ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Duration</p><p>{data.syncHealth?.last_duration_seconds ?? "—"}s</p></div>
            <div><p className="text-sm text-gray-600">Orders fetched</p><p>{data.syncHealth?.last_orders_fetched ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Retry count</p><p>{data.syncHealth?.last_retry_count ?? "—"}</p></div>
            <div><p className="text-sm text-gray-600">Last error</p><p>{data.syncHealth?.last_error_code ?? "—"}</p></div>
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-lg">
          <div className="flex justify-between items-start mb-4 gap-4 flex-wrap">
            <h3 className="text-lg font-semibold">Recent orders</h3>
            <div className="filter-bar">
              <input
                value={search}
                onChange={(e) => { setPage(1); setSearch(e.target.value); }}
                placeholder="Search order #, name, city"
                className="px-4 py-2 bg-gray-100 rounded"
              />
              <select value={financialFilter} onChange={(e) => { setPage(1); setFinancialFilter(e.target.value); }} className="px-4 py-2 bg-gray-100 rounded">
                <option value="">All financial</option>
                <option value="PAID">PAID</option>
                <option value="PENDING">PENDING</option>
                <option value="VOIDED">VOIDED</option>
              </select>
              <select value={fulfillmentFilter} onChange={(e) => { setPage(1); setFulfillmentFilter(e.target.value); }} className="px-4 py-2 bg-gray-100 rounded">
                <option value="">All fulfillment</option>
                <option value="FULFILLED">FULFILLED</option>
                <option value="UNFULFILLED">UNFULFILLED</option>
              </select>
              <select value={paymentFilter} onChange={(e) => { setPage(1); setPaymentFilter(e.target.value); }} className="px-4 py-2 bg-gray-100 rounded">
                <option value="">All payment</option>
                <option value="COD">COD</option>
                <option value="PREPAID">PREPAID</option>
                <option value="UNKNOWN">UNKNOWN</option>
              </select>
              <select value={cancelledFilter} onChange={(e) => { setPage(1); setCancelledFilter(e.target.value); if (e.target.value !== "yes") setCancelReasonFilter(""); }} className="px-4 py-2 bg-gray-100 rounded">
                <option value="">All orders</option>
                <option value="yes">Cancelled</option>
                <option value="no">Not cancelled</option>
              </select>
              <select value={cancelReasonFilter} onChange={(e) => { setPage(1); setCancelReasonFilter(e.target.value); if (e.target.value) setCancelledFilter("yes"); }} className="px-4 py-2 bg-gray-100 rounded">
                <option value="">All cancel reasons</option>
                <option value="CUSTOMER">CUSTOMER</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="orders-sheet-table">
              <thead>
                <tr className="border-b">
                  <th>Order Number</th>
                  <th>Customer Name</th>
                  <th>Created At</th>
                  <th className="text-right">Total Price</th>
                  <th>Phone (Shipping)</th>
                  <th>Email</th>
                  <th>Financial Status</th>
                  <th>Fulfillment Status</th>
                  <th>Line Items</th>
                  <th>Currency</th>
                  <th>Id</th>
                  <th>Zip (Shipping)</th>
                  <th>Phone</th>
                  <th>City (Billing)</th>
                  <th>Cancelled At</th>
                  <th>Cancel Reason</th>
                  <th>Staff Note</th>
                  <th className="text-right">Transactions</th>
                  <th className="text-right">Customer Orders</th>
                  <th>Discount Code</th>
                  <th className="text-right">Total Discounts</th>
                  <th>Last-order Discount</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.shopify_order_id} className="border-b hover:bg-gray-50">
                    <td>{dash(o.order_name)}</td>
                    <td className="customer-name">{dash(o.customer_display_name)}</td>
                    <td>{formatIst(o.created_at_shopify)}</td>
                    <td className="text-right">{money(o.order_value)}</td>
                    <td>{dash(o.shipping_phone)}</td>
                    <td>{dash(o.email)}</td>
                    <td>{dash(o.financial_status)}</td>
                    <td>{dash(o.fulfillment_status)}</td>
                    <td className="line-items">{dash(o.line_items)}</td>
                    <td>{dash(o.currency)}</td>
                    <td>{dash(o.shopify_order_id)}</td>
                    <td>{dash(o.shipping_zip)}</td>
                    <td>{dash(o.phone)}</td>
                    <td>{dash(o.billing_city)}</td>
                    <td>{o.cancelled_at ? formatIst(o.cancelled_at) : "—"}</td>
                    <td>{dash(o.cancel_reason)}</td>
                    <td>{dash(o.staff_note)}</td>
                    <td className="text-right">{dash(o.transactions_count)}</td>
                    <td className="text-right">{dash(o.customer_number_of_orders)}</td>
                    <td>{dash(o.discount_codes)}</td>
                    <td className="text-right">{money(o.total_discounts)}</td>
                    <td title="Shopify GraphQL does not expose the customer's last-order discount code">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center mt-4">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-4 py-2 bg-blue-500 text-white rounded">
              Previous
            </button>
            <span className="text-sm text-gray-600">Page {page} · {totalOrders} orders</span>
            <button onClick={() => setPage((p) => p + 1)} className="px-4 py-2 bg-blue-500 text-white rounded">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
