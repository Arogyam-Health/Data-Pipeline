export const INTEGRATION = "shopify" as const;

export const DEFAULT_API_VERSION = "2026-04";
export const DEFAULT_PAGE_SIZE = 100;
export const DEFAULT_MAX_PAGE_SIZE = 250;
/** Order list page size cap so a single GraphQL query stays under Shopify's 1000 cost. */
export const LIST_ORDER_PAGE_SIZE = 25;
export const LIST_NESTED_FIRST = 20;
export const DETAIL_NESTED_FIRST = 50;
export const DEFAULT_TEST_FETCH_DAYS = 3;
export const DEFAULT_BACKFILL_DAYS = 90;
export const DEFAULT_BACKFILL_CHUNK_DAYS = 3;
export const DEFAULT_INCREMENTAL_BUFFER_MINUTES = 10;
export const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
export const SCHEDULER_STARTUP_DELAY_MS = 15_000;
export const DEFAULT_MAX_FETCH_RETRIES = 6;
export const SYNC_LOCK_TTL_SECONDS = 15 * 60;
export const DEFAULT_ACCESSIBLE_HISTORY_DAYS = 60;

export const REQUIRED_SCOPES = [
  "read_orders",
  "read_customers",
  "read_fulfillments",
  "read_assigned_fulfillment_orders",
  "read_merchant_managed_fulfillment_orders",
  "read_third_party_fulfillment_orders",
] as const;

export const OPTIONAL_SCOPES = ["read_all_orders"] as const;

export const RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000] as const;

export const ORDER_KNOWN_FIELDS = [
  "id",
  "name",
  "confirmationNumber",
  "createdAt",
  "updatedAt",
  "processedAt",
  "closedAt",
  "cancelledAt",
  "cancelReason",
  "confirmed",
  "email",
  "phone",
  "customerAcceptsMarketing",
  "currencyCode",
  "presentmentCurrencyCode",
  "displayFinancialStatus",
  "displayFulfillmentStatus",
  "currentSubtotalPriceSet",
  "currentTotalPriceSet",
  "currentTotalDiscountsSet",
  "currentTotalTaxSet",
  "subtotalPriceSet",
  "totalPriceSet",
  "totalDiscountsSet",
  "totalTaxSet",
  "totalOutstandingSet",
  "totalTipReceivedSet",
  "totalShippingPriceSet",
  "currentTotalWeight",
  "totalWeight",
  "taxExempt",
  "taxesIncluded",
  "dutiesIncluded",
  "estimatedTaxes",
  "test",
  "note",
  "tags",
  "paymentGatewayNames",
  "sourceIdentifier",
  "sourceName",
  "landingPageUrl",
  "referrerUrl",
  "referralCode",
  "customerJourneySummary",
  "customAttributes",
  "customer",
  "shippingAddress",
  "billingAddress",
  "lineItems",
  "discountApplications",
  "discountCode",
  "discountCodes",
  "fulfillments",
  "shippingLines",
  "transactions",
  "refunds",
  "app",
  "merchantBusinessEntity",
  "merchantOfRecordApp",
  "retailLocation",
  "cancellation",
  "legacyResourceId",
  "transactionsCount",
  "pageInfo",
  "nodes",
  "edges",
  "cursor",
  "node",
  "__typename",
] as const;

export const LINE_ITEM_KNOWN_FIELDS = [
  "id",
  "sku",
  "name",
  "title",
  "variantTitle",
  "vendor",
  "quantity",
  "currentQuantity",
  "unfulfilledQuantity",
  "originalUnitPriceSet",
  "originalTotalSet",
  "discountedTotalSet",
  "requiresShipping",
  "taxable",
  "isGiftCard",
  "fulfillmentStatus",
  "product",
  "variant",
  "customAttributes",
  "discountAllocations",
  "__typename",
] as const;

export const CUSTOMER_KNOWN_FIELDS = [
  "id",
  "firstName",
  "lastName",
  "displayName",
  "email",
  "phone",
  "createdAt",
  "updatedAt",
  "state",
  "verifiedEmail",
  "taxExempt",
  "tags",
  "numberOfOrders",
  "emailMarketingConsent",
  "smsMarketingConsent",
  "defaultAddress",
  "__typename",
] as const;

export const FULFILLMENT_KNOWN_FIELDS = [
  "id",
  "createdAt",
  "updatedAt",
  "name",
  "status",
  "displayStatus",
  "location",
  "service",
  "trackingInfo",
  "fulfillmentLineItems",
  "__typename",
] as const;

export const REFUND_KNOWN_FIELDS = [
  "id",
  "createdAt",
  "updatedAt",
  "note",
  "refundLineItems",
  "refundShippingLines",
  "transactions",
  "__typename",
] as const;

export const TRANSACTION_KNOWN_FIELDS = [
  "id",
  "amountSet",
  "formattedGateway",
  "gateway",
  "kind",
  "status",
  "authorizationCode",
  "errorCode",
  "paymentId",
  "processedAt",
  "createdAt",
  "test",
  "parentTransaction",
  "__typename",
] as const;

export const SHIPPING_LINE_KNOWN_FIELDS = [
  "id",
  "carrierIdentifier",
  "code",
  "title",
  "originalPriceSet",
  "discountedPriceSet",
  "isRemoved",
  "phone",
  "source",
  "__typename",
] as const;

export const DISCOUNT_APPLICATION_KNOWN_FIELDS = [
  "index",
  "targetType",
  "allocationMethod",
  "targetSelection",
  "value",
  "title",
  "description",
  "code",
  "__typename",
] as const;

export const COD_GATEWAY_PATTERN =
  /(^|[^a-z])(cash_on_delivery|cash on delivery|cod|cash)([^a-z]|$)/i;
export const PREPAID_GATEWAY_PATTERN =
  /shopify_payments|bogus|razorpay|payu|phonepe|stripe|paypal|gokwik|simpl|lazypay|lazy_pay|upi|card|wallet/i;
