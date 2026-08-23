export type SyncMode = "test" | "backfill" | "incremental" | "repair";
export type SyncStatus = "running" | "success" | "partial" | "failed";

export interface GraphQLThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface GraphQLCost {
  requestedQueryCost?: number;
  actualQueryCost?: number;
  throttleStatus?: GraphQLThrottleStatus;
}

export interface GraphQLErrorItem {
  message: string;
  path?: Array<string | number>;
  extensions?: { code?: string; [key: string]: unknown };
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLErrorItem[];
  extensions?: { cost?: GraphQLCost };
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Connection<T> {
  nodes?: T[];
  edges?: Array<{ node: T; cursor?: string }>;
  pageInfo?: PageInfo;
}

export interface MoneyBag {
  shopMoney?: { amount?: string; currencyCode?: string };
}

export interface ShopifyAttribute {
  key?: string | null;
  value?: string | null;
}

export interface ShopifyMailingAddress {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  country?: string | null;
  countryCode?: string | null;
  countryCodeV2?: string | null;
  zip?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  id?: string | null;
}

export interface ShopifyCustomerNode {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  state?: string | null;
  verifiedEmail?: boolean | null;
  taxExempt?: boolean | null;
  tags?: string[] | null;
  numberOfOrders?: string | number | null;
  defaultEmailAddress?: { emailAddress?: string | null } | null;
  defaultPhoneNumber?: { phoneNumber?: string | null } | null;
  emailMarketingConsent?: {
    marketingState?: string | null;
    marketingOptInLevel?: string | null;
    consentUpdatedAt?: string | null;
  } | null;
  smsMarketingConsent?: {
    marketingState?: string | null;
    marketingOptInLevel?: string | null;
    consentUpdatedAt?: string | null;
    consentCollectedFrom?: string | null;
  } | null;
  defaultAddress?: ShopifyMailingAddress | null;
}

export interface ShopifyDiscountAllocationNode {
  allocatedAmountSet?: MoneyBag;
  discountApplication?: { index?: number | null };
}

export interface ShopifyLineItemNode {
  id?: string;
  sku?: string | null;
  name?: string | null;
  title?: string | null;
  variantTitle?: string | null;
  vendor?: string | null;
  quantity?: number | null;
  currentQuantity?: number | null;
  unfulfilledQuantity?: number | null;
  originalUnitPriceSet?: MoneyBag;
  originalTotalSet?: MoneyBag;
  discountedTotalSet?: MoneyBag;
  requiresShipping?: boolean | null;
  taxable?: boolean | null;
  isGiftCard?: boolean | null;
  fulfillmentStatus?: string | null;
  product?: { id?: string | null } | null;
  variant?: {
    id?: string | null;
    inventoryItem?: {
      measurement?: {
        weight?: { value?: number | null; unit?: string | null } | null;
      } | null;
    } | null;
  } | null;
  customAttributes?: ShopifyAttribute[] | null;
  discountAllocations?: ShopifyDiscountAllocationNode[] | null;
}

export interface ShopifyFulfillmentLineItemNode {
  id?: string;
  quantity?: number | null;
  lineItem?: { id?: string | null } | null;
}

export interface ShopifyFulfillmentNode {
  id?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  name?: string | null;
  status?: string | null;
  displayStatus?: string | null;
  location?: { id?: string | null } | null;
  service?: { serviceName?: string | null } | null;
  trackingInfo?: Array<{
    company?: string | null;
    number?: string | null;
    url?: string | null;
  }> | null;
  fulfillmentLineItems?: Connection<ShopifyFulfillmentLineItemNode>;
}

export interface ShopifyShippingLineNode {
  id?: string;
  carrierIdentifier?: string | null;
  code?: string | null;
  title?: string | null;
  originalPriceSet?: MoneyBag;
  discountedPriceSet?: MoneyBag;
  isRemoved?: boolean | null;
  phone?: string | null;
  source?: string | null;
}

export interface ShopifyTransactionNode {
  id?: string;
  amountSet?: MoneyBag;
  formattedGateway?: string | null;
  gateway?: string | null;
  kind?: string | null;
  status?: string | null;
  authorizationCode?: string | null;
  errorCode?: string | null;
  paymentId?: string | null;
  processedAt?: string | null;
  createdAt?: string | null;
  test?: boolean | null;
  parentTransaction?: { id?: string | null } | null;
  receiptJson?: unknown;
}

export interface ShopifyRefundLineItemNode {
  id?: string;
  quantity?: number | null;
  restockType?: string | null;
  location?: { id?: string | null } | null;
  lineItem?: { id?: string | null } | null;
  priceSet?: MoneyBag;
  subtotalSet?: MoneyBag;
  totalTaxSet?: MoneyBag;
}

export interface ShopifyRefundShippingLineNode {
  id?: string;
  subtotalAmountSet?: MoneyBag;
  taxAmountSet?: MoneyBag;
}

export interface ShopifyRefundNode {
  id?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  note?: string | null;
  refundLineItems?: Connection<ShopifyRefundLineItemNode>;
  refundShippingLines?: Connection<ShopifyRefundShippingLineNode>;
  transactions?: ShopifyTransactionNode[] | Connection<ShopifyTransactionNode>;
}

export interface ShopifyDiscountApplicationNode {
  index?: number | null;
  targetType?: string | null;
  allocationMethod?: string | null;
  targetSelection?: string | null;
  value?: {
    amount?: string;
    currencyCode?: string;
    percentage?: number;
  } | null;
  title?: string | null;
  description?: string | null;
  code?: string | null;
  __typename?: string;
}

export interface ShopifyOrderNode {
  id?: string;
  legacyResourceId?: string | number | null;
  name?: string | null;
  confirmationNumber?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  processedAt?: string | null;
  closedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  confirmed?: boolean | null;
  email?: string | null;
  phone?: string | null;
  customerAcceptsMarketing?: boolean | null;
  currencyCode?: string | null;
  presentmentCurrencyCode?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currentSubtotalPriceSet?: MoneyBag;
  currentTotalPriceSet?: MoneyBag;
  currentTotalDiscountsSet?: MoneyBag;
  currentTotalTaxSet?: MoneyBag;
  subtotalPriceSet?: MoneyBag;
  totalPriceSet?: MoneyBag;
  totalDiscountsSet?: MoneyBag;
  totalTaxSet?: MoneyBag;
  totalOutstandingSet?: MoneyBag;
  totalTipReceivedSet?: MoneyBag;
  totalShippingPriceSet?: MoneyBag;
  currentTotalWeight?: string | number | null;
  totalWeight?: string | number | null;
  taxExempt?: boolean | null;
  taxesIncluded?: boolean | null;
  dutiesIncluded?: boolean | null;
  estimatedTaxes?: boolean | null;
  test?: boolean | null;
  note?: string | null;
  tags?: string[] | null;
  paymentGatewayNames?: string[] | null;
  sourceIdentifier?: string | null;
  sourceName?: string | null;
  landingPageUrl?: string | null;
  referrerUrl?: string | null;
  referralCode?: string | null;
  customerJourneySummary?: {
    firstVisit?: {
      landingPage?: string | null;
      referralCode?: string | null;
      referrerUrl?: string | null;
      source?: string | null;
      utmParameters?: {
        source?: string | null;
        medium?: string | null;
        campaign?: string | null;
        content?: string | null;
        term?: string | null;
      } | null;
    } | null;
  } | null;
  customAttributes?: ShopifyAttribute[] | null;
  customer?: ShopifyCustomerNode | null;
  shippingAddress?: ShopifyMailingAddress | null;
  billingAddress?: ShopifyMailingAddress | null;
  lineItems?: Connection<ShopifyLineItemNode>;
  discountApplications?: Connection<ShopifyDiscountApplicationNode>;
  discountCode?: string | null;
  discountCodes?: string[] | Array<{ code?: string | null }> | null;
  fulfillments?: ShopifyFulfillmentNode[] | Connection<ShopifyFulfillmentNode>;
  shippingLines?: Connection<ShopifyShippingLineNode>;
  transactions?: ShopifyTransactionNode[] | Connection<ShopifyTransactionNode>;
  refunds?: ShopifyRefundNode[] | Connection<ShopifyRefundNode>;
  app?: { id?: string | null; name?: string | null } | null;
  merchantBusinessEntity?: { id?: string | null } | null;
  merchantOfRecordApp?: { id?: string | null } | null;
  retailLocation?: { id?: string | null } | null;
  cancellation?: { staffNote?: string | null } | null;
  transactionsCount?: { count?: number | null } | number | null;
}

export interface NormalizedAddress {
  address_type?: "shipping" | "billing";
  customer_address_id?: string | null;
  customer_id?: string;
  is_default?: boolean;
  address_key?: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  province_code: string | null;
  country: string | null;
  country_code: string | null;
  zip: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface NormalizedCustomer {
  customer_id: string;
  admin_graphql_api_id: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  created_at_shopify: string | null;
  updated_at_shopify: string | null;
  state: string | null;
  verified_email: boolean | null;
  currency: string | null;
  tax_exempt: boolean | null;
  tags: string[] | null;
  number_of_orders: number | null;
  email_marketing_state: string | null;
  email_marketing_opt_in_level: string | null;
  email_marketing_consent_updated_at: string | null;
  sms_marketing_state: string | null;
  sms_marketing_opt_in_level: string | null;
  sms_marketing_consent_updated_at: string | null;
  sms_marketing_consent_collected_from: string | null;
  default_address: NormalizedAddress | null;
}

export interface NormalizedLineItemProperty {
  position: number;
  property_name: string | null;
  property_value: string | null;
}

export interface NormalizedDiscountAllocation {
  discount_application_index: number;
  amount: number | null;
}

export interface NormalizedLineItem {
  shopify_line_item_id: string | null;
  business_key: string;
  line_index: number;
  product_id: string | null;
  variant_id: string | null;
  sku: string | null;
  name: string | null;
  title: string | null;
  variant_title: string | null;
  vendor: string | null;
  quantity: number | null;
  current_quantity: number | null;
  fulfillable_quantity: number | null;
  price: number | null;
  total_discount: number | null;
  grams: number | null;
  product_exists: boolean | null;
  requires_shipping: boolean | null;
  taxable: boolean | null;
  gift_card: boolean | null;
  fulfillment_service: string | null;
  fulfillment_status: string | null;
  variant_inventory_management: string | null;
  properties: NormalizedLineItemProperty[];
  discount_allocations: NormalizedDiscountAllocation[];
}

export interface NormalizedNoteAttribute {
  position: number;
  attribute_name: string | null;
  attribute_value: string | null;
}

export interface NormalizedDiscountCode {
  position: number;
  code: string | null;
  amount: number | null;
  discount_type: string | null;
}

export interface NormalizedDiscountApplication {
  application_index: number;
  target_type: string | null;
  application_type: string | null;
  value: number | null;
  value_type: string | null;
  allocation_method: string | null;
  target_selection: string | null;
  title: string | null;
  description: string | null;
}

export interface NormalizedFulfillmentItem {
  shopify_line_item_id: string | null;
  quantity: number | null;
}

export interface NormalizedFulfillment {
  shopify_fulfillment_id: string;
  admin_graphql_api_id: string | null;
  created_at_shopify: string | null;
  updated_at_shopify: string | null;
  location_id: string | null;
  name: string | null;
  service: string | null;
  shipment_status: string | null;
  status: string | null;
  tracking_company: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  tracking_numbers: string[];
  tracking_urls: string[];
  items: NormalizedFulfillmentItem[];
}

export interface NormalizedShippingLine {
  shopify_shipping_line_id: string;
  carrier_identifier: string | null;
  code: string | null;
  title: string | null;
  price: number | null;
  discounted_price: number | null;
  is_removed: boolean | null;
  phone: string | null;
  source: string | null;
}

export interface NormalizedTransaction {
  shopify_transaction_id: string;
  shopify_refund_id: string | null;
  parent_id: string | null;
  amount: number | null;
  currency: string | null;
  authorization_code: string | null;
  gateway: string | null;
  kind: string | null;
  status: string | null;
  message: string | null;
  error_code: string | null;
  payment_id: string | null;
  source_name: string | null;
  created_at_shopify: string | null;
  processed_at: string | null;
  test: boolean | null;
}

export interface NormalizedRefundLineItem {
  shopify_refund_line_item_id: string;
  shopify_line_item_id: string | null;
  location_id: string | null;
  quantity: number | null;
  restock_type: string | null;
  subtotal: number | null;
  total_tax: number | null;
}

export interface NormalizedAdjustment {
  shopify_adjustment_id: string;
  amount: number | null;
  tax_amount: number | null;
  kind: string | null;
  reason: string | null;
}

export interface NormalizedRefund {
  shopify_refund_id: string;
  created_at_shopify: string | null;
  processed_at: string | null;
  note: string | null;
  restock: boolean | null;
  line_items: NormalizedRefundLineItem[];
  adjustments: NormalizedAdjustment[];
  transactions: NormalizedTransaction[];
}

export interface NormalizedOrder {
  shopify_order_id: string;
  admin_graphql_api_id: string | null;
  app_id: string | null;
  order_name: string | null;
  order_number: string | null;
  confirmation_number: string | null;
  customer_id: string | null;
  created_at_shopify: string | null;
  updated_at_shopify: string | null;
  processed_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  confirmed: boolean | null;
  email: string | null;
  contact_email: string | null;
  phone: string | null;
  buyer_accepts_marketing: boolean | null;
  currency: string | null;
  presentment_currency: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  subtotal_price: number | null;
  current_subtotal_price: number | null;
  total_price: number | null;
  current_total_price: number | null;
  total_discounts: number | null;
  current_total_discounts: number | null;
  total_tax: number | null;
  current_total_tax: number | null;
  total_line_items_price: number | null;
  total_outstanding: number | null;
  total_tip_received: number | null;
  total_shipping_price: number | null;
  total_weight: number | null;
  tax_exempt: boolean | null;
  taxes_included: boolean | null;
  duties_included: boolean | null;
  estimated_taxes: boolean | null;
  test: boolean | null;
  note: string | null;
  landing_site: string | null;
  landing_site_ref: string | null;
  referring_site: string | null;
  source_name: string | null;
  source_identifier: string | null;
  source_url: string | null;
  location_id: string | null;
  merchant_business_entity_id: string | null;
  merchant_of_record_app_id: string | null;
  payment_gateway_names: string[] | null;
  tags: string[] | null;
  staff_note: string | null;
  transactions_count: number | null;
  customer: NormalizedCustomer | null;
  shipping_address: NormalizedAddress | null;
  billing_address: NormalizedAddress | null;
  line_items: NormalizedLineItem[];
  note_attributes: NormalizedNoteAttribute[];
  discount_codes: NormalizedDiscountCode[];
  discount_applications: NormalizedDiscountApplication[];
  fulfillments: NormalizedFulfillment[];
  shipping_lines: NormalizedShippingLine[];
  transactions: NormalizedTransaction[];
  refunds: NormalizedRefund[];
}

export interface SchemaDriftObservation {
  entity_type: string;
  field_path: string;
  observed_type: string;
}

export interface SyncWindow {
  requestedFrom: Date;
  requestedTo: Date;
  actualFrom: Date;
  actualTo: Date;
  historyWarning: string | null;
  accessibleHistoryDays: number;
}

export interface SyncRunCounts {
  ordersFetched: number;
  ordersInserted: number;
  ordersUpdated: number;
  itemsUpserted: number;
  customersUpserted: number;
  refundsUpserted: number;
  fulfillmentsUpserted: number;
  pagesFetched: number;
  apiRequests: number;
  retryCount: number;
}

export interface SyncRunResult {
  success: boolean;
  runId: string;
  mode: SyncMode;
  status: SyncStatus;
  from: string;
  to: string;
  actualFrom: string;
  actualTo: string;
  historyWarning: string | null;
  resumable?: boolean;
  lockConflict?: boolean;
  ordersFetched: number;
  itemsUpserted: number;
  pagesFetched: number;
  retryCount: number;
}

export interface SyncStateRow {
  shop_domain: string;
  last_successful_sync_at: string | null;
  last_attempted_sync_at: string | null;
  last_backfill_completed_at: string | null;
  last_backfill_start_at: string | null;
  granted_scopes: string[] | null;
  api_version: string | null;
  accessible_history_days: number | null;
  history_warning: string | null;
}
