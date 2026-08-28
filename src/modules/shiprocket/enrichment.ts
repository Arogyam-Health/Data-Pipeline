import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { DEFAULT_COACH, SHOPIFY_ORDER_ID_REGEX } from "./constants";

export interface ShopifyEnrichmentMatch {
  shopifyOrderId: string | null;
  customerName: string;
  shippingPhone: string;
  mainPhone: string;
}

export interface ShiprocketShopifyEnrichment {
  orderIdShopifyFormat: string;
  customerName: string;
  customerPhone: string;
  coach: string;
  matchedShopifyOrder: boolean;
  shopifyOrderIdentifier: string | null;
}

/**
 * Sheet: REGEXEXTRACT(TO_TEXT(orderId), "\\d{8}")
 * First sequence of 8 consecutive digits, or blank.
 */
export function extractShopifyOrderId(orderId: unknown): string {
  if (orderId === null || orderId === undefined) return "";
  const text = String(orderId);
  if (text.trim() === "") return "";
  const match = text.match(SHOPIFY_ORDER_ID_REGEX);
  return match ? match[0] : "";
}

/**
 * Sheet: "91" & RIGHT(REGEXREPLACE(TO_TEXT(rawPhone), "\\D", ""), 10)
 * No plus prefix. Blank raw phone → blank.
 */
export function normalizeShopifyLegacyPhone(rawPhone: unknown): string {
  if (rawPhone === null || rawPhone === undefined) return "";
  const text = String(rawPhone);
  if (text.trim() === "") return "";
  const digits = text.replace(/\D/g, "");
  if (digits === "") return "";
  return `91${digits.slice(-10)}`;
}

/** Sheet: IF(orderId <> "", "Misba", "") */
export function deriveCoach(orderId: unknown): string {
  if (orderId === null || orderId === undefined) return "";
  return String(orderId).trim() === "" ? "" : DEFAULT_COACH;
}

export function resolveShiprocketShopifyEnrichment(
  orderId: unknown,
  shopify: ShopifyEnrichmentMatch | null
): ShiprocketShopifyEnrichment {
  const orderIdShopifyFormat = extractShopifyOrderId(orderId);
  const coach = deriveCoach(orderId);
  if (!shopify || !orderIdShopifyFormat) {
    return {
      orderIdShopifyFormat,
      customerName: "",
      customerPhone: "",
      coach,
      matchedShopifyOrder: false,
      shopifyOrderIdentifier: null,
    };
  }

  const rawPhone =
    shopify.shippingPhone && String(shopify.shippingPhone).trim() !== ""
      ? shopify.shippingPhone
      : shopify.mainPhone;

  return {
    orderIdShopifyFormat,
    customerName: shopify.customerName || "",
    customerPhone: normalizeShopifyLegacyPhone(rawPhone),
    coach,
    matchedShopifyOrder: true,
    shopifyOrderIdentifier: shopify.shopifyOrderId,
  };
}

export function normalizeShopifyOrderNumber(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/#/g, "");
}

export async function lookupShopifyOrderForEnrichment(
  orderIdShopifyFormat: string
): Promise<ShopifyEnrichmentMatch | null> {
  if (!orderIdShopifyFormat) return null;

  const supabase = getSupabaseClient();
  const { data: orders, error } = await supabase
    .from("shopify_orders")
    .select("shopify_order_id, order_name, order_number, phone, customer_id, created_at_shopify")
    .or(
      `order_number.eq.${orderIdShopifyFormat},order_name.eq.${orderIdShopifyFormat},order_name.eq.#${orderIdShopifyFormat}`
    )
    .order("created_at_shopify", { ascending: false })
    .limit(5);

  if (error || !orders || orders.length === 0) {
    if (error) {
      logger.warn("Shopify enrichment lookup failed", { error: error.message });
    }
    return null;
  }

  const matched = orders.find((row) => {
    const name = normalizeShopifyOrderNumber(row.order_name);
    const number = String(row.order_number || "");
    return name === orderIdShopifyFormat || number === orderIdShopifyFormat;
  });

  if (!matched) return null;

  const [{ data: customer }, { data: addresses }] = await Promise.all([
    matched.customer_id
      ? supabase
          .from("shopify_customers")
          .select("display_name")
          .eq("customer_id", matched.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("shopify_order_addresses")
      .select("address_type, name, phone")
      .eq("shopify_order_id", matched.shopify_order_id),
  ]);

  const shipping = (addresses || []).find((a) => a.address_type === "shipping");
  const billing = (addresses || []).find((a) => a.address_type === "billing");

  return {
    shopifyOrderId: matched.shopify_order_id,
    customerName:
      String(customer?.display_name || shipping?.name || billing?.name || ""),
    shippingPhone: String(shipping?.phone || ""),
    mainPhone: String(matched.phone || ""),
  };
}

export async function enrichShiprocketOrder(srOrderId: string): Promise<{
  ok: boolean;
  matched: boolean;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("enrich_shiprocket_order", {
    p_sr_order_id: srOrderId,
  });

  if (error) {
    logger.warn("Shiprocket enrichment RPC failed", {
      sr_order_id: srOrderId,
      error: error.message,
    });
    return { ok: false, matched: false, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, matched: Boolean(row?.matched) };
}

export async function backfillShiprocketEnrichment(options?: {
  batchSize?: number;
  afterSrOrderId?: string;
}): Promise<{
  scanned: number;
  matchedShopify: number;
  unmatchedShopify: number;
  namePopulated: number;
  phonePopulated: number;
  invalidNo8Digit: number;
  errors: number;
  nextCursor: string | null;
}> {
  const batchSize = Math.min(Math.max(options?.batchSize ?? 100, 1), 500);
  const supabase = getSupabaseClient();

  let query = supabase
    .from("shiprocket_orders")
    .select("sr_order_id, order_id")
    .order("sr_order_id", { ascending: true })
    .limit(batchSize);

  if (options?.afterSrOrderId) {
    query = query.gt("sr_order_id", options.afterSrOrderId);
  }

  const { data: rows, error } = await query;
  if (error) {
    throw new Error(`Enrichment backfill query failed: ${error.message}`);
  }

  const stats = {
    scanned: 0,
    matchedShopify: 0,
    unmatchedShopify: 0,
    namePopulated: 0,
    phonePopulated: 0,
    invalidNo8Digit: 0,
    errors: 0,
    nextCursor: null as string | null,
  };

  for (const row of rows || []) {
    stats.scanned += 1;
    stats.nextCursor = row.sr_order_id;
    const format = extractShopifyOrderId(row.order_id);
    if (!format) stats.invalidNo8Digit += 1;

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "enrich_shiprocket_order",
        { p_sr_order_id: row.sr_order_id }
      );
      if (rpcError) {
        stats.errors += 1;
        continue;
      }
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.matched) stats.matchedShopify += 1;
      else stats.unmatchedShopify += 1;
      if (result?.customer_name_shopify) stats.namePopulated += 1;
      if (result?.customer_phone_shopify) stats.phonePopulated += 1;
    } catch {
      stats.errors += 1;
    }
  }

  return stats;
}
