import { getSupabaseClient } from "@/lib/supabase/admin";
import { resolveCanonicalDeliveryState } from "@/modules/shiprocket/status";
import type {
  JourneyFilter,
  JourneyListRequest,
  JourneyRow,
  ProfitabilityLevel,
  ProfitabilityRow,
} from "./types";

const JOURNEY_COLUMNS = [
  "shopify_order_id", "order_name", "order_number", "created_at_shopify", "order_date",
  "customer_key", "currency", "ordered_revenue", "current_revenue", "delivered_current_revenue", "financial_status", "fulfillment_status",
  "payment_type", "is_cod", "shopify_payment_gateway_names", "channel", "meta_attribution_state", "attribution_method",
  "resolved_campaign_id", "resolved_campaign_name", "resolved_adset_id", "resolved_adset_name",
  "resolved_ad_id", "resolved_ad_name", "hierarchy_conflict", "shiprocket_match_status",
  "shiprocket_sr_order_id", "awb", "shipment_id", "courier_name", "shiprocket_status_raw",
  "shiprocket_status_id", "shiprocket_current_status_raw", "shiprocket_current_status_id", "delivery_outcome", "is_shipped", "is_delivered", "is_rto",
  "is_ndr", "had_ndr", "is_cancelled", "undelivered_reason", "undelivered_reason_code", "delivery_attempt_count", "shipped_at", "delivered_at", "remittance_status",
  "latest_remitted_at", "remitted_amount", "remittance_order_value_total", "latest_total_adjusted_amt", "latest_remittance_date", "crf_id", "utr", "journey_stage",
  "journey_data_quality", "has_remittance_match",
  "has_exact_meta_attribution", "has_shiprocket_match",
].join(",");
// mart_order_journey_ndr is the underlying Journey-grain source used for the
// bulk fetch. Keep this projection explicit: latest_total_adjusted_amt and
// latest_remittance_date are added by mart_order_journey_remittance, not by
// the NDR view. Remittance values are merged from effective evidence below.
export const JOURNEY_NDR_FETCH_COLUMNS = [
  "shopify_order_id", "order_name", "order_number", "created_at_shopify", "order_date",
  "customer_key", "currency", "ordered_revenue", "current_revenue", "delivered_current_revenue", "financial_status", "fulfillment_status",
  "payment_type", "is_cod", "shopify_payment_gateway_names", "channel", "meta_attribution_state", "attribution_method",
  "resolved_campaign_id", "resolved_campaign_name", "resolved_adset_id", "resolved_adset_name",
  "resolved_ad_id", "resolved_ad_name", "hierarchy_conflict", "shiprocket_match_status",
  "shiprocket_sr_order_id", "awb", "shipment_id", "courier_name", "shiprocket_status_raw",
  "shiprocket_status_id", "shiprocket_current_status_raw", "shiprocket_current_status_id", "delivery_outcome", "is_shipped", "is_delivered", "is_rto",
  "is_ndr", "had_ndr", "is_cancelled", "undelivered_reason", "undelivered_reason_code", "delivery_attempt_count", "shipped_at", "delivered_at", "remittance_status",
  "latest_remitted_at", "remitted_amount", "remittance_order_value_total", "crf_id", "utr", "journey_stage",
  "journey_data_quality", "has_remittance_match",
  "has_exact_meta_attribution", "has_shiprocket_match",
].join(",");

const ATTRIBUTION_COLUMNS = [
  "shopify_order_id", "utm_source_raw", "utm_medium_raw", "utm_campaign_raw", "utm_term_raw",
  "utm_content_raw", "attribution_method", "adset_consistency_status", "campaign_consistency_status",
  "tracking_quality",
].join(",");

const META_PROFITABILITY_PAGE_SIZE = 1000;

// Supabase filter builders vary after every chained method.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

function clean(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next || undefined;
}

function escapeSearch(value: string): string {
  return value.replace(/[%_,()\\]/g, "");
}

export async function fetchAllMetaProfitabilityRows(
  fetchPage: (offset: number, pageSize: number) => Promise<Record<string, unknown>[]>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += META_PROFITABILITY_PAGE_SIZE) {
    const page = await fetchPage(offset, META_PROFITABILITY_PAGE_SIZE);
    rows.push(...page);
    if (page.length < META_PROFITABILITY_PAGE_SIZE) break;
  }
  return rows;
}

export function normalizedAttributionStatus(row: Record<string, unknown>): string {
  const state = String(row.meta_attribution_state ?? "");
  return ["EXACT_AD", "EXACT_ADSET", "EXACT_CAMPAIGN", "META_SOURCE_ONLY"].includes(state)
    ? state
    : "NO_META_MATCH";
}

const exactMetaStates = new Set(["EXACT_AD", "EXACT_ADSET", "EXACT_CAMPAIGN"]);

export function canonicalChannel(row: Record<string, unknown>): string {
  if (exactMetaStates.has(String(row.meta_attribution_state || ""))) return "META";
  const channel = String(row.channel || "UNKNOWN");
  return ["META", "DIRECT", "GOOGLE", "KWIKENGAGE", "OTHER", "UNKNOWN"].includes(channel) ? channel : "UNKNOWN";
}

function applyJourneyFilters(query: Query, filters: JourneyFilter): Query {
  let next = query;
  if (clean(filters.from)) next = next.gte("order_date", filters.from);
  if (clean(filters.to)) next = next.lte("order_date", filters.to);
  const requestedChannel = clean(filters.channel || filters.source);
  if (requestedChannel === "META") {
    next = next.or("channel.eq.META,meta_attribution_state.in.(EXACT_AD,EXACT_ADSET,EXACT_CAMPAIGN)");
  } else if (requestedChannel) {
    next = next.eq("channel", requestedChannel).not("meta_attribution_state", "in", "(EXACT_AD,EXACT_ADSET,EXACT_CAMPAIGN)");
  }
  if (clean(filters.campaignId)) next = next.eq("resolved_campaign_id", filters.campaignId);
  if (clean(filters.adsetId)) next = next.eq("resolved_adset_id", filters.adsetId);
  if (clean(filters.adId)) next = next.eq("resolved_ad_id", filters.adId);
  if (clean(filters.paymentCategory)) next = next.eq("payment_type", filters.paymentCategory);
  if (clean(filters.courier)) next = next.eq("courier_name", filters.courier);
  if (clean(filters.shipmentStatus)) next = next.eq("delivery_outcome", filters.shipmentStatus);
  if (filters.delivered === "true") next = next.eq("is_delivered", true);
  if (filters.delivered === "false") next = next.eq("is_delivered", false);
  if (filters.rto === "true") next = next.eq("is_rto", true);
  if (filters.rto === "false") next = next.eq("is_rto", false);
  if (filters.ndr === "true") next = next.eq("is_ndr", true);
  if (filters.ndr === "false") next = next.eq("is_ndr", false);
  if (filters.hadNdr === "true") next = next.eq("had_ndr", true);
  if (filters.hadNdr === "false") next = next.eq("had_ndr", false);
  if (clean(filters.remittanceStatus)) next = next.eq("remittance_status", filters.remittanceStatus);
  const attribution = clean(filters.attributionStatus);
  if (attribution === "UNATTRIBUTED" || attribution === "NO_META_MATCH") next = next.eq("meta_attribution_state", "NO_META_MATCH");
  else if (attribution) next = next.eq("meta_attribution_state", attribution);
  const search = clean(filters.search);
  if (search) {
    const term = escapeSearch(search.replace(/^#/, ""));
    next = next.or(
      `shopify_order_id.eq.${term},order_name.eq.${term},order_name.eq.#${term},order_number.eq.${term},shiprocket_sr_order_id.eq.${term},awb.eq.${term},shipment_id.eq.${term},crf_id.eq.${term},utr.eq.${term}`
    );
  }
  return next;
}

async function fetchAllJourney(filters: JourneyFilter): Promise<JourneyRow[]> {
  const key = JSON.stringify({
    from: filters.from || "", to: filters.to || "", channel: filters.channel || filters.source || "",
    campaignId: filters.campaignId || "", adsetId: filters.adsetId || "", adId: filters.adId || "",
    attributionStatus: filters.attributionStatus || "", paymentCategory: filters.paymentCategory || "",
    courier: filters.courier || "", shipmentStatus: filters.shipmentStatus || "",
    delivered: filters.delivered || "", rto: filters.rto || "", ndr: filters.ndr || "", hadNdr: filters.hadNdr || "",
    remittanceStatus: filters.remittanceStatus || "", search: filters.search || "",
  });
  const cached = journeyFetchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const client = getSupabaseClient();
  const promise = (async () => {
    // Remittance status is canonical only after the matched remittance rows
    // are merged. Do not let the stale mart value remove rows first.
    // Delivery outcome can be corrected by persisted scan evidence, so do not
    // let the stale view filter those rows out before canonical resolution.
    const queryFilters = (filters.remittanceStatus || filters.delivered || filters.shipmentStatus)
      ? { ...filters, remittanceStatus: undefined, delivered: undefined, shipmentStatus: undefined }
      : filters;
    // REMITTED is established by the effective remittance merge below, so the
    // mart's remittance_status cannot be used as the source filter. We can,
    // however, safely narrow this one status at the database boundary using
    // the effective matched SR IDs. This avoids scanning the entire Journey
    // cohort and then discarding almost all rows in Node.
    let effectiveRemittanceSrIds: string[] | null = null;
    if (filters.remittanceStatus === "REMITTED") {
      const { data: remittanceIds, error: remittanceIdError } = await client
        .from("shiprocket_effective_remittance_orders")
        .select("matched_sr_order_id")
        .eq("match_status", "matched")
        .not("matched_sr_order_id", "is", null)
        .limit(20000);
      if (remittanceIdError) throw new Error(`Journey remittance scope lookup failed: ${remittanceIdError.message}`);
      effectiveRemittanceSrIds = [...new Set((remittanceIds || [])
        .map((row) => String(row.matched_sr_order_id || ""))
        .filter(Boolean))];
      if (!effectiveRemittanceSrIds.length) return [];
    }
    const rows: JourneyRow[] = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      // Remittance is merged from the effective evidence below. Reading the
      // remittance wrapper here would execute its latest-remittance join for
      // the whole cohort (and can time out before the effective merge runs).
      // The NDR mart contains the same Journey row grain and delivery fields.
      let query = client.from("mart_order_journey_ndr").select(JOURNEY_NDR_FETCH_COLUMNS);
      query = applyJourneyFilters(query, queryFilters);
      if (effectiveRemittanceSrIds) query = query.in("shiprocket_sr_order_id", effectiveRemittanceSrIds);
      query = query.order("shopify_order_id", { ascending: true }).range(offset, offset + 999);
      const { data, error } = await query;
      if (error) throw new Error(`Journey query failed: ${error.message}`);
      rows.push(...((data || []) as unknown as JourneyRow[]));
      if (!data || data.length < 1000) break;
    }
    const srIds = [...new Set(rows.map((row) => String(row.shiprocket_sr_order_id || "")).filter(Boolean))];
    const scansBySr = new Map<string, Array<Record<string, unknown>>>();
    for (let offset = 0; offset < srIds.length; offset += 500) {
      const ids = srIds.slice(offset, offset + 500);
      const { data: scans, error: scanError } = await client.from("shiprocket_scans")
        .select("sr_order_id,scan_date,status,sr_status,sr_status_label,activity")
        .in("sr_order_id", ids);
      if (scanError) throw new Error(`Journey delivery scan lookup failed: ${scanError.message}`);
      for (const scan of scans || []) {
        const key = String(scan.sr_order_id);
        scansBySr.set(key, [...(scansBySr.get(key) || []), scan as Record<string, unknown>]);
      }
    }
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const state = resolveCanonicalDeliveryState({
        shipmentStatus: String(row.shiprocket_status_raw || ""),
        currentStatus: String(row.shiprocket_current_status_raw || ""),
        shipmentStatusId: row.shiprocket_status_id,
        currentStatusId: row.shiprocket_current_status_id,
        orderStatus: row.shiprocket_order_status,
        deliveredDate: row.delivered_at ? String(row.delivered_at) : null,
        awb: String(row.awb || "") || null,
        scans: scansBySr.get(String(row.shiprocket_sr_order_id || "")) || [],
      });
      rows[index] = { ...row, delivery_outcome: state.outcome, is_delivered: state.isDelivered, is_rto: state.isRto, is_ndr: state.isNdr, delivered_at: row.delivered_at || state.deliveredDate, canonical_delivery_source: state.source };
    }
    // Propagate the canonical Shiprocket remittance match into the journey.
    // The Day-3 view historically gated remittance status on COD, which made
    // valid delivered matches disappear when Shopify payment enrichment was
    // unavailable. Match by the importer-established matched_sr_order_id.
    const canonicalRemittances: Record<string, unknown>[] = [];
    for (let offset = 0; offset < srIds.length; offset += 500) {
      const ids = srIds.slice(offset, offset + 500);
      const { data: remittances } = await client.from("shiprocket_effective_remittance_orders")
        .select("matched_sr_order_id,crf_id,utr,remittance_date,order_value,total_adjusted_amt,match_status,match_method,match_reason_code")
        .in("matched_sr_order_id", ids)
        .eq("match_status", "matched");
      canonicalRemittances.push(...((remittances || []) as Record<string, unknown>[]));
    }
    const canonicalRows = mergeCanonicalRemittance(rows, canonicalRemittances);
    const deliveryFiltered = canonicalRows.filter((row) =>
      (!filters.delivered || (filters.delivered === "true" ? Boolean(row.is_delivered) : !row.is_delivered))
      && (!filters.shipmentStatus || String(row.delivery_outcome || "") === filters.shipmentStatus)
    );
    return filters.remittanceStatus
      ? deliveryFiltered.filter((row) => String(row.remittance_status || "") === filters.remittanceStatus)
      : deliveryFiltered;
  })();
  journeyFetchCache.set(key, { promise, expiresAt: Date.now() + 15000 });
  void promise.catch(() => journeyFetchCache.delete(key));
  return promise;
}

const journeyFetchCache = new Map<string, { promise: Promise<JourneyRow[]>; expiresAt: number }>();

export function mergeCanonicalRemittance(
  rows: JourneyRow[],
  remittances: Array<Record<string, unknown>>
): JourneyRow[] {
  const bySr = new Map<string, Record<string, unknown>>();
  for (const remittance of remittances) {
    const srId = String(remittance.matched_sr_order_id || "");
    if (!srId) continue;
    const previous = bySr.get(srId);
    if (!previous || String(remittance.remittance_date || "") > String(previous.remittance_date || "")) bySr.set(srId, remittance);
  }
  return rows.map((row) => {
    const match = bySr.get(String(row.shiprocket_sr_order_id || ""));
    const payment = String(row.payment_type || "").toUpperCase();
    const gateways = Array.isArray(row.shopify_payment_gateway_names) ? row.shopify_payment_gateway_names.map(String).join(" ") : String(row.shopify_payment_gateway_names || "");
    const isCod = payment === "COD" || String(row.is_cod || "").toLowerCase() === "true" || /cod|cash/i.test(gateways);
    const isDelivered = Boolean(row.is_delivered) || String(row.delivery_outcome || "") === "DELIVERED";
    if (!match) {
      return {
        ...row,
        has_remittance_match: false,
        remittance_match_status: "NOT_MATCHED",
        remittance_match_method: null,
        remittance_match_reason_code: null,
        remittance_status: !isCod ? "NOT_APPLICABLE" : isDelivered ? "DELIVERED_NOT_REMITTED" : "NOT_REMITTED",
        remittance_order_value_total: null,
        latest_total_adjusted_amt: null,
        latest_remittance_date: null,
        crf_id: null,
        utr: null,
        latest_remitted_at: null,
        remitted_amount: null,
        remittance_adjustment: null,
      };
    }
    const reconciliationStatus = !isCod
      ? "REMITTANCE_FOUND_NON_COD"
      : isDelivered ? "REMITTED" : "REMITTED_NOT_DELIVERED";
    return {
      ...row,
      has_remittance_match: true,
      remittance_match_status: "MATCHED",
      remittance_status: reconciliationStatus,
      remittance_match_method: match.match_method ?? row.remittance_match_method,
      remittance_match_reason_code: match.match_reason_code ?? row.remittance_match_reason_code,
      remittance_order_value_total: match.order_value ?? row.remittance_order_value_total,
      latest_total_adjusted_amt: match.total_adjusted_amt ?? row.latest_total_adjusted_amt,
      latest_remittance_date: match.remittance_date ?? row.latest_remittance_date,
      crf_id: match.crf_id ?? row.crf_id,
      utr: match.utr ?? row.utr,
      latest_remitted_at: match.remittance_date ?? row.latest_remitted_at,
      // total_adjusted_amt is an adjustment, not the amount remitted to this order.
      remitted_amount: match.order_value ?? row.remitted_amount,
      remittance_adjustment: match.total_adjusted_amt ?? row.remittance_adjustment,
    };
  });
}

async function attributionByOrder(orderIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const client = getSupabaseClient();
  const map = new Map<string, Record<string, unknown>>();
  for (let offset = 0; offset < orderIds.length; offset += 200) {
    const ids = orderIds.slice(offset, offset + 200);
    if (!ids.length) continue;
    const { data, error } = await client
      .from("shopify_meta_attribution")
      .select(ATTRIBUTION_COLUMNS)
      .in("shopify_order_id", ids);
    if (error) throw new Error(`Attribution lookup failed: ${error.message}`);
    for (const row of (data || []) as unknown as Record<string, unknown>[]) {
      map.set(String(row.shopify_order_id), row);
    }
  }
  return map;
}

async function creativeByAd(adIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const client = getSupabaseClient();
  const uniqueIds = [...new Set(adIds.filter(Boolean))];
  const map = new Map<string, Record<string, unknown>>();
  if (!uniqueIds.length) return map;
  const { data: ads, error } = await client.from("meta_ads").select("ad_id,creative_id").in("ad_id", uniqueIds);
  if (error) throw new Error(`Creative lookup failed: ${error.message}`);
  const creativeIds = [...new Set(((ads || []) as unknown as Array<{ creative_id?: string }>).map((row) => row.creative_id).filter(Boolean))] as string[];
  const { data: creatives, error: creativeError } = creativeIds.length
    ? await client.from("meta_creatives").select("creative_id,name").in("creative_id", creativeIds)
    : { data: [], error: null };
  if (creativeError) throw new Error(`Creative metadata lookup failed: ${creativeError.message}`);
  const names = new Map(((creatives || []) as unknown as Array<{ creative_id: string; name: string | null }>).map((row) => [row.creative_id, row.name]));
  for (const ad of (ads || []) as unknown as Array<{ ad_id: string; creative_id: string | null }>) {
    map.set(ad.ad_id, { creative_id: ad.creative_id, creative_name: ad.creative_id ? names.get(ad.creative_id) || null : null });
  }
  return map;
}

function enrichRows(rows: JourneyRow[], attribution: Map<string, Record<string, unknown>>, creatives = new Map<string, Record<string, unknown>>()): JourneyRow[] {
  return rows.map((row) => {
    const evidence = attribution.get(String(row.shopify_order_id)) || {};
    const status = normalizedAttributionStatus(row);
    const exactMeta = exactMetaStates.has(String(row.meta_attribution_state || ""));
    const channel = exactMeta ? "META" : canonicalChannel(row);
    const channelConflict = exactMeta && String(row.channel || "UNKNOWN") !== "META";
    const conflictReason = [
      evidence.adset_consistency_status === "CONFLICT" ? "utm_term contradicts the Meta ad hierarchy" : null,
      evidence.campaign_consistency_status === "CONFLICT" ? "utm_campaign contradicts the resolved Meta hierarchy" : null,
    ].filter(Boolean).join("; ") || null;
    const complete = row.shiprocket_match_status !== "MATCHED"
      ? "COMMERCE_ONLY"
      : row.is_delivered && row.payment_type === "COD" && row.remittance_status !== "REMITTED"
        ? "DELIVERY_COMPLETE_SETTLEMENT_MISSING"
        : row.is_delivered && row.payment_type === "COD" && row.remittance_status === "REMITTED"
          ? "COMPLETE"
          : row.is_delivered ? "DELIVERY_COMPLETE" : "IN_PROGRESS";
    const delivered = row.delivered_at ? new Date(String(row.delivered_at)) : null;
    const remitted = row.latest_remitted_at ? new Date(String(row.latest_remitted_at)) : null;
    return {
      ...row,
      ...evidence,
      ...(creatives.get(String(row.resolved_ad_id || "")) || {}),
      attribution_status: status,
      attribution_confidence: status === "EXACT_AD" ? "HIGH" : status === "EXACT_ADSET" || status === "EXACT_CAMPAIGN" ? "MEDIUM" : status === "META_SOURCE_ONLY" ? "LOW" : "NONE",
      channel_attribution: channel,
      channel_attributed: channel !== "UNKNOWN",
      channel_raw_source: evidence.utm_source_raw || null,
      channel_attribution_method: channelConflict ? "EXACT_META_ID_OVERRIDE" : evidence.utm_source_raw ? "UTM_SOURCE" : "NO_SOURCE_EVIDENCE",
      channel_conflict: channelConflict,
      meta_attribution: status,
      meta_attribution_method: status === "NO_META_MATCH" ? "NO_META_MATCH" : evidence.attribution_method || status,
      meta_hierarchy_conflict: Boolean(row.hierarchy_conflict),
      meta_conflict_reason: conflictReason,
      conflict_reason: conflictReason,
      source_display: channel === "UNKNOWN" ? "Unknown" : evidence.utm_source_raw || channel,
      journey_completeness: complete,
      remittance_delay_days: delivered && remitted && !Number.isNaN(delivered.valueOf()) && !Number.isNaN(remitted.valueOf())
        ? Math.floor((remitted.valueOf() - delivered.valueOf()) / 86400000)
        : null,
    };
  });
}

export function computeJourneySummary(rows: JourneyRow[]) {
  const exactStates = exactMetaStates;
  const isCod = (row: JourneyRow) => row.payment_type === "COD" || row.is_cod === true || String(row.is_cod || "").toLowerCase() === "true" || /cod|cash/i.test(Array.isArray(row.shopify_payment_gateway_names) ? row.shopify_payment_gateway_names.map(String).join(" ") : String(row.shopify_payment_gateway_names || ""));
  const deliveredCod = rows.filter((row) => row.is_delivered && isCod(row));
  const remittedCod = deliveredCod.filter((row) => row.remittance_status === "REMITTED");
  const channelBreakdown: Record<string, number> = { META: 0, DIRECT: 0, GOOGLE: 0, KWIKENGAGE: 0, OTHER: 0, UNKNOWN: 0 };
  const metaBreakdown: Record<string, number> = { EXACT_AD: 0, EXACT_ADSET: 0, EXACT_CAMPAIGN: 0, META_SOURCE_ONLY: 0, NO_META_MATCH: 0 };
  for (const row of rows) {
    const channel = canonicalChannel(row);
    channelBreakdown[channel] = (channelBreakdown[channel] || 0) + 1;
    const meta = normalizedAttributionStatus(row);
    metaBreakdown[meta] = (metaBreakdown[meta] || 0) + 1;
  }
  return {
    totalOrders: rows.length,
    knownChannel: rows.length - channelBreakdown.UNKNOWN,
    unknownChannel: channelBreakdown.UNKNOWN,
    metaChannelOrders: channelBreakdown.META,
    metaAttributedOrders: rows.filter((row) => exactStates.has(String(row.meta_attribution_state))).length,
    exactMetaEntityOrders: rows.filter((row) => exactStates.has(String(row.meta_attribution_state))).length,
    exactAdOrders: rows.filter((row) => row.meta_attribution_state === "EXACT_AD").length,
    metaSourceOnlyOrders: rows.filter((row) => row.meta_attribution_state === "META_SOURCE_ONLY").length,
    shiprocketMatched: rows.filter((row) => row.shiprocket_match_status === "MATCHED").length,
    delivered: rows.filter((row) => row.is_delivered).length,
    rto: rows.filter((row) => row.is_rto).length,
    ndr: rows.filter((row) => row.is_ndr).length,
    hadNdr: rows.filter((row) => row.had_ndr).length,
    deliveredNotRemitted: deliveredCod.filter((row) => row.remittance_status === "DELIVERED_NOT_REMITTED").length,
    deliveredCod: deliveredCod.length,
    remittedCod: remittedCod.length,
    remittanceMatched: rows.filter((row) => row.has_remittance_match).length,
    hierarchyConflicts: rows.filter((row) => row.hierarchy_conflict).length,
    averageRemittanceDelayDays: (() => {
      const delays = remittedCod.flatMap((row) => {
        if (!row.delivered_at || !row.latest_remitted_at) return [];
        const delay = (new Date(String(row.latest_remitted_at)).valueOf() - new Date(String(row.delivered_at)).valueOf()) / 86400000;
        return Number.isFinite(delay) ? [delay] : [];
      });
      return delays.length ? delays.reduce((sum, delay) => sum + delay, 0) / delays.length : null;
    })(),
    attributedRevenue: rows.filter((row) => exactStates.has(String(row.meta_attribution_state))).reduce((sum, row) => sum + Number(row.ordered_revenue || 0), 0),
    deliveredRevenue: rows.filter((row) => row.is_delivered).reduce((sum, row) => sum + Number(row.ordered_revenue || 0), 0),
    channelBreakdown,
    metaBreakdown,
  };
}

export async function queryJourneyOrders(request: JourneyListRequest) {
  const cohortFilters = splitCohortFilters(request);
  const [cohortRows, outcomeRows] = await Promise.all([fetchAllJourney(cohortFilters), fetchAllJourney(request)]);
  const orderedRows = [...outcomeRows].sort((a, b) => String(b.created_at_shopify || "").localeCompare(String(a.created_at_shopify || "")));
  const from = (request.page - 1) * request.pageSize;
  const pageRows = orderedRows.slice(from, from + request.pageSize);
  const [evidence, creatives] = await Promise.all([
    attributionByOrder(pageRows.map((row) => String(row.shopify_order_id))),
    creativeByAd(pageRows.map((row) => String(row.resolved_ad_id || "")).filter(Boolean)),
  ]);
  return {
    rows: enrichRows(pageRows, evidence, creatives),
    total: orderedRows.length,
    page: request.page,
    pageSize: request.pageSize,
    summary: computeJourneySummary(outcomeRows),
    cohortSummary: computeJourneySummary(cohortRows),
    outcomeSummary: computeJourneySummary(outcomeRows),
    operationalLookup: request.search && outcomeRows.length === 0 ? await lookupOperationalIdentifier(request.search) : null,
  };
}

async function lookupOperationalIdentifier(input: string): Promise<Record<string, unknown>[]> {
  const client = getSupabaseClient();
  const term = input.trim().replace(/^#/, "");
  if (!term) return [];
  const { data: orders } = await client.from("shiprocket_order_explorer")
    .select("sr_order_id,order_id,order_id_shopify_format,awb,shipment_id,shipment_status,current_status,status_bucket,delivered_date,courier_name")
    .or(`sr_order_id.eq.${term},order_id.eq.${term},order_id_shopify_format.eq.${term},awb.eq.${term}`)
    .limit(20);
  const rows = (orders || []) as Record<string, unknown>[];
  if (!rows.length) {
    const { data: remittanceRows } = await client.from("shiprocket_effective_remittance_orders")
      .select("matched_sr_order_id,crf_id,utr,remittance_date,total_adjusted_amt,match_status")
      .or(`crf_id.eq.${term},utr.eq.${term}`)
      .limit(100);
    const srIds = [...new Set((remittanceRows || []).map((row) => String(row.matched_sr_order_id || "")).filter(Boolean))];
    if (srIds.length) {
      const { data: matchedOrders } = await client.from("shiprocket_order_explorer")
        .select("sr_order_id,order_id,order_id_shopify_format,awb,shipment_id,shipment_status,current_status,status_bucket,delivered_date,courier_name")
        .in("sr_order_id", srIds);
      return ((matchedOrders || []) as Record<string, unknown>[]).map((row) => ({
        result_type: "FULFILMENT_SETTLEMENT_ONLY", ...row,
        remittance: (remittanceRows || []).find((item) => String(item.matched_sr_order_id) === String(row.sr_order_id)) || null,
      }));
    }
  }
  const ids = rows.map((row) => String(row.sr_order_id || "")).filter(Boolean);
  if (!ids.length) return [];
  const { data: remittances } = await client.from("shiprocket_effective_remittance_orders")
    .select("matched_sr_order_id,crf_id,utr,remittance_date,total_adjusted_amt,match_status")
    .in("matched_sr_order_id", ids).eq("match_status", "matched");
  return rows.map((row) => {
    const remittance = (remittances || []).find((item) => String(item.matched_sr_order_id) === String(row.sr_order_id));
    return { result_type: remittance ? "FULFILMENT_SETTLEMENT_ONLY" : "FULFILMENT_ONLY", ...row, remittance: remittance || null };
  });
}

export function splitCohortFilters(request: JourneyListRequest): JourneyFilter {
  return {
    from: request.from, to: request.to, channel: request.channel || request.source,
    campaignId: request.campaignId, adsetId: request.adsetId, adId: request.adId,
    attributionStatus: request.attributionStatus, paymentCategory: request.paymentCategory,
  };
}

export function aggregateProfitability(
  metaRows: Record<string, unknown>[],
  journeyRows: JourneyRow[],
  level: ProfitabilityLevel
): ProfitabilityRow[] {
  const map = new Map<string, ProfitabilityRow>();
  const keyFor = (campaign: unknown, adset: unknown, ad: unknown) =>
    level === "campaign" ? String(campaign || "NO_META_MATCH")
      : level === "adset" ? `${campaign || ""}|${adset || "NO_META_MATCH"}`
        : `${campaign || ""}|${adset || ""}|${ad || "NO_META_MATCH"}`;
  const ensure = (source: Record<string, unknown>) => {
    const key = keyFor(source.campaign_id ?? source.resolved_campaign_id, source.adset_id ?? source.resolved_adset_id, source.ad_id ?? source.resolved_ad_id);
    let row = map.get(key);
    if (!row) {
      row = {
        campaign_id: String(source.campaign_id ?? source.resolved_campaign_id ?? "") || null,
        campaign_name: String(source.campaign_name ?? source.resolved_campaign_name ?? "") || null,
        adset_id: level === "campaign" ? null : String(source.adset_id ?? source.resolved_adset_id ?? "") || null,
        adset_name: level === "campaign" ? null : String(source.adset_name ?? source.resolved_adset_name ?? "") || null,
        ad_id: level === "ad" ? String(source.ad_id ?? source.resolved_ad_id ?? "") || null : null,
        ad_name: level === "ad" ? String(source.ad_name ?? source.resolved_ad_name ?? "") || null : null,
        spend: 0, impressions: 0, clicks: 0, landing_page_views: 0, meta_purchases: 0,
        meta_purchase_value: 0, orders: 0, paid_orders: 0, order_revenue: 0, ordered_revenue: 0,
        current_revenue: 0, shipped: 0, delivered: 0, rto: 0, ndr: 0,
        delivered_revenue: 0, delivered_ordered_revenue: 0, delivered_current_revenue: 0, conflict_orders: 0,
        attribution_coverage: null,
        meta_roas: null, ordered_roas: null, current_shopify_roas: null,
        shopify_roas: null, delivered_roas: null, delivered_current_roas: null,
      };
      map.set(key, row);
    }
    return row;
  };
  for (const source of metaRows) {
    const row = ensure(source);
    row.spend += Number(source.spend || 0);
    row.impressions += Number(source.impressions || 0);
    row.clicks += Number(source.clicks || 0);
    row.landing_page_views += Number(source.landing_page_views || 0);
    row.meta_purchases += Number(source.purchases || 0);
    row.meta_purchase_value += Number(source.purchase_value || 0);
  }
  for (const source of journeyRows) {
    if (!["EXACT_AD", "EXACT_ADSET", "EXACT_CAMPAIGN"].includes(String(source.meta_attribution_state)) || !source.resolved_campaign_id) continue;
    const row = ensure(source);
    row.orders += 1;
    if (["paid", "partially_paid"].includes(String(source.financial_status || "").toLowerCase())) row.paid_orders += 1;
    const orderedRevenue = Number(source.ordered_revenue || 0);
    const currentRevenue = Number(source.current_revenue || 0);
    row.order_revenue += orderedRevenue;
    row.ordered_revenue += orderedRevenue;
    row.current_revenue += currentRevenue;
    if (source.is_shipped) row.shipped += 1;
    if (source.is_delivered) {
      row.delivered += 1;
      row.delivered_revenue += orderedRevenue;
      row.delivered_ordered_revenue += orderedRevenue;
      row.delivered_current_revenue += Number(source.delivered_current_revenue ?? currentRevenue);
    }
    if (source.is_rto) row.rto += 1;
    if (source.is_ndr) row.ndr += 1;
    if (source.hierarchy_conflict) row.conflict_orders += 1;
  }
  return [...map.values()].map((row) => ({
    ...row,
    meta_roas: row.spend > 0 ? row.meta_purchase_value / row.spend : null,
    ordered_roas: row.spend > 0 ? row.ordered_revenue / row.spend : null,
    current_shopify_roas: row.spend > 0 ? row.current_revenue / row.spend : null,
    // Legacy aliases retain their original ordered-revenue semantics.
    shopify_roas: row.spend > 0 ? row.order_revenue / row.spend : null,
    delivered_roas: row.spend > 0 ? row.delivered_revenue / row.spend : null,
    delivered_current_roas: row.spend > 0 ? row.delivered_current_revenue / row.spend : null,
    attribution_coverage: row.orders > 0 ? (row.orders - row.conflict_orders) / row.orders : null,
  })).sort((a, b) => b.spend - a.spend || b.order_revenue - a.order_revenue);
}

export async function queryProfitability(filters: JourneyFilter, level: ProfitabilityLevel) {
  const client = getSupabaseClient();
  const cohortFilters = splitCohortFilters({ ...filters, page: 1, pageSize: 1 });
  const channel = filters.channel || filters.source;
  const exactMetaFilter = !filters.attributionStatus || exactMetaStates.has(filters.attributionStatus);
  const metaApplicable = (!channel || channel === "META") && exactMetaFilter;
  const [journeyRows, metaRows] = await Promise.all([
    fetchAllJourney(cohortFilters),
    (() => {
      if (!metaApplicable) return Promise.resolve([] as Record<string, unknown>[]);
      return fetchAllMetaProfitabilityRows(async (offset, pageSize) => {
        let query = client.from("meta_ads_daily").select("id,ad_account_id,date,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,landing_page_views,purchases,purchase_value,last_synced_at");
        if (clean(filters.from)) query = query.gte("date", filters.from);
        if (clean(filters.to)) query = query.lte("date", filters.to);
        if (clean(filters.campaignId)) query = query.eq("campaign_id", filters.campaignId);
        if (clean(filters.adsetId)) query = query.eq("adset_id", filters.adsetId);
        if (clean(filters.adId)) query = query.eq("ad_id", filters.adId);
        query = query
          .order("date", { ascending: true })
          .order("ad_account_id", { ascending: true })
          .order("campaign_id", { ascending: true })
          .order("adset_id", { ascending: true })
          .order("ad_id", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        const { data, error } = await query;
        if (error) throw new Error(`Meta profitability query failed: ${error.message}`);
        return (data || []) as Record<string, unknown>[];
      });
    })(),
  ]);
  const rows = aggregateProfitability(metaRows, journeyRows, level);
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const orderRevenue = rows.reduce((sum, row) => sum + row.order_revenue, 0);
  const currentRevenue = rows.reduce((sum, row) => sum + row.current_revenue, 0);
  const deliveredRevenue = rows.reduce((sum, row) => sum + row.delivered_revenue, 0);
  const deliveredCurrentRevenue = rows.reduce((sum, row) => sum + row.delivered_current_revenue, 0);
  return {
    level,
    cohort: {
      from: filters.from || null,
      to: filters.to || null,
      date_basis: "shopify_order_created_at (order_date, Asia/Kolkata)",
    },
    meta_reporting: { from: filters.from || null, to: filters.to || null },
    rows,
    totals: {
      spend,
      impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
      clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
      landingPageViews: rows.reduce((sum, row) => sum + row.landing_page_views, 0),
      metaPurchases: rows.reduce((sum, row) => sum + row.meta_purchases, 0),
      metaPurchaseValue: rows.reduce((sum, row) => sum + row.meta_purchase_value, 0),
      orders: rows.reduce((sum, row) => sum + row.orders, 0),
      orderRevenue,
      orderedRevenue: orderRevenue,
      currentRevenue,
      delivered: rows.reduce((sum, row) => sum + row.delivered, 0),
      rto: rows.reduce((sum, row) => sum + row.rto, 0),
      ndr: rows.reduce((sum, row) => sum + row.ndr, 0),
      deliveredRevenue,
      deliveredOrderedRevenue: deliveredRevenue,
      deliveredCurrentRevenue,
      metaRoas: spend > 0 ? rows.reduce((sum, row) => sum + row.meta_purchase_value, 0) / spend : null,
      shopifyRoas: spend > 0 ? orderRevenue / spend : null,
      orderedRoas: spend > 0 ? orderRevenue / spend : null,
      currentShopifyRoas: spend > 0 ? currentRevenue / spend : null,
      deliveredRoas: spend > 0 ? deliveredRevenue / spend : null,
      deliveredCurrentRoas: spend > 0 ? deliveredCurrentRevenue / spend : null,
    },
  };
}

export async function getJourneyDetail(shopifyOrderId: string) {
  const client = getSupabaseClient();
  const [{ data: journey, error }, { data: attribution }, { data: commerce }] = await Promise.all([
    client.from("mart_order_journey_remittance").select(JOURNEY_COLUMNS).eq("shopify_order_id", shopifyOrderId).maybeSingle(),
    client.from("shopify_meta_attribution").select(ATTRIBUTION_COLUMNS).eq("shopify_order_id", shopifyOrderId).maybeSingle(),
    client.from("shopify_orders").select("shopify_order_id,current_total_price,total_discounts,cancelled_at,cancel_reason,source_name").eq("shopify_order_id", shopifyOrderId).maybeSingle(),
  ]);
  if (error) throw new Error(`Journey detail failed: ${error.message}`);
  if (!journey) return null;
  const journeyRow = journey as unknown as JourneyRow;
  const srOrderId = journeyRow.shiprocket_sr_order_id ? String(journeyRow.shiprocket_sr_order_id) : null;
  const [{ data: shipment }, { data: scans }, { data: remittances }] = srOrderId ? await Promise.all([
    client.from("shiprocket_orders").select("sr_order_id,created_at_sr,order_date,awb_assigned_date,pickup_scheduled_date,delivered_date,shipment_status,current_status,current_status_id,shipment_status_id,undelivered_reason,undelivered_reason_code,delivery_attempt_count").eq("sr_order_id", srOrderId).maybeSingle(),
    client.from("shiprocket_scans").select("scan_index,scan_date,status,sr_status,sr_status_label,activity,location").eq("sr_order_id", srOrderId).order("scan_index", { ascending: true }),
    client.from("shiprocket_remittance_orders").select("crf_id,utr,remittance_date,order_value,total_adjusted_amt,match_status,match_method,match_reason_code").eq("matched_sr_order_id", srOrderId),
  ]) : [{ data: null }, { data: [] }, { data: [] }];
  const creatives = await creativeByAd(journeyRow.resolved_ad_id ? [String(journeyRow.resolved_ad_id)] : []);
  const [row] = enrichRows([journeyRow], new Map([[shopifyOrderId, (attribution || {}) as unknown as Record<string, unknown>]]), creatives);
  const events: Array<Record<string, unknown>> = [];
  if (journeyRow.created_at_shopify) events.push({ type: "SHOPIFY_ORDER_CREATED", at: journeyRow.created_at_shopify, title: "Shopify order created" });
  if (shipment?.created_at_sr || shipment?.order_date) events.push({ type: "SHIPMENT_CREATED", at: shipment.created_at_sr || shipment.order_date, title: "Shiprocket shipment created" });
  for (const scan of scans || []) {
    if (!scan.scan_date) continue;
    events.push({ type: "SHIPMENT_SCAN", at: scan.scan_date, title: scan.sr_status_label || scan.status || scan.activity || "Shipment update", detail: scan.activity || null, location: scan.location || null });
  }
  for (const remittance of remittances || []) {
    if (!remittance.remittance_date) continue;
    events.push({ type: "REMITTANCE_RECEIVED", at: remittance.remittance_date, title: "Remittance received", crf_id: remittance.crf_id, utr: remittance.utr, amount: remittance.order_value, adjustment: remittance.total_adjusted_amt });
  }
  events.sort((a, b) => new Date(String(a.at)).valueOf() - new Date(String(b.at)).valueOf());
  return { order: { ...row, ...commerce }, attribution: attribution || null, shipment: shipment || null, remittances: remittances || [], timeline: events };
}

export async function queryJourneyFreshness() {
  const client = getSupabaseClient();
  const [meta, shopify, shiprocket, remittance] = await Promise.all([
    client.from("meta_sync_state").select("last_successful_today_sync_at,last_successful_recent_repair_at,last_backfill_completed_at").limit(20),
    client.from("shopify_sync_state").select("last_successful_sync_at").limit(20),
    client.from("shiprocket_orders").select("last_webhook_sync_at").order("last_webhook_sync_at", { ascending: false }).limit(1),
    client.from("shiprocket_remittance_imports").select("completed_at").eq("status", "completed").order("completed_at", { ascending: false }).limit(1),
  ]);
  const latest = (values: unknown[]) => values.map(String).filter((v) => v && v !== "null").sort().at(-1) || null;
  return {
    meta: latest((meta.data || []).flatMap((r) => [r.last_successful_today_sync_at, r.last_successful_recent_repair_at, r.last_backfill_completed_at])),
    shopify: latest((shopify.data || []).map((r) => r.last_successful_sync_at)),
    shiprocket: shiprocket.data?.[0]?.last_webhook_sync_at || null,
    remittance: remittance.data?.[0]?.completed_at || null,
  };
}
