import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/config/env";
import { getSupabaseClient } from "@/lib/supabase/admin";

function getAnalyticsClient() {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "analytics" },
  });
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return email ?? null;
  const [user, domain] = email.split("@");
  if (!user) return `***@${domain}`;
  return `${user[0]}***@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(6, phone.length - 4))}${digits.slice(-4)}`;
}

export function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts
    .map((part) => (part.length === 0 ? part : `${part[0]}***`))
    .join(" ");
}

export function formatLineItemsSummary(
  items: Array<{ name?: string | null; sku?: string | null; quantity?: number | null }>
): string | null {
  if (items.length === 0) return null;
  return items
    .map((item) => `${item.name || item.sku || "item"} × ${item.quantity ?? 0}`)
    .join(", ");
}

export function resolveCustomerName(parts: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  shippingName?: string | null;
}): string | null {
  const display = parts.displayName?.trim();
  if (display) return display;
  const combined = [parts.firstName, parts.lastName].filter(Boolean).join(" ").trim();
  if (combined) return combined;
  const shipping = parts.shippingName?.trim();
  return shipping || null;
}

export interface DateRange {
  from: string;
  to: string;
}

async function rpc<T>(name: string, range: DateRange): Promise<T[]> {
  const analytics = getAnalyticsClient();
  const { data, error } = await analytics.rpc(name, {
    p_from: range.from,
    p_to: range.to,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

const emptyKpis = {
  total_orders: 0,
  paid_orders: 0,
  cancelled_orders: 0,
  fulfilled_orders: 0,
  units_sold: 0,
  unique_customers: 0,
  gross_order_value: 0,
  paid_order_value: 0,
  average_order_value: 0,
  total_discounts: 0,
};

export async function loadShopifyDaily(range: DateRange) {
  const analytics = getAnalyticsClient();
  const { data, error } = await analytics
    .from("shopify_daily_sales")
    .select("*")
    .gte("date", range.from.slice(0, 10))
    .lte("date", range.to.slice(0, 10))
    .order("date", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadShopifyProducts(range: DateRange) {
  return rpc<{
    sku: string;
    product: string;
    variant: string | null;
    orders_containing_product: number;
    units: number;
    item_revenue: number;
    average_item_price: number;
  }>("shopify_product_performance_for_range", range);
}

export async function loadShopifyUtm(range: DateRange) {
  return rpc<{
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_content: string;
    utm_term: string;
    orders: number;
    paid_orders: number;
    order_value: number;
    units: number;
  }>("shopify_utm_performance_for_range", range);
}

export async function loadShopifyOverview(range: DateRange) {
  const analytics = getAnalyticsClient();

  const [
    kpisRows,
    daily,
    financial,
    fulfillment,
    products,
    payments,
    discounts,
    utm,
    geo,
    cancellations,
    customersRes,
    recentRes,
    healthRes,
  ] = await Promise.all([
    rpc<typeof emptyKpis>("shopify_kpis_for_range", range),
    loadShopifyDaily(range),
    rpc("shopify_financial_status_for_range", range),
    rpc("shopify_fulfillment_status_for_range", range),
    loadShopifyProducts(range),
    rpc("shopify_payment_method_for_range", range),
    rpc("shopify_discount_performance_for_range", range),
    loadShopifyUtm(range),
    rpc("shopify_geo_summary_for_range", range),
    rpc("shopify_cancellation_summary_for_range", range),
    analytics.from("shopify_customer_summary").select("*").limit(1),
    analytics.from("shopify_recent_orders").select("*").limit(20),
    analytics.from("shopify_sync_health").select("*").limit(1),
  ]);

  return {
    kpis: kpisRows[0] ?? emptyKpis,
    daily,
    financial,
    fulfillment,
    products: products.slice(0, 50),
    payments,
    utm,
    discounts,
    geo,
    cancellations,
    customers: customersRes.data?.[0] ?? null,
    recentOrders: recentRes.data ?? [],
    syncHealth: healthRes.data?.[0] ?? null,
  };
}

export async function loadShopifyOrders(input: {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  financialStatus?: string;
  fulfillmentStatus?: string;
  paymentCategory?: string;
  cancelled?: "yes" | "no";
  cancelReason?: string;
  search?: string;
}) {
  const analytics = getAnalyticsClient();
  const from = Math.max(0, (input.page - 1) * input.pageSize);
  const to = from + input.pageSize - 1;

  let query = analytics
    .from("shopify_orders")
    .select(
      "shopify_order_id, order_name, created_at_shopify, customer_id, customer_display_name, financial_status, fulfillment_status, total_price, total_discounts, currency, cancelled_at, cancel_reason, staff_note, transactions_count, payment_category, shipping_city, items, test",
      { count: "exact" }
    )
    .gte("created_at_shopify", input.from)
    .lte("created_at_shopify", input.to)
    .order("created_at_shopify", { ascending: false })
    .range(from, to);

  if (input.financialStatus) {
    query = query.eq("financial_status", input.financialStatus);
  }
  if (input.fulfillmentStatus) {
    query = query.eq("fulfillment_status", input.fulfillmentStatus);
  }
  if (input.paymentCategory) {
    query = query.eq("payment_category", input.paymentCategory);
  }
  if (input.cancelled === "yes") {
    query = query.not("cancelled_at", "is", null);
  }
  if (input.cancelled === "no") {
    query = query.is("cancelled_at", null);
  }
  if (input.cancelReason) {
    query = query.eq("cancel_reason", input.cancelReason);
  }
  if (input.search) {
    const q = input.search.replace(/[%(),]/g, "").trim();
    if (q) {
      query = query.or(
        `order_name.ilike.%${q}%,customer_display_name.ilike.%${q}%,shipping_city.ilike.%${q}%`
      );
    }
  }

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const extras = await loadSheetColumnsForOrders(
    rows.map((row) => ({
      shopify_order_id: String(row.shopify_order_id),
      customer_id: (row.customer_id as string | null) ?? null,
    }))
  );

  return {
    page: input.page,
    pageSize: input.pageSize,
    total: count ?? 0,
    orders: rows.map((row) => {
      const extra = extras.get(String(row.shopify_order_id));
      return {
        ...row,
        email: extra?.email ?? null,
        phone: extra?.phone ?? null,
        shipping_phone: extra?.shipping_phone ?? null,
        shipping_zip: extra?.shipping_zip ?? null,
        billing_city: extra?.billing_city ?? null,
        line_items: extra?.line_items ?? null,
        discount_codes: extra?.discount_codes ?? null,
        last_order_discount_code: null,
        customer_number_of_orders: extra?.customer_number_of_orders ?? null,
        customer_display_name: resolveCustomerName({
          displayName: row.customer_display_name as string | null,
          firstName: extra?.first_name,
          lastName: extra?.last_name,
          shippingName: extra?.shipping_name,
        }),
        order_value: row.total_price,
        city: row.shipping_city,
        payment_method: row.payment_category,
      };
    }),
  };
}

async function loadSheetColumnsForOrders(
  orders: Array<{ shopify_order_id: string; customer_id: string | null }>
): Promise<
  Map<
    string,
    {
      email: string | null;
      phone: string | null;
      shipping_phone: string | null;
      shipping_zip: string | null;
      billing_city: string | null;
      line_items: string | null;
      discount_codes: string | null;
      customer_number_of_orders: number | null;
      shipping_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }
  >
> {
  const result = new Map<
    string,
    {
      email: string | null;
      phone: string | null;
      shipping_phone: string | null;
      shipping_zip: string | null;
      billing_city: string | null;
      line_items: string | null;
      discount_codes: string | null;
      customer_number_of_orders: number | null;
      shipping_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }
  >();
  if (orders.length === 0) return result;

  const ids = orders.map((order) => order.shopify_order_id);
  const customerIds = [...new Set(orders.map((order) => order.customer_id).filter(Boolean))] as string[];
  const pipeline = getSupabaseClient();

  const [orderRes, addressRes, itemRes, discountRes, customerRes] = await Promise.all([
    pipeline.from("shopify_orders").select("shopify_order_id, email, phone").in("shopify_order_id", ids),
    pipeline
      .from("shopify_order_addresses")
      .select("shopify_order_id, address_type, phone, zip, city, name, first_name, last_name")
      .in("shopify_order_id", ids),
    pipeline
      .from("shopify_order_items")
      .select("shopify_order_id, sku, name, quantity, line_index")
      .in("shopify_order_id", ids)
      .order("line_index", { ascending: true }),
    pipeline
      .from("shopify_discount_codes")
      .select("shopify_order_id, code, position")
      .in("shopify_order_id", ids)
      .order("position", { ascending: true }),
    customerIds.length > 0
      ? pipeline
          .from("shopify_customers")
          .select("customer_id, number_of_orders, first_name, last_name, display_name")
          .in("customer_id", customerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (orderRes.error) throw new Error(orderRes.error.message);
  if (addressRes.error) throw new Error(addressRes.error.message);
  if (itemRes.error) throw new Error(itemRes.error.message);
  if (discountRes.error) throw new Error(discountRes.error.message);
  if (customerRes.error) throw new Error(customerRes.error.message);

  const customerById = new Map(
    (customerRes.data ?? []).map((row) => [
      String(row.customer_id),
      {
        number_of_orders: row.number_of_orders as number | null,
        first_name: (row.first_name as string | null) ?? null,
        last_name: (row.last_name as string | null) ?? null,
        display_name: (row.display_name as string | null) ?? null,
      },
    ])
  );
  const itemsByOrder = new Map<string, Array<{ name?: string | null; sku?: string | null; quantity?: number | null }>>();
  for (const item of itemRes.data ?? []) {
    const key = String(item.shopify_order_id);
    const list = itemsByOrder.get(key) ?? [];
    list.push(item);
    itemsByOrder.set(key, list);
  }
  const discountsByOrder = new Map<string, string[]>();
  for (const discount of discountRes.data ?? []) {
    if (!discount.code) continue;
    const key = String(discount.shopify_order_id);
    const list = discountsByOrder.get(key) ?? [];
    list.push(String(discount.code));
    discountsByOrder.set(key, list);
  }

  for (const order of orders) {
    const core = (orderRes.data ?? []).find((row) => String(row.shopify_order_id) === order.shopify_order_id);
    const shipping = (addressRes.data ?? []).find(
      (row) => String(row.shopify_order_id) === order.shopify_order_id && row.address_type === "shipping"
    );
    const billing = (addressRes.data ?? []).find(
      (row) => String(row.shopify_order_id) === order.shopify_order_id && row.address_type === "billing"
    );
    const customer = order.customer_id ? customerById.get(order.customer_id) : undefined;
    result.set(order.shopify_order_id, {
      email: (core?.email as string | null) ?? null,
      phone: (core?.phone as string | null) ?? null,
      shipping_phone: (shipping?.phone as string | null) ?? null,
      shipping_zip: (shipping?.zip as string | null) ?? null,
      billing_city: (billing?.city as string | null) ?? null,
      line_items: formatLineItemsSummary(itemsByOrder.get(order.shopify_order_id) ?? []),
      discount_codes: (discountsByOrder.get(order.shopify_order_id) ?? []).join(", ") || null,
      customer_number_of_orders: customer?.number_of_orders ?? null,
      shipping_name: resolveCustomerName({
        shippingName: (shipping?.name as string | null) ?? null,
        firstName: (shipping?.first_name as string | null) ?? null,
        lastName: (shipping?.last_name as string | null) ?? null,
      }),
      first_name: customer?.first_name ?? null,
      last_name: customer?.last_name ?? null,
    });
  }

  return result;
}

export async function loadShopifyGokwikOrders(range: DateRange) {
  return rpc<{
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
  }>("shopify_gokwik_orders_for_range", range);
}

export async function loadShopifyGokwikOverview(range: DateRange) {
  const analytics = getAnalyticsClient();
  const [kpisRows, orders, channel] = await Promise.all([
    rpc<{
      total_orders: number;
      gokwik_tagged_orders: number;
      with_meta_fbc: number;
      with_meta_fbp: number;
      with_customer_ip: number;
      channel_gokwik_orders: number;
      gokwik_order_value: number;
      unique_ips: number;
    }>("shopify_gokwik_kpis_for_range", range),
    loadShopifyGokwikOrders(range),
    rpc<{ channel: string; orders: number; order_value: number }>(
      "shopify_gokwik_channel_summary_for_range",
      range
    ),
  ]);
  const recentGokwik = [...orders]
    .sort((a, b) => new Date(b.created_at_shopify).getTime() - new Date(a.created_at_shopify).getTime())
    .slice(0, 20);
  return {
    kpis: kpisRows[0] ?? {
      total_orders: 0,
      gokwik_tagged_orders: 0,
      with_meta_fbc: 0,
      with_meta_fbp: 0,
      with_customer_ip: 0,
      channel_gokwik_orders: 0,
      gokwik_order_value: 0,
      unique_ips: 0,
    },
    orders,
    recentGokwik,
    channel,
  };
}

export async function loadShopifyOrderDetail(orderId: string) {
  const analytics = getAnalyticsClient();
  const [{ data: order }, { data: lines }, { data: gokwik }] = await Promise.all([
    analytics
      .from("shopify_orders")
      .select("*")
      .eq("shopify_order_id", orderId)
      .maybeSingle(),
    analytics.from("shopify_order_lines").select("*").eq("shopify_order_id", orderId),
    analytics.from("shopify_gokwik_orders").select("*").eq("shopify_order_id", orderId).maybeSingle(),
  ]);

  if (!order) return null;

  return {
    order,
    lines: lines ?? [],
    gokwik: gokwik ?? null,
  };
}
