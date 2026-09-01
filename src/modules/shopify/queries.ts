const MONEY = `
  shopMoney {
    amount
    currencyCode
  }
`;

const ADDRESS = `
  firstName
  lastName
  name
  company
  address1
  address2
  city
  province
  provinceCode
  country
  countryCodeV2
  zip
  phone
  latitude
  longitude
`;

const CUSTOMER = `
  id
  firstName
  lastName
  displayName
  email
  phone
  createdAt
  updatedAt
  state
  verifiedEmail
  taxExempt
  tags
  numberOfOrders
  emailMarketingConsent {
    marketingState
    marketingOptInLevel
    consentUpdatedAt
  }
  smsMarketingConsent {
    marketingState
    marketingOptInLevel
    consentUpdatedAt
    consentCollectedFrom
  }
  defaultAddress {
    id
    ${ADDRESS}
  }
`;

const LINE_ITEM = `
  id
  sku
  name
  title
  variantTitle
  vendor
  quantity
  currentQuantity
  unfulfilledQuantity
  originalUnitPriceSet { ${MONEY} }
  originalTotalSet { ${MONEY} }
  discountedTotalSet { ${MONEY} }
  requiresShipping
  taxable
  isGiftCard
  fulfillmentStatus
  customAttributes {
    key
    value
  }
  discountAllocations {
    allocatedAmountSet { ${MONEY} }
    discountApplication {
      index
    }
  }
`;

const FULFILLMENT = `
  id
  createdAt
  updatedAt
  name
  status
  displayStatus
  service { serviceName }
  trackingInfo {
    company
    number
    url
  }
  fulfillmentLineItems(first: $nestedFirst, after: $fulfillmentItemsAfter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      quantity
      lineItem { id }
    }
  }
`;

const REFUND = `
  id
  createdAt
  updatedAt
  note
  refundLineItems(first: $nestedFirst, after: $refundItemsAfter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      quantity
      restockType
      lineItem { id }
      priceSet { ${MONEY} }
      subtotalSet { ${MONEY} }
      totalTaxSet { ${MONEY} }
    }
  }
  refundShippingLines(first: $nestedFirst) {
    nodes {
      id
      subtotalAmountSet { ${MONEY} }
      taxAmountSet { ${MONEY} }
    }
  }
`;

const TRANSACTION = `
  id
  amountSet { ${MONEY} }
  formattedGateway
  gateway
  kind
  status
  authorizationCode
  errorCode
  paymentId
  processedAt
  createdAt
  test
  parentTransaction { id }
`;

const SHIPPING_LINE_FIELDS = `
  id
  carrierIdentifier
  code
  title
  originalPriceSet { ${MONEY} }
  discountedPriceSet { ${MONEY} }
  isRemoved
  phone
  source
`;

const CHILD_FULFILLMENT = `
  id
  createdAt
  updatedAt
  name
  status
  displayStatus
  service { serviceName }
  trackingInfo {
    company
    number
    url
  }
  fulfillmentLineItems(first: 5) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      quantity
      lineItem { id }
    }
  }
`;

const CHILD_REFUND = `
  id
  createdAt
  updatedAt
  note
  refundLineItems(first: 5) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      quantity
      restockType
      lineItem { id }
      priceSet { ${MONEY} }
      subtotalSet { ${MONEY} }
      totalTaxSet { ${MONEY} }
    }
  }
  refundShippingLines(first: 5) {
    nodes {
      id
      subtotalAmountSet { ${MONEY} }
      taxAmountSet { ${MONEY} }
    }
  }
`;

const ORDER_FIELDS = `
  id
  legacyResourceId
  name
  confirmationNumber
  createdAt
  updatedAt
  processedAt
  closedAt
  cancelledAt
  cancelReason
  confirmed
  email
  phone
  customerAcceptsMarketing
  currencyCode
  presentmentCurrencyCode
  displayFinancialStatus
  displayFulfillmentStatus
  currentSubtotalPriceSet { ${MONEY} }
  currentTotalPriceSet { ${MONEY} }
  currentTotalDiscountsSet { ${MONEY} }
  currentTotalTaxSet { ${MONEY} }
  subtotalPriceSet { ${MONEY} }
  totalPriceSet { ${MONEY} }
  totalDiscountsSet { ${MONEY} }
  totalTaxSet { ${MONEY} }
  totalOutstandingSet { ${MONEY} }
  totalTipReceivedSet { ${MONEY} }
  totalShippingPriceSet { ${MONEY} }
  currentTotalWeight
  totalWeight
  taxExempt
  taxesIncluded
  dutiesIncluded
  estimatedTaxes
  test
  note
  tags
  paymentGatewayNames
  sourceIdentifier
  sourceName
  landingPageUrl
  referrerUrl
  referralCode
  customerJourneySummary {
    firstVisit {
      landingPage
      referralCode
      referrerUrl
      source
      utmParameters {
        source
        medium
        campaign
        content
        term
      }
    }
  }
  customAttributes {
    key
    value
  }
  customer {
    ${CUSTOMER}
  }
  shippingAddress {
    ${ADDRESS}
  }
  billingAddress {
    ${ADDRESS}
  }
  app { id name }
  merchantBusinessEntity { id }
  merchantOfRecordApp { id }
  cancellation { staffNote }
  transactionsCount { count }
  discountCode
  discountCodes
  discountApplications(first: $nestedFirst) {
    nodes {
      index
      targetType
      allocationMethod
      targetSelection
      __typename
      ... on DiscountCodeApplication {
        code
      }
      ... on ManualDiscountApplication {
        title
        description
      }
      ... on ScriptDiscountApplication {
        title
      }
      ... on AutomaticDiscountApplication {
        title
      }
      value {
        ... on MoneyV2 {
          amount
          currencyCode
        }
        ... on PricingPercentageValue {
          percentage
        }
      }
    }
  }
  lineItems(first: $nestedFirst, after: $lineItemsAfter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ${LINE_ITEM}
    }
  }
  fulfillments(first: $nestedFirst) {
    ${CHILD_FULFILLMENT}
  }
  shippingLines(first: $nestedFirst, includeRemovals: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ${SHIPPING_LINE_FIELDS}
    }
  }
  transactions(first: $nestedFirst) {
    ${TRANSACTION}
  }
  refunds(first: $nestedFirst) {
    ${CHILD_REFUND}
  }
`;

const ORDER_CHILDREN_FIELDS = `
  fulfillments(first: $nestedFirst) {
    ${CHILD_FULFILLMENT}
  }
  shippingLines(first: $nestedFirst, includeRemovals: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ${SHIPPING_LINE_FIELDS}
    }
  }
  transactions(first: $nestedFirst) {
    ${TRANSACTION}
  }
  refunds(first: $nestedFirst) {
    ${CHILD_REFUND}
  }
`;

export const ORDERS_QUERY = `
  query ShopifyOrders(
    $first: Int!
    $after: String
    $query: String
    $nestedFirst: Int!
    $lineItemsAfter: String
  ) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ${ORDER_FIELDS}
      }
    }
  }
`;

export const ORDER_CHILDREN_QUERY = `
  query ShopifyOrderChildren($id: ID!, $nestedFirst: Int!) {
    order(id: $id) {
      id
      ${ORDER_CHILDREN_FIELDS}
    }
  }
`;

export const ORDER_LINE_ITEMS_QUERY = `
  query ShopifyOrderLineItems($id: ID!, $nestedFirst: Int!, $lineItemsAfter: String) {
    order(id: $id) {
      id
      lineItems(first: $nestedFirst, after: $lineItemsAfter) {
        pageInfo { hasNextPage endCursor }
        nodes { ${LINE_ITEM} }
      }
    }
  }
`;

export const ORDER_FULFILLMENT_ITEMS_QUERY = `
  query ShopifyFulfillmentItems($id: ID!, $nestedFirst: Int!, $fulfillmentItemsAfter: String) {
    fulfillment(id: $id) {
      id
      fulfillmentLineItems(first: $nestedFirst, after: $fulfillmentItemsAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          quantity
          lineItem { id }
        }
      }
    }
  }
`;

export const ORDER_REFUND_ITEMS_QUERY = `
  query ShopifyRefundItems($id: ID!, $nestedFirst: Int!, $refundItemsAfter: String) {
    refund(id: $id) {
      id
      refundLineItems(first: $nestedFirst, after: $refundItemsAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          quantity
          restockType
          lineItem { id }
          priceSet { ${MONEY} }
          subtotalSet { ${MONEY} }
          totalTaxSet { ${MONEY} }
        }
      }
    }
  }
`;

export const ORDER_SHIPPING_LINES_QUERY = `
  query ShopifyOrderShippingLines($id: ID!, $nestedFirst: Int!, $after: String) {
    order(id: $id) {
      id
      shippingLines(first: $nestedFirst, after: $after, includeRemovals: true) {
        pageInfo { hasNextPage endCursor }
        nodes { ${SHIPPING_LINE_FIELDS} }
      }
    }
  }
`;

export const ORDER_TRANSACTIONS_QUERY = `
  query ShopifyOrderTransactions($id: ID!, $nestedFirst: Int!) {
    order(id: $id) {
      id
      transactions(first: $nestedFirst) {
        ${TRANSACTION}
      }
    }
  }
`;

export const ORDER_REFUNDS_QUERY = `
  query ShopifyOrderRefunds($id: ID!, $nestedFirst: Int!) {
    order(id: $id) {
      id
      refunds(first: $nestedFirst) {
        ${REFUND}
      }
    }
  }
`;

export const ACCESS_SCOPES_QUERY = `
  query ShopifyAccessScopes {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

export function buildOrdersSearchQuery(from: Date, to: Date): string {
  const start = from.toISOString();
  const end = to.toISOString();
  return `updated_at:>='${start}' updated_at:<='${end}'`;
}
