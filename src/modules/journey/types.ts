export type JourneyFilter = {
  from?: string;
  to?: string;
  source?: string;
  channel?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  attributionStatus?: string;
  paymentCategory?: string;
  courier?: string;
  shipmentStatus?: string;
  delivered?: string;
  rto?: string;
  ndr?: string;
  hadNdr?: string;
  remittanceStatus?: string;
  search?: string;
};

export type JourneyListRequest = JourneyFilter & {
  page: number;
  pageSize: number;
};

export type JourneyRow = Record<string, unknown> & {
  shopify_order_id: string;
  order_name?: string | null;
  order_number?: string | null;
};

export type JourneySummary = {
  totalOrders: number;
  knownChannel: number;
  unknownChannel: number;
  metaChannelOrders: number;
  metaAttributedOrders: number;
  exactMetaEntityOrders: number;
  exactAdOrders: number;
  metaSourceOnlyOrders: number;
  shiprocketMatched: number;
  delivered: number;
  rto: number;
  ndr: number;
  hadNdr: number;
  deliveredNotRemitted: number;
  deliveredCod: number;
  remittedCod: number;
  remittanceMatched: number;
  hierarchyConflicts: number;
  averageRemittanceDelayDays: number | null;
  attributedRevenue: number;
  deliveredRevenue: number;
  channelBreakdown: Record<string, number>;
  metaBreakdown: Record<string, number>;
};

export type ProfitabilityLevel = "campaign" | "adset" | "ad";

export type ProfitabilityRow = {
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  meta_purchases: number;
  meta_purchase_value: number;
  orders: number;
  paid_orders: number;
  ordered_revenue: number;
  current_revenue: number;
  delivered_ordered_revenue: number;
  delivered_current_revenue: number;
  ordered_roas: number | null;
  current_shopify_roas: number | null;
  delivered_current_roas: number | null;
  // Backward-compatible ordered-revenue aliases.
  order_revenue: number;
  shipped: number;
  delivered: number;
  rto: number;
  ndr: number;
  delivered_revenue: number;
  conflict_orders: number;
  attribution_coverage: number | null;
  meta_roas: number | null;
  shopify_roas: number | null;
  delivered_roas: number | null;
};
