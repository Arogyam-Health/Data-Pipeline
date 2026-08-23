import { COD_GATEWAY_PATTERN, PREPAID_GATEWAY_PATTERN } from "./constants";
import { connectionNodes } from "./graphql";
import type {
  MoneyBag,
  NormalizedAddress,
  NormalizedCustomer,
  NormalizedDiscountApplication,
  NormalizedDiscountCode,
  NormalizedFulfillment,
  NormalizedLineItem,
  NormalizedNoteAttribute,
  NormalizedOrder,
  NormalizedRefund,
  NormalizedShippingLine,
  NormalizedTransaction,
  ShopifyCustomerNode,
  ShopifyDiscountApplicationNode,
  ShopifyFulfillmentNode,
  ShopifyLineItemNode,
  ShopifyMailingAddress,
  ShopifyOrderNode,
  ShopifyRefundNode,
  ShopifyShippingLineNode,
  ShopifyTransactionNode,
} from "./types";

export function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export function moneyBagAmount(bag?: MoneyBag | null): number | null {
  return parseMoney(bag?.shopMoney?.amount);
}

export function moneyBagCurrency(bag?: MoneyBag | null): string | null {
  return emptyToNull(bag?.shopMoney?.currencyCode ?? null);
}

export function parseTimestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function parseInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function gidToId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const trimmed = String(gid).trim();
  if (!trimmed) return null;
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || trimmed;
}

export function toGid(resource: string, id: string): string {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/${resource}/${id}`;
}

export function lineItemBusinessKey(
  orderId: string,
  lineItemId: string | null,
  sku: string | null,
  lineIndex: number
): string {
  if (lineItemId) {
    return `${orderId}__LINE_ITEM_ID__${lineItemId}`;
  }
  if (sku) {
    return `${orderId}__SKU__${sku}__INDEX__${lineIndex}`;
  }
  return `${orderId}__INDEX__${lineIndex}`;
}

export function classifyPaymentCategory(
  gateways: string[] | null | undefined
): "COD" | "PREPAID" | "OTHER" | "UNKNOWN" {
  if (!gateways || gateways.length === 0) return "UNKNOWN";
  if (gateways.some((g) => COD_GATEWAY_PATTERN.test(g))) return "COD";
  if (gateways.some((g) => PREPAID_GATEWAY_PATTERN.test(g))) return "PREPAID";
  return "OTHER";
}

export function extractUtms(
  attributes: NormalizedNoteAttribute[]
): Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term", string | null> {
  const find = (name: string) =>
    attributes.find((a) => (a.attribute_name ?? "").toLowerCase() === name)?.attribute_value ??
    null;
  return {
    utm_source: find("utm_source"),
    utm_medium: find("utm_medium"),
    utm_campaign: find("utm_campaign"),
    utm_content: find("utm_content"),
    utm_term: find("utm_term"),
  };
}

export function normalizeAddress(
  address: ShopifyMailingAddress | null | undefined,
  type?: "shipping" | "billing"
): NormalizedAddress | null {
  if (!address) return null;
  return {
    address_type: type,
    customer_address_id: gidToId(address.id),
    first_name: emptyToNull(address.firstName),
    last_name: emptyToNull(address.lastName),
    name: emptyToNull(address.name),
    company: emptyToNull(address.company),
    address1: emptyToNull(address.address1),
    address2: emptyToNull(address.address2),
    city: emptyToNull(address.city),
    province: emptyToNull(address.province),
    province_code: emptyToNull(address.provinceCode),
    country: emptyToNull(address.country),
    country_code: emptyToNull(address.countryCodeV2 ?? address.countryCode),
    zip: emptyToNull(address.zip),
    phone: emptyToNull(address.phone),
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
  };
}

export function normalizeCustomer(
  customer: ShopifyCustomerNode | null | undefined
): NormalizedCustomer | null {
  if (!customer?.id) return null;
  const customerId = gidToId(customer.id);
  if (!customerId) return null;

  const defaultAddress = normalizeAddress(customer.defaultAddress);
  if (defaultAddress) {
    defaultAddress.customer_id = customerId;
    defaultAddress.is_default = true;
    defaultAddress.address_key =
      defaultAddress.customer_address_id ?? `${customerId}__default`;
  }

  return {
    customer_id: customerId,
    admin_graphql_api_id: customer.id,
    first_name: emptyToNull(customer.firstName),
    last_name: emptyToNull(customer.lastName),
    display_name: emptyToNull(customer.displayName),
    email: emptyToNull(customer.email ?? customer.defaultEmailAddress?.emailAddress),
    phone: emptyToNull(customer.phone ?? customer.defaultPhoneNumber?.phoneNumber),
    created_at_shopify: parseTimestamp(customer.createdAt),
    updated_at_shopify: parseTimestamp(customer.updatedAt),
    state: emptyToNull(customer.state),
    verified_email: customer.verifiedEmail ?? null,
    currency: null,
    tax_exempt: customer.taxExempt ?? null,
    tags: customer.tags ?? null,
    number_of_orders: parseInteger(customer.numberOfOrders),
    email_marketing_state: emptyToNull(customer.emailMarketingConsent?.marketingState),
    email_marketing_opt_in_level: emptyToNull(
      customer.emailMarketingConsent?.marketingOptInLevel
    ),
    email_marketing_consent_updated_at: parseTimestamp(
      customer.emailMarketingConsent?.consentUpdatedAt
    ),
    sms_marketing_state: emptyToNull(customer.smsMarketingConsent?.marketingState),
    sms_marketing_opt_in_level: emptyToNull(
      customer.smsMarketingConsent?.marketingOptInLevel
    ),
    sms_marketing_consent_updated_at: parseTimestamp(
      customer.smsMarketingConsent?.consentUpdatedAt
    ),
    sms_marketing_consent_collected_from: emptyToNull(
      customer.smsMarketingConsent?.consentCollectedFrom
    ),
    default_address: defaultAddress,
  };
}

function weightToGrams(value?: number | null, unit?: string | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const u = (unit ?? "GRAMS").toUpperCase();
  if (u === "KILOGRAMS" || u === "KG") return Math.round(value * 1000);
  if (u === "POUNDS" || u === "LB") return Math.round(value * 453.592);
  if (u === "OUNCES" || u === "OZ") return Math.round(value * 28.3495);
  return Math.round(value);
}

export function normalizeLineItems(
  orderId: string,
  lineItems: ShopifyLineItemNode[]
): NormalizedLineItem[] {
  return lineItems.map((item, lineIndex) => {
    const lineItemId = gidToId(item.id);
    const sku = emptyToNull(item.sku);
    const originalTotal = moneyBagAmount(item.originalTotalSet);
    const discountedTotal = moneyBagAmount(item.discountedTotalSet);
    const unitPrice = moneyBagAmount(item.originalUnitPriceSet);
    const allocationTotal = (item.discountAllocations ?? []).reduce(
      (sum, alloc) => sum + (moneyBagAmount(alloc.allocatedAmountSet) ?? 0),
      0
    );
    const totalDiscount =
      allocationTotal > 0
        ? Math.round(allocationTotal * 100) / 100
        : originalTotal != null && discountedTotal != null
          ? Math.round((originalTotal - discountedTotal) * 100) / 100
          : null;

    return {
      shopify_line_item_id: lineItemId,
      business_key: lineItemBusinessKey(orderId, lineItemId, sku, lineIndex),
      line_index: lineIndex,
      product_id: gidToId(item.product?.id),
      variant_id: gidToId(item.variant?.id),
      sku,
      name: emptyToNull(item.name),
      title: emptyToNull(item.title),
      variant_title: emptyToNull(item.variantTitle),
      vendor: emptyToNull(item.vendor),
      quantity: item.quantity ?? null,
      current_quantity: item.currentQuantity ?? null,
      fulfillable_quantity: item.unfulfilledQuantity ?? null,
      price: unitPrice,
      total_discount: totalDiscount,
      grams: weightToGrams(
        item.variant?.inventoryItem?.measurement?.weight?.value,
        item.variant?.inventoryItem?.measurement?.weight?.unit
      ),
      product_exists: item.product?.id ? true : item.product == null ? null : false,
      requires_shipping: item.requiresShipping ?? null,
      taxable: item.taxable ?? null,
      gift_card: item.isGiftCard ?? null,
      fulfillment_service: null,
      fulfillment_status: emptyToNull(item.fulfillmentStatus),
      variant_inventory_management: null,
      properties: (item.customAttributes ?? []).map((attr, position) => ({
        position,
        property_name: emptyToNull(attr.key),
        property_value: emptyToNull(attr.value),
      })),
      discount_allocations: (item.discountAllocations ?? [])
        .filter((alloc) => alloc.discountApplication?.index != null)
        .map((alloc) => ({
          discount_application_index: alloc.discountApplication!.index as number,
          amount: moneyBagAmount(alloc.allocatedAmountSet),
        })),
    };
  });
}

function normalizeNoteAttributes(order: ShopifyOrderNode): NormalizedNoteAttribute[] {
  const attributes: NormalizedNoteAttribute[] = [];
  const seen = new Set<string>();

  const push = (name: string | null | undefined, value: string | null | undefined) => {
    const key = emptyToNull(name);
    const val = emptyToNull(value);
    if (!key || !val) return;
    const dedupe = key.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    attributes.push({
      position: attributes.length,
      attribute_name: key,
      attribute_value: val,
    });
  };

  for (const attr of order.customAttributes ?? []) {
    push(attr.key, attr.value);
  }

  const utm = order.customerJourneySummary?.firstVisit?.utmParameters;
  push("utm_source", utm?.source);
  push("utm_medium", utm?.medium);
  push("utm_campaign", utm?.campaign);
  push("utm_content", utm?.content);
  push("utm_term", utm?.term);

  return attributes;
}

function normalizeDiscountCodes(
  order: ShopifyOrderNode,
  applications: NormalizedDiscountApplication[]
): NormalizedDiscountCode[] {
  const codes: string[] = [];
  if (order.discountCode) codes.push(order.discountCode);
  if (Array.isArray(order.discountCodes)) {
    for (const entry of order.discountCodes) {
      if (typeof entry === "string") codes.push(entry);
      else if (entry?.code) codes.push(entry.code);
    }
  }
  for (const app of applications) {
    if (app.application_type === "DiscountCodeApplication" && app.title) {
      codes.push(app.title);
    }
  }

  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  return unique.map((code, position) => ({
    position,
    code,
    amount: order.totalDiscountsSet ? moneyBagAmount(order.totalDiscountsSet) : null,
    discount_type: null,
  }));
}

function normalizeDiscountApplications(
  nodes: ShopifyDiscountApplicationNode[]
): NormalizedDiscountApplication[] {
  return nodes.map((node, fallbackIndex) => {
    const percentage = node.value?.percentage;
    const amount = node.value?.amount;
    return {
      application_index: node.index ?? fallbackIndex,
      target_type: emptyToNull(node.targetType),
      application_type: emptyToNull(node.__typename),
      value: percentage ?? parseMoney(amount),
      value_type: percentage != null ? "percentage" : amount != null ? "fixed_amount" : null,
      allocation_method: emptyToNull(node.allocationMethod),
      target_selection: emptyToNull(node.targetSelection),
      title: emptyToNull(node.title ?? node.code),
      description: emptyToNull(node.description),
    };
  });
}

function normalizeFulfillments(
  nodes: ShopifyFulfillmentNode[]
): NormalizedFulfillment[] {
  return nodes
    .map((node) => {
      const id = gidToId(node.id);
      if (!id) return null;
      const tracking = node.trackingInfo ?? [];
      return {
        shopify_fulfillment_id: id,
        admin_graphql_api_id: node.id ?? null,
        created_at_shopify: parseTimestamp(node.createdAt),
        updated_at_shopify: parseTimestamp(node.updatedAt),
        location_id: gidToId(node.location?.id),
        name: emptyToNull(node.name),
        service: emptyToNull(node.service?.serviceName),
        shipment_status: emptyToNull(node.displayStatus),
        status: emptyToNull(node.status),
        tracking_company: emptyToNull(tracking[0]?.company),
        tracking_number: emptyToNull(tracking[0]?.number),
        tracking_url: emptyToNull(tracking[0]?.url),
        tracking_numbers: tracking
          .map((t) => emptyToNull(t.number))
          .filter((v): v is string => Boolean(v)),
        tracking_urls: tracking
          .map((t) => emptyToNull(t.url))
          .filter((v): v is string => Boolean(v)),
        items: connectionNodes(node.fulfillmentLineItems).map((item) => ({
          shopify_line_item_id: gidToId(item.lineItem?.id),
          quantity: item.quantity ?? null,
        })),
      };
    })
    .filter((v): v is NormalizedFulfillment => v !== null);
}

function normalizeShippingLines(
  nodes: ShopifyShippingLineNode[]
): NormalizedShippingLine[] {
  return nodes
    .map((node, index) => {
      const id = gidToId(node.id) ?? `shipping-${index}`;
      return {
        shopify_shipping_line_id: id,
        carrier_identifier: emptyToNull(node.carrierIdentifier),
        code: emptyToNull(node.code),
        title: emptyToNull(node.title),
        price: moneyBagAmount(node.originalPriceSet),
        discounted_price: moneyBagAmount(node.discountedPriceSet),
        is_removed: node.isRemoved ?? null,
        phone: emptyToNull(node.phone),
        source: emptyToNull(node.source),
      };
    });
}

export function normalizeTransactions(
  nodes: ShopifyTransactionNode[],
  refundId: string | null = null
): NormalizedTransaction[] {
  const rows: NormalizedTransaction[] = [];
  for (const node of nodes) {
    const id = gidToId(node.id);
    if (!id) continue;
    rows.push({
      shopify_transaction_id: id,
      shopify_refund_id: refundId,
      parent_id: gidToId(node.parentTransaction?.id),
      amount: moneyBagAmount(node.amountSet),
      currency: moneyBagCurrency(node.amountSet),
      authorization_code: emptyToNull(node.authorizationCode),
      gateway: emptyToNull(node.gateway ?? node.formattedGateway),
      kind: emptyToNull(node.kind),
      status: emptyToNull(node.status),
      message: null,
      error_code: emptyToNull(node.errorCode),
      payment_id: emptyToNull(node.paymentId),
      source_name: null,
      created_at_shopify: parseTimestamp(node.createdAt),
      processed_at: parseTimestamp(node.processedAt),
      test: node.test ?? null,
    });
  }
  return rows;
}

function normalizeRefunds(nodes: ShopifyRefundNode[]): NormalizedRefund[] {
  const rows: NormalizedRefund[] = [];
  for (const node of nodes) {
    const id = gidToId(node.id);
    if (!id) continue;
    const lineItems = connectionNodes(node.refundLineItems);
    rows.push({
      shopify_refund_id: id,
      created_at_shopify: parseTimestamp(node.createdAt),
      processed_at: parseTimestamp(node.updatedAt),
      note: emptyToNull(node.note),
      restock: lineItems.some((li) => Boolean(li.restockType) && li.restockType !== "NO_RESTOCK"),
      line_items: lineItems.map((li, index) => {
        const liId = gidToId(li.id) ?? `${id}-line-${index}`;
        return {
          shopify_refund_line_item_id: liId,
          shopify_line_item_id: gidToId(li.lineItem?.id),
          location_id: gidToId(li.location?.id),
          quantity: li.quantity ?? null,
          restock_type: emptyToNull(li.restockType),
          subtotal: moneyBagAmount(li.subtotalSet ?? li.priceSet),
          total_tax: moneyBagAmount(li.totalTaxSet),
        };
      }),
      adjustments: connectionNodes(node.refundShippingLines).map((line, index) => ({
        shopify_adjustment_id: gidToId(line.id) ?? `${id}-adj-${index}`,
        amount: moneyBagAmount(line.subtotalAmountSet),
        tax_amount: moneyBagAmount(line.taxAmountSet),
        kind: "shipping_refund",
        reason: null,
      })),
      transactions: normalizeTransactions(connectionNodes(node.transactions), id),
    });
  }
  return rows;
}

export function normalizeOrder(node: ShopifyOrderNode): NormalizedOrder {
  const graphqlId = node.id ?? null;
  const shopifyOrderId =
    emptyToNull(String(node.legacyResourceId ?? "")) ?? gidToId(graphqlId);
  if (!shopifyOrderId) {
    throw new Error("Shopify order is missing an identifier");
  }

  const customer = normalizeCustomer(node.customer);
  const discountApplications = normalizeDiscountApplications(
    connectionNodes(node.discountApplications)
  );
  const lineItems = normalizeLineItems(shopifyOrderId, connectionNodes(node.lineItems));
  const noteAttributes = normalizeNoteAttributes(node);
  const transactions = normalizeTransactions(connectionNodes(node.transactions));
  const refunds = normalizeRefunds(connectionNodes(node.refunds));

  const transactionsCount =
    typeof node.transactionsCount === "number"
      ? node.transactionsCount
      : parseInteger(node.transactionsCount?.count) ?? transactions.length;

  return {
    shopify_order_id: shopifyOrderId,
    admin_graphql_api_id: graphqlId,
    app_id: gidToId(node.app?.id),
    order_name: emptyToNull(node.name),
    order_number: emptyToNull(node.name?.replace(/^#/, "") ?? null),
    confirmation_number: emptyToNull(node.confirmationNumber),
    customer_id: customer?.customer_id ?? null,
    created_at_shopify: parseTimestamp(node.createdAt),
    updated_at_shopify: parseTimestamp(node.updatedAt),
    processed_at: parseTimestamp(node.processedAt),
    closed_at: parseTimestamp(node.closedAt),
    cancelled_at: parseTimestamp(node.cancelledAt),
    cancel_reason: emptyToNull(node.cancelReason),
    confirmed: node.confirmed ?? null,
    email: emptyToNull(node.email),
    contact_email: emptyToNull(node.email),
    phone: emptyToNull(node.phone),
    buyer_accepts_marketing: node.customerAcceptsMarketing ?? null,
    currency: emptyToNull(node.currencyCode),
    presentment_currency: emptyToNull(node.presentmentCurrencyCode),
    financial_status: emptyToNull(node.displayFinancialStatus),
    fulfillment_status: emptyToNull(node.displayFulfillmentStatus),
    subtotal_price: moneyBagAmount(node.subtotalPriceSet),
    current_subtotal_price: moneyBagAmount(node.currentSubtotalPriceSet),
    total_price: moneyBagAmount(node.totalPriceSet),
    current_total_price: moneyBagAmount(node.currentTotalPriceSet),
    total_discounts: moneyBagAmount(node.totalDiscountsSet),
    current_total_discounts: moneyBagAmount(node.currentTotalDiscountsSet),
    total_tax: moneyBagAmount(node.totalTaxSet),
    current_total_tax: moneyBagAmount(node.currentTotalTaxSet),
    total_line_items_price: lineItems.reduce((sum, item) => {
      const line = (item.price ?? 0) * (item.quantity ?? 0);
      return sum + line;
    }, 0),
    total_outstanding: moneyBagAmount(node.totalOutstandingSet),
    total_tip_received: moneyBagAmount(node.totalTipReceivedSet),
    total_shipping_price: moneyBagAmount(node.totalShippingPriceSet),
    total_weight: parseInteger(node.currentTotalWeight ?? node.totalWeight),
    tax_exempt: node.taxExempt ?? null,
    taxes_included: node.taxesIncluded ?? null,
    duties_included: node.dutiesIncluded ?? null,
    estimated_taxes: node.estimatedTaxes ?? null,
    test: node.test ?? null,
    note: emptyToNull(node.note),
    landing_site: emptyToNull(
      node.landingPageUrl ?? node.customerJourneySummary?.firstVisit?.landingPage
    ),
    landing_site_ref: emptyToNull(
      node.referralCode ?? node.customerJourneySummary?.firstVisit?.referralCode
    ),
    referring_site: emptyToNull(
      node.referrerUrl ?? node.customerJourneySummary?.firstVisit?.referrerUrl
    ),
    source_name: emptyToNull(
      node.sourceName ?? node.customerJourneySummary?.firstVisit?.source
    ),
    source_identifier: emptyToNull(node.sourceIdentifier),
    source_url: null,
    location_id: gidToId(node.retailLocation?.id),
    merchant_business_entity_id: gidToId(node.merchantBusinessEntity?.id),
    merchant_of_record_app_id: gidToId(node.merchantOfRecordApp?.id),
    payment_gateway_names: node.paymentGatewayNames ?? null,
    tags: node.tags ?? null,
    staff_note: emptyToNull(node.cancellation?.staffNote),
    transactions_count: transactionsCount,
    customer,
    shipping_address: normalizeAddress(node.shippingAddress, "shipping"),
    billing_address: normalizeAddress(node.billingAddress, "billing"),
    line_items: lineItems,
    note_attributes: noteAttributes,
    discount_codes: normalizeDiscountCodes(node, discountApplications),
    discount_applications: discountApplications,
    fulfillments: normalizeFulfillments(connectionNodes(node.fulfillments)),
    shipping_lines: normalizeShippingLines(connectionNodes(node.shippingLines)),
    transactions,
    refunds,
  };
}

export function hasNestedNextPage(node: ShopifyOrderNode): boolean {
  return Boolean(
    node.lineItems?.pageInfo?.hasNextPage ||
      connectionNodes(node.fulfillments).some(
        (f) => f.fulfillmentLineItems?.pageInfo?.hasNextPage
      ) ||
      connectionNodes(node.refunds).some((r) => r.refundLineItems?.pageInfo?.hasNextPage)
  );
}
