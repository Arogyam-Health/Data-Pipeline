import { getShopifyAccessToken } from "../modules/shopify/auth";
import {
  ShopifyGraphqlClient,
  connectionNodes,
  isRetryableStatus,
  parseRetryAfterMs,
  throttleWaitMs,
} from "../modules/shopify/graphql";
import {
  classifyPaymentCategory,
  extractUtms,
  lineItemBusinessKey,
  normalizeCustomer,
  normalizeOrder,
  parseMoney,
} from "../modules/shopify/normalizer";
import { detectSchemaDrift } from "../modules/shopify/schema-drift";
import {
  assertBackfillAllowed,
  assertIncrementalAllowed,
  computeSyncWindow,
  expandNestedConnections,
  shouldAdvanceWatermark,
} from "../modules/shopify/sync";
import { childUpsertConflictTarget, computeStaleKeys } from "../modules/shopify/repository";
import {
  ShopifyAuthError,
  ShopifySyncConflictError,
  ShopifySyncDisabledError,
  sanitizeShopifyError,
} from "../modules/shopify/errors";
import {
  authorizeInternalSync,
  getShopifyEnv,
  isShopifySyncEnabled,
  maskEmail,
  maskPhone,
  resetShopifyEnvCache,
  formatLineItemsSummary,
  resolveCustomerName,
  runShopifySync,
  shouldStartLocalShopifyScheduler,
} from "../modules/shopify";
import type { GraphQLResponse, ShopifyOrderNode } from "../modules/shopify/types";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function money(amount: string) {
  return { shopMoney: { amount, currencyCode: "INR" } };
}

function sampleOrder(overrides: Partial<ShopifyOrderNode> = {}): ShopifyOrderNode {
  return {
    id: "gid://shopify/Order/1001",
    legacyResourceId: "1001",
    name: "#1001",
    confirmationNumber: "CONF1001",
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T12:00:00Z",
    email: "buyer@example.com",
    phone: "+910000000000",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    currencyCode: "INR",
    presentmentCurrencyCode: "INR",
    totalPriceSet: money("1000.00"),
    currentTotalPriceSet: money("1000.00"),
    subtotalPriceSet: money("1000.00"),
    totalDiscountsSet: money("0.00"),
    test: false,
    paymentGatewayNames: ["shopify_payments"],
    customAttributes: [
      { key: "utm_source", value: "google" },
      { key: "utm_medium", value: "cpc" },
      { key: "utm_campaign", value: "test-campaign" },
    ],
    customer: {
      id: "gid://shopify/Customer/55",
      firstName: "Test",
      lastName: "Buyer",
      displayName: "Test Buyer",
      email: "buyer@example.com",
      phone: "+910000000000",
      numberOfOrders: "3",
      defaultAddress: {
        id: "gid://shopify/MailingAddress/9",
        city: "Pune",
        province: "Maharashtra",
        zip: "411001",
        country: "India",
        countryCodeV2: "IN",
      },
    },
    shippingAddress: {
      firstName: "Test",
      lastName: "Buyer",
      city: "Pune",
      province: "Maharashtra",
      zip: "411001",
      phone: "+910000000001",
      country: "India",
      countryCodeV2: "IN",
    },
    billingAddress: {
      city: "Mumbai",
      province: "Maharashtra",
      country: "India",
    },
    lineItems: {
      nodes: [
        {
          id: "gid://shopify/LineItem/77",
          sku: "OK-001",
          name: "OK Powder",
          title: "OK Powder",
          variantTitle: "Default",
          quantity: 2,
          originalUnitPriceSet: money("500.00"),
          originalTotalSet: money("1000.00"),
          discountedTotalSet: money("1000.00"),
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    discountCodes: ["SAVE10"],
    discountApplications: {
      nodes: [
        {
          index: 0,
          targetType: "LINE_ITEM",
          allocationMethod: "ACROSS",
          targetSelection: "ALL",
          __typename: "DiscountCodeApplication",
          code: "SAVE10",
          value: { amount: "0.00" },
        },
      ],
    },
    fulfillments: [
      {
        id: "gid://shopify/Fulfillment/88",
        status: "SUCCESS",
        displayStatus: "FULFILLED",
        trackingInfo: [{ company: "Delhivery", number: "TRK1", url: "https://track.example.com/TRK1" }],
        fulfillmentLineItems: {
          nodes: [{ quantity: 2, lineItem: { id: "gid://shopify/LineItem/77" } }],
        },
      },
    ],
    transactions: [
      {
        id: "gid://shopify/OrderTransaction/91",
        amountSet: money("1000.00"),
        gateway: "shopify_payments",
        kind: "SALE",
        status: "SUCCESS",
        processedAt: "2026-08-01T10:05:00Z",
      },
    ],
    refunds: [],
    ...overrides,
  };
}

describe("Shopify access token", () => {
  it("requires SHOPIFY_ACCESS_TOKEN when Shopify env is invoked", () => {
    resetShopifyEnvCache();
    expect(() =>
      getShopifyEnv({
        ...(process.env as Record<string, string>),
        SHOPIFY_ACCESS_TOKEN: "",
      })
    ).toThrow(/SHOPIFY_ACCESS_TOKEN/);
  });

  it("reads the server-side access token", () => {
    resetShopifyEnvCache();
    const env = getShopifyEnv();
    expect(getShopifyAccessToken(env)).toBe("test-shopify-access-token");
  });

  it("never includes the token value in sanitized errors", () => {
    const sanitized = sanitizeShopifyError(
      "failed shpat_ThisIsNotARealTokenValue000 and access_token=secret"
    );
    expect(sanitized).not.toContain("shpat_");
    expect(sanitized).not.toContain("secret");
    expect(sanitized).toContain("[REDACTED]");
  });

  it("sends the env token on GraphQL requests and never calls OAuth", async () => {
    const urls: string[] = [];
    let tokenHeader = "";
    const client = new ShopifyGraphqlClient({
      env: getShopifyEnv(),
      sleep: async () => undefined,
      fetchImpl: async (input, init) => {
        urls.push(String(input));
        tokenHeader = String((init?.headers as Record<string, string>)["X-Shopify-Access-Token"] ?? "");
        return jsonResponse({ data: { ok: true } });
      },
    });
    await client.request("query { ok }");
    expect(tokenHeader).toBe("test-shopify-access-token");
    expect(urls.some((url) => url.includes("/oauth/access_token"))).toBe(false);
    expect(urls.some((url) => url.includes("/graphql.json"))).toBe(true);
  });

  it("continues when Shopify denies a field but still returns data", async () => {
    const client = new ShopifyGraphqlClient({
      env: getShopifyEnv(),
      sleep: async () => undefined,
      fetchImpl: async () =>
        jsonResponse({
          data: { orders: { nodes: [{ id: "gid://shopify/Order/1" }] } },
          errors: [
            {
              message: "Access denied for variant field. Required access: `read_products` access scope.",
              path: ["orders", "nodes", 0, "lineItems", "nodes", 0, "variant"],
              extensions: { code: "ACCESS_DENIED" },
            },
          ],
        }),
    });
    const result = await client.request<{ orders: { nodes: Array<{ id: string }> } }>("query { orders }");
    expect(result.data?.orders.nodes[0]?.id).toBe("gid://shopify/Order/1");
  });

  it("fails 401 without retrying OAuth or client_credentials", async () => {
    let calls = 0;
    const client = new ShopifyGraphqlClient({
      env: getShopifyEnv(),
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        calls += 1;
        expect(String(input)).not.toContain("/oauth/access_token");
        return jsonResponse({ errors: [{ message: "unauthorized" }] }, 401);
      },
    });
    await expect(client.request("query { ok }")).rejects.toBeInstanceOf(ShopifyAuthError);
    expect(calls).toBe(1);
  });

  it("does not advance the watermark after auth failure", () => {
    expect(shouldAdvanceWatermark("incremental", "failed")).toBe(false);
    expect(shouldAdvanceWatermark("repair", "failed")).toBe(false);
    expect(shouldAdvanceWatermark("backfill", "failed")).toBe(false);
  });
});

describe("Shopify GraphQL client", () => {
  const env = getShopifyEnv();

  it("paginates until hasNextPage is false", async () => {
    const pages = [
      {
        data: {
          orders: {
            pageInfo: { hasNextPage: true, endCursor: "c1" },
            nodes: [{ id: "gid://shopify/Order/1", legacyResourceId: "1", name: "#1" }],
          },
        },
      },
      {
        data: {
          orders: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ id: "gid://shopify/Order/2", legacyResourceId: "2", name: "#2" }],
          },
        },
      },
    ];
    let i = 0;
    const client = new ShopifyGraphqlClient({
      env,
      fetchImpl: async () => jsonResponse(pages[i++] ?? pages[1]),
      sleep: async () => undefined,
    });

    const collected: unknown[] = [];
    let after: string | null = null;
    type OrdersPage = {
      orders: { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    };
    for (let page = 0; page < 3; page += 1) {
      const payload: GraphQLResponse<OrdersPage> = await client.request(
        "query { orders { nodes { id } } }",
        { after }
      );
      const pageData: OrdersPage["orders"] | undefined = payload.data?.orders;
      collected.push(...(pageData?.nodes ?? []));
      after = pageData?.pageInfo.hasNextPage ? pageData.pageInfo.endCursor : null;
      if (!after) break;
    }
    expect(collected).toHaveLength(2);
  });

  it("retries HTTP 429 using Retry-After", async () => {
    let calls = 0;
    const client = new ShopifyGraphqlClient({
      env,
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse({ errors: [] }, 429, { "retry-after": "1" });
        return jsonResponse({ data: { ok: true } });
      },
    });
    const result = await client.request<{ ok: boolean }>("query { ok }");
    expect(result.data?.ok).toBe(true);
    expect(client.retryCount).toBe(1);
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(isRetryableStatus(429)).toBe(true);
  });

  it("waits when GraphQL throttle capacity is low", async () => {
    const waits: number[] = [];
    const client = new ShopifyGraphqlClient({
      env,
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetchImpl: async () =>
        jsonResponse({
          data: { ok: true },
          extensions: {
            cost: {
              throttleStatus: { currentlyAvailable: 10, restoreRate: 50, maximumAvailable: 1000 },
            },
          },
        }),
    });
    await client.request("query { ok }");
    expect(waits.length).toBeGreaterThan(0);
    expect(throttleWaitMs({ currentlyAvailable: 10, restoreRate: 50, maximumAvailable: 1000 })).toBeGreaterThan(0);
  });

  it("reads connection nodes from edges or nodes", () => {
    expect(connectionNodes({ nodes: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(connectionNodes({ edges: [{ node: { id: 2 } }] })).toEqual([{ id: 2 }]);
    expect(connectionNodes([{ id: 3 }])).toEqual([{ id: 3 }]);
  });

  it("expands nested fulfillment and refund pages", async () => {
    const client = new ShopifyGraphqlClient({
      env,
      sleep: async () => undefined,
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
        const query = body.query ?? "";
        if (query.includes("ShopifyFulfillmentItems")) {
          return jsonResponse({
            data: {
              fulfillment: {
                fulfillmentLineItems: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [{ quantity: 1, lineItem: { id: "gid://shopify/LineItem/extra" } }],
                },
              },
            },
          });
        }
        if (query.includes("ShopifyRefundItems")) {
          return jsonResponse({
            data: {
              refund: {
                refundLineItems: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [{ id: "gid://shopify/RefundLineItem/9", quantity: 1 }],
                },
              },
            },
          });
        }
        return jsonResponse({ data: {} });
      },
    });

    const expanded = await expandNestedConnections(
      client,
      sampleOrder({
        fulfillments: [
          {
            id: "gid://shopify/Fulfillment/88",
            fulfillmentLineItems: {
              nodes: [{ quantity: 2, lineItem: { id: "gid://shopify/LineItem/77" } }],
              pageInfo: { hasNextPage: true, endCursor: "f1" },
            },
          },
        ],
        refunds: {
          nodes: [
            {
              id: "gid://shopify/Refund/5",
              refundLineItems: {
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: "r1" },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      })
    );

    const fulfillments = connectionNodes(expanded.fulfillments);
    expect(connectionNodes(fulfillments[0]?.fulfillmentLineItems)).toHaveLength(2);
    expect(connectionNodes(expanded.refunds)[0]?.refundLineItems?.nodes).toHaveLength(1);
    expect(client.apiRequests).toBeGreaterThanOrEqual(2);
  });
});

describe("Shopify normalization", () => {
  it("normalizes an order, customer, and shipping/billing addresses", () => {
    const order = normalizeOrder(sampleOrder());
    expect(order.shopify_order_id).toBe("1001");
    expect(order.email).toBe("buyer@example.com");
    expect(order.customer?.customer_id).toBe("55");
    expect(order.shipping_address?.city).toBe("Pune");
    expect(order.billing_address?.city).toBe("Mumbai");
    expect(order.shipping_address?.phone).toBe("+910000000001");
  });

  it("normalizes one order with one line item", () => {
    const order = normalizeOrder(sampleOrder());
    expect(order.line_items).toHaveLength(1);
    expect(order.line_items[0].business_key).toBe("1001__LINE_ITEM_ID__77");
    expect(order.line_items[0].sku).toBe("OK-001");
    expect(order.line_items[0].quantity).toBe(2);
    expect(order.line_items[0].price).toBe(500);
  });

  it("normalizes one order with multiple line items", () => {
    const order = normalizeOrder(
      sampleOrder({
        lineItems: {
          nodes: [
            { id: "gid://shopify/LineItem/1", sku: "A", quantity: 1, originalUnitPriceSet: money("100.00") },
            { id: "gid://shopify/LineItem/2", sku: "B", quantity: 3, originalUnitPriceSet: money("50.00") },
          ],
        },
      })
    );
    expect(order.line_items).toHaveLength(2);
    expect(order.line_items.map((i) => i.business_key)).toEqual([
      "1001__LINE_ITEM_ID__1",
      "1001__LINE_ITEM_ID__2",
    ]);
  });

  it("builds line-item business keys with SKU and index fallbacks", () => {
    expect(lineItemBusinessKey("1001", "77", "SKU", 0)).toBe("1001__LINE_ITEM_ID__77");
    expect(lineItemBusinessKey("1001", null, "SKU-9", 2)).toBe("1001__SKU__SKU-9__INDEX__2");
    expect(lineItemBusinessKey("1001", null, null, 4)).toBe("1001__INDEX__4");
  });

  it("extracts note attributes and UTMs", () => {
    const order = normalizeOrder(sampleOrder());
    expect(order.note_attributes.map((a) => a.attribute_name)).toEqual(
      expect.arrayContaining(["utm_source", "utm_medium", "utm_campaign"])
    );
    const utm = extractUtms(order.note_attributes);
    expect(utm.utm_source).toBe("google");
    expect(utm.utm_campaign).toBe("test-campaign");
  });

  it("normalizes discounts, fulfillments, refunds, and transactions", () => {
    const order = normalizeOrder(
      sampleOrder({
        refunds: [
          {
            id: "gid://shopify/Refund/5",
            createdAt: "2026-08-02T10:00:00Z",
            note: "size issue",
            refundLineItems: {
              nodes: [
                {
                  id: "gid://shopify/RefundLineItem/6",
                  quantity: 1,
                  restockType: "CANCEL",
                  lineItem: { id: "gid://shopify/LineItem/77" },
                  subtotalSet: money("500.00"),
                  totalTaxSet: money("0.00"),
                },
              ],
            },
          },
        ],
        displayFinancialStatus: "REFUNDED",
      })
    );
    expect(order.discount_codes[0].code).toBe("SAVE10");
    expect(order.fulfillments[0].tracking_number).toBe("TRK1");
    expect(order.transactions[0].amount).toBe(1000);
    expect(order.refunds[0].shopify_refund_id).toBe("5");
    expect(order.refunds[0].line_items[0].quantity).toBe(1);
    expect(order.financial_status).toBe("REFUNDED");
  });

  it("parses money safely and maps nullable / cancelled orders", () => {
    expect(parseMoney("12.50")).toBe(12.5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("nope")).toBeNull();
    const cancelled = normalizeOrder(
      sampleOrder({
        cancelledAt: "2026-08-03T09:00:00Z",
        cancelReason: "CUSTOMER",
        email: "",
        customer: null,
      })
    );
    expect(cancelled.cancelled_at).toBe("2026-08-03T09:00:00.000Z");
    expect(cancelled.cancel_reason).toBe("CUSTOMER");
    expect(cancelled.email).toBeNull();
    expect(cancelled.customer).toBeNull();
  });

  it("reprocesses the same payload idempotently without duplicating items", () => {
    const first = normalizeOrder(sampleOrder());
    const second = normalizeOrder(sampleOrder());
    expect(second.shopify_order_id).toBe(first.shopify_order_id);
    expect(second.line_items.map((i) => i.business_key)).toEqual(
      first.line_items.map((i) => i.business_key)
    );
    expect(new Set(second.line_items.map((i) => i.business_key)).size).toBe(second.line_items.length);
  });

  it("does not persist raw JSON fields on the normalized order", () => {
    const order = normalizeOrder(sampleOrder());
    expect(order).not.toHaveProperty("raw_payload");
    expect(order).not.toHaveProperty("payload");
    expect(order).not.toHaveProperty("source_json");
    expect(JSON.stringify(order)).not.toContain("raw_shopify");
  });

  it("normalizes a customer record", () => {
    const customer = normalizeCustomer({
      id: "gid://shopify/Customer/9",
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(customer?.customer_id).toBe("9");
    expect(customer?.email).toBe("ada@example.com");
  });
});

describe("Shopify watermark and concurrency", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  it("uses a 10-minute overlap for incremental sync", () => {
    const window = computeSyncWindow({
      mode: "incremental",
      now,
      lastSuccessfulSyncAt: "2026-08-21T11:00:00.000Z",
      bufferMinutes: 10,
      testDays: 3,
      grantedScopes: ["read_orders", "read_all_orders"],
      requestedBackfillDays: 90,
    });
    expect(window.actualFrom.toISOString()).toBe("2026-08-21T10:50:00.000Z");
    expect(window.actualTo.toISOString()).toBe(now.toISOString());
  });

  it("advances the watermark only on incremental success", () => {
    expect(shouldAdvanceWatermark("incremental", "success")).toBe(true);
    expect(shouldAdvanceWatermark("incremental", "failed")).toBe(false);
    expect(shouldAdvanceWatermark("incremental", "partial")).toBe(false);
    expect(shouldAdvanceWatermark("backfill", "success")).toBe(false);
    expect(shouldAdvanceWatermark("repair", "success", "2026-08-01T00:00:00.000Z")).toBe(false);
  });

  it("lets a successful test initialize a missing watermark only", () => {
    expect(shouldAdvanceWatermark("test", "success", null)).toBe(true);
    expect(shouldAdvanceWatermark("test", "success", "2026-08-01T00:00:00.000Z")).toBe(false);
  });

  it("does not guess an incremental window when no watermark exists", () => {
    expect(() =>
      computeSyncWindow({
        mode: "incremental",
        now,
        lastSuccessfulSyncAt: null,
        bufferMinutes: 10,
        testDays: 3,
        grantedScopes: ["read_orders"],
        requestedBackfillDays: 90,
      })
    ).toThrow(/watermark/i);
  });

  it("reports a 60-day history warning when read_all_orders is missing", () => {
    const window = computeSyncWindow({
      mode: "backfill",
      now,
      lastSuccessfulSyncAt: null,
      bufferMinutes: 10,
      testDays: 3,
      grantedScopes: ["read_orders"],
      requestedBackfillDays: 90,
    });
    expect(window.historyWarning).toMatch(/read_all_orders/);
    expect(window.accessibleHistoryDays).toBe(60);
  });

  it("rejects a second active backfill", () => {
    expect(() => assertBackfillAllowed(false, { id: "job-1" })).toThrow(ShopifySyncConflictError);
  });

  it("blocks incremental and repair while a backfill is active", () => {
    expect(() => assertIncrementalAllowed({ id: "job-1" })).toThrow(ShopifySyncConflictError);
    expect(() => assertIncrementalAllowed(null)).not.toThrow();
  });

  it("does not move the incremental watermark for repair", () => {
    expect(shouldAdvanceWatermark("repair", "success", "existing")).toBe(false);
  });
});

describe("Shopify schema drift, child cleanup, and analytics safety", () => {
  it("records only field path and type, never the unknown value", () => {
    const drift = detectSchemaDrift(
      sampleOrder({ mysteryField: "SECRET_VALUE" } as ShopifyOrderNode)
    );
    expect(drift.some((d) => d.field_path === "orders.mysteryField")).toBe(true);
    expect(JSON.stringify(drift)).not.toContain("SECRET_VALUE");
  });

  it("detects nested unknown fields without storing values", () => {
    const drift = detectSchemaDrift(
      sampleOrder({
        customer: {
          id: "gid://shopify/Customer/55",
          extraCustomerField: "keep-out",
        } as ShopifyOrderNode["customer"],
      })
    );
    expect(drift.some((d) => d.entity_type === "customer" && d.field_path.includes("extraCustomerField"))).toBe(
      true
    );
    expect(JSON.stringify(drift)).not.toContain("keep-out");
  });

  it("computes stale child keys without malformed empty deletes", () => {
    expect(computeStaleKeys(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
    expect(computeStaleKeys(["a"], [])).toEqual(["a"]);
    expect(computeStaleKeys([], ["a"])).toEqual([]);
    expect(computeStaleKeys([null, "x"], ["x"])).toEqual([]);
  });

  it("upserts child rows on their unique keys, not the generated uuid id", () => {
    expect(childUpsertConflictTarget("shopify_order_addresses", "address_type")).toBe(
      "shopify_order_id,address_type"
    );
    expect(childUpsertConflictTarget("shopify_order_items", "business_key")).toBe("business_key");
    expect(childUpsertConflictTarget("shopify_fulfillments", "shopify_fulfillment_id")).toBe(
      "shopify_fulfillment_id"
    );
  });

  it("does not double-count order totals across line items", () => {
    const order = normalizeOrder(
      sampleOrder({
        totalPriceSet: money("1000.00"),
        lineItems: {
          nodes: [
            { id: "gid://shopify/LineItem/1", sku: "A", quantity: 1, originalUnitPriceSet: money("400.00"), originalTotalSet: money("400.00"), discountedTotalSet: money("400.00") },
            { id: "gid://shopify/LineItem/2", sku: "B", quantity: 1, originalUnitPriceSet: money("600.00"), originalTotalSet: money("600.00"), discountedTotalSet: money("600.00") },
          ],
        },
      })
    );
    const naive = order.line_items.reduce((sum) => sum + (order.total_price ?? 0), 0);
    const itemRevenue = order.line_items.reduce(
      (sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 0) - (item.total_discount ?? 0),
      0
    );
    expect(order.total_price).toBe(1000);
    expect(naive).toBe(2000);
    expect(itemRevenue).toBe(1000);
  });

  it("classifies payment methods conservatively", () => {
    expect(classifyPaymentCategory(["cash_on_delivery"])).toBe("COD");
    expect(classifyPaymentCategory(["shopify_payments"])).toBe("PREPAID");
    expect(classifyPaymentCategory(["unknown_gateway"])).toBe("OTHER");
    expect(classifyPaymentCategory([])).toBe("UNKNOWN");
  });
});

describe("Shopify API guards", () => {
  it("rejects a missing or incorrect internal sync secret", () => {
    expect(authorizeInternalSync(null)).toBe(false);
    expect(authorizeInternalSync("Bearer wrong-secret")).toBe(false);
    expect(authorizeInternalSync("Bearer test-shopify-sync-secret")).toBe(true);
  });

  it("refuses incremental sync when SHOPIFY_SYNC_ENABLED is false", async () => {
    resetShopifyEnvCache();
    const env = getShopifyEnv({
      ...(process.env as Record<string, string>),
      SHOPIFY_SYNC_ENABLED: "false",
    });
    expect(isShopifySyncEnabled(env)).toBe(false);
    await expect(
      runShopifySync({ mode: "incremental", env, requireEnabled: true })
    ).rejects.toBeInstanceOf(ShopifySyncDisabledError);
  });

  it("starts the local incremental scheduler only on a long-lived Node process", () => {
    expect(
      shouldStartLocalShopifyScheduler({
        syncEnabled: true,
        runtime: "nodejs",
      })
    ).toBe(true);
    expect(
      shouldStartLocalShopifyScheduler({
        syncEnabled: false,
        runtime: "nodejs",
      })
    ).toBe(false);
    expect(
      shouldStartLocalShopifyScheduler({
        syncEnabled: true,
        runtime: "edge",
      })
    ).toBe(false);
    expect(
      shouldStartLocalShopifyScheduler({
        syncEnabled: true,
        runtime: "nodejs",
        jestWorkerId: "1",
      })
    ).toBe(false);
  });

  it("can still mask PII helpers when needed", () => {
    expect(maskEmail("buyer@example.com")).toBe("b***@example.com");
    expect(maskPhone("+919876543210")).toMatch(/3210$/);
  });

  it("formats sheet-style line item summaries", () => {
    expect(
      formatLineItemsSummary([
        { name: "Obesity Killer Kit", sku: "2 KITS", quantity: 1 },
        { name: null, sku: "ADDON", quantity: 2 },
      ])
    ).toBe("Obesity Killer Kit × 1, ADDON × 2");
  });

  it("resolves a visible customer name from display, first/last, or shipping", () => {
    expect(resolveCustomerName({ displayName: "Preeti Rao" })).toBe("Preeti Rao");
    expect(resolveCustomerName({ firstName: "Harmeet", lastName: "Kour" })).toBe("Harmeet Kour");
    expect(resolveCustomerName({ shippingName: "Harmeet Kour" })).toBe("Harmeet Kour");
    expect(resolveCustomerName({})).toBeNull();
  });
});
