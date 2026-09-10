import { aggregateProfitability, canonicalChannel, computeJourneySummary, normalizedAttributionStatus, splitCohortFilters } from "../modules/journey/analytics";

describe("customer journey and profitability", () => {
  it.each([
    [{ channel: "META", meta_attribution_state: "EXACT_AD" }, "META"],
    [{ channel: "DIRECT", meta_attribution_state: "NO_META_MATCH" }, "DIRECT"],
    [{ channel: "GOOGLE", meta_attribution_state: "NO_META_MATCH" }, "GOOGLE"],
    [{ channel: "KWIKENGAGE", meta_attribution_state: "NO_META_MATCH" }, "KWIKENGAGE"],
    [{ channel: "OTHER", meta_attribution_state: "NO_META_MATCH" }, "OTHER"],
    [{ channel: "UNKNOWN", meta_attribution_state: "NO_META_MATCH" }, "UNKNOWN"],
    [{ channel: "DIRECT", meta_attribution_state: "EXACT_AD" }, "META"],
  ])("keeps channel and Meta attribution independent (%j)", (row, expected) => {
    expect(canonicalChannel(row)).toBe(expected);
    expect(normalizedAttributionStatus(row)).toBe(row.meta_attribution_state === "EXACT_AD" ? "EXACT_AD" : "NO_META_MATCH");
  });

  it("reconciles channel and Meta distributions independently", () => {
    const summary = computeJourneySummary([
      { shopify_order_id: "M", channel: "META", meta_attribution_state: "EXACT_AD" },
      { shopify_order_id: "D", channel: "DIRECT", meta_attribution_state: "NO_META_MATCH" },
      { shopify_order_id: "G", channel: "GOOGLE", meta_attribution_state: "NO_META_MATCH" },
    ]);
    expect(Object.values(summary.channelBreakdown).reduce((a, b) => a + b, 0)).toBe(3);
    expect(Object.values(summary.metaBreakdown).reduce((a, b) => a + b, 0)).toBe(3);
    expect(summary.knownChannel).toBe(3);
    expect(summary.exactMetaEntityOrders).toBe(1);
  });

  it("keeps outcome filters out of the acquisition cohort", () => {
    const filters = splitCohortFilters({ page: 1, pageSize: 25, from: "2026-09-01", to: "2026-09-06", channel: "DIRECT", attributionStatus: "NO_META_MATCH", delivered: "true", rto: "true", search: "AWB" });
    expect(filters).toEqual({ from: "2026-09-01", to: "2026-09-06", channel: "DIRECT", campaignId: undefined, adsetId: undefined, adId: undefined, attributionStatus: "NO_META_MATCH", paymentCategory: undefined });
  });

  it("never multiplies Meta spend by attributed order count", () => {
    const meta = [{
      campaign_id: "C1", campaign_name: "Campaign 1", adset_id: "S1", adset_name: "Set 1",
      ad_id: "A1", ad_name: "Ad 1", spend: 10000, impressions: 50000, clicks: 1000,
      landing_page_views: 700, purchases: 20, purchase_value: 80000,
    }];
    const orders = Array.from({ length: 20 }, (_, index) => ({
      shopify_order_id: `ORDER-${index}`,
      resolved_campaign_id: "C1", resolved_campaign_name: "Campaign 1",
      resolved_adset_id: "S1", resolved_adset_name: "Set 1",
      resolved_ad_id: "A1", resolved_ad_name: "Ad 1",
      meta_attribution_state: "EXACT_AD", ordered_revenue: 4000,
      financial_status: "paid", is_shipped: true, is_delivered: index < 13,
      is_rto: index >= 13 && index < 16, is_ndr: false, hierarchy_conflict: false,
    }));
    const [row] = aggregateProfitability(meta, orders, "ad");
    expect(row.spend).toBe(10000);
    expect(row.orders).toBe(20);
    expect(row.order_revenue).toBe(80000);
    expect(row.delivered_revenue).toBe(52000);
    expect(row.delivered_roas).toBe(5.2);
  });

  it("keeps RTO revenue out of delivered revenue", () => {
    const [row] = aggregateProfitability(
      [{ campaign_id: "C1", adset_id: "S1", ad_id: "A1", spend: 1000 }],
      [{ shopify_order_id: "O1", resolved_campaign_id: "C1", resolved_adset_id: "S1", resolved_ad_id: "A1", meta_attribution_state: "EXACT_AD", ordered_revenue: 2500, is_shipped: true, is_delivered: false, is_rto: true }],
      "campaign"
    );
    expect(row.rto).toBe(1);
    expect(row.delivered_revenue).toBe(0);
    expect(row.delivered_roas).toBe(0);
  });

  it("keeps original and current Shopify values separate", () => {
    const [row] = aggregateProfitability(
      [{ campaign_id: "C1", adset_id: "S1", ad_id: "A1", spend: 1000, purchases: 1, purchase_value: 2000 }],
      [{
        shopify_order_id: "VOIDED-1", resolved_campaign_id: "C1", resolved_adset_id: "S1", resolved_ad_id: "A1",
        meta_attribution_state: "EXACT_AD", ordered_revenue: 10140, current_revenue: 0,
        delivered_current_revenue: 0, financial_status: "voided", is_shipped: false,
        is_delivered: false, is_rto: false, is_ndr: false,
      }],
      "ad"
    );
    expect(row.ordered_revenue).toBe(10140);
    expect(row.current_revenue).toBe(0);
    expect(row.ordered_roas).toBe(10.14);
    expect(row.current_shopify_roas).toBe(0);
  });

  it("calculates Meta ROAS from canonical purchase value divided by spend", () => {
    const [row] = aggregateProfitability(
      [{ campaign_id: "C1", adset_id: "S1", ad_id: "120235860129720275", spend: 2887.64, purchases: 1, purchase_value: 5940 }],
      [],
      "ad"
    );
    expect(row.meta_purchases).toBe(1);
    expect(row.meta_purchase_value).toBe(5940);
    expect(row.meta_roas).toBeCloseTo(5940 / 2887.64, 6);
  });

  it("reports delivered COD without remittance as a visible exception", () => {
    const summary = computeJourneySummary([
      { shopify_order_id: "O1", meta_attribution_state: "NO_META_MATCH", shiprocket_match_status: "MATCHED", is_delivered: true, is_rto: false, is_ndr: false, payment_type: "COD", remittance_status: "DELIVERED_NOT_REMITTED", ordered_revenue: 1499 },
    ]);
    expect(summary.totalOrders).toBe(1);
    expect(summary.delivered).toBe(1);
    expect(summary.deliveredNotRemitted).toBe(1);
    expect(summary.remittedCod).toBe(0);
  });

  it("counts open NDR and historical NDR independently", () => {
    const summary = computeJourneySummary([
      { shopify_order_id: "DELIVERED", is_delivered: true, is_rto: false, is_ndr: false, had_ndr: false },
      { shopify_order_id: "OPEN", is_delivered: false, is_rto: false, is_ndr: true, had_ndr: true },
      { shopify_order_id: "RTO_AFTER_NDR", is_delivered: false, is_rto: true, is_ndr: false, had_ndr: true },
      { shopify_order_id: "RTO_UNKNOWN", is_delivered: false, is_rto: true, is_ndr: false, had_ndr: false },
    ]);
    expect(summary.ndr).toBe(1);
    expect(summary.hadNdr).toBe(2);
    expect(summary.rto).toBe(2);
    expect(summary.delivered).toBe(1);
  });

  it("keeps delivered current revenue independent of historical NDR", () => {
    const [row] = aggregateProfitability(
      [{ campaign_id: "C1", adset_id: "S1", ad_id: "A1", spend: 1000 }],
      [{ shopify_order_id: "DELIVERED_AFTER_NDR", resolved_campaign_id: "C1", resolved_adset_id: "S1", resolved_ad_id: "A1", meta_attribution_state: "EXACT_AD", ordered_revenue: 1000, current_revenue: 800, delivered_current_revenue: 800, is_delivered: true, is_rto: false, is_ndr: false, had_ndr: true }],
      "ad"
    );
    expect(row.delivered_current_revenue).toBe(800);
    expect(row.delivered_current_roas).toBe(0.8);
  });
});
