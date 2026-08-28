import {
  firstActionValue,
  firstRoasValue,
  mapParityActions,
  normalizeAllActions,
  toBigIntOrNull,
  toNumberOrNull,
} from "./actions";
import { storeMetaReportDate } from "./dates";
import type {
  MetaInsightRow,
  NormalizedActionRow,
  NormalizedActionValueRow,
  NormalizedDailyRow,
  NormalizedInsightBundle,
} from "./types";

export function dailyIdentity(row: {
  ad_account_id: string;
  date: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
}): string {
  return [row.ad_account_id, row.date, row.campaign_id, row.adset_id, row.ad_id].join("|");
}

export function normalizeInsightRow(
  row: MetaInsightRow,
  input: { adAccountId: string; syncRunId: string; syncedAt?: string }
): NormalizedInsightBundle | null {
  const date = storeMetaReportDate(row.date_start);
  const campaignId = String(row.campaign_id ?? "").trim();
  const adsetId = String(row.adset_id ?? "").trim();
  const adId = String(row.ad_id ?? "").trim();
  if (!date || !campaignId || !adsetId || !adId) return null;

  const mapped = mapParityActions(row);
  const syncedAt = input.syncedAt ?? new Date().toISOString();

  const daily: NormalizedDailyRow = {
    ad_account_id: input.adAccountId,
    date,
    campaign_id: campaignId,
    campaign_name: row.campaign_name ?? null,
    adset_id: adsetId,
    adset_name: row.adset_name ?? null,
    ad_id: adId,
    ad_name: row.ad_name ?? null,
    objective: row.objective ?? null,
    spend: toNumberOrNull(row.spend),
    impressions: toBigIntOrNull(row.impressions),
    reach: toBigIntOrNull(row.reach),
    frequency: toNumberOrNull(row.frequency),
    clicks: toBigIntOrNull(row.clicks),
    inline_link_clicks: toBigIntOrNull(row.inline_link_clicks),
    inline_link_click_ctr: toNumberOrNull(row.inline_link_click_ctr),
    ctr: toNumberOrNull(row.ctr),
    cpc: toNumberOrNull(row.cpc),
    cpm: toNumberOrNull(row.cpm),
    cost_per_inline_link_click: toNumberOrNull(row.cost_per_inline_link_click ?? row.cpc),
    landing_page_views: mapped.landingPageViews,
    adds_to_cart: mapped.addsToCart,
    checkouts_initiated: mapped.checkoutsInitiated,
    checkouts_initiated_value: mapped.checkoutsInitiatedValue,
    purchases: mapped.purchases,
    purchase_value: mapped.purchaseValue,
    website_purchases: mapped.websitePurchases,
    messaging_conversations_started: mapped.messagingConversationsStarted,
    registrations_completed: mapped.registrationsCompleted,
    purchase_roas: firstRoasValue(row.purchase_roas),
    website_purchase_roas: firstRoasValue(row.website_purchase_roas),
    instant_experience_view_percentage: mapped.instantExperienceViewPercentage,
    video_avg_play_time: firstActionValue(row.video_avg_time_watched_actions),
    video_plays_25: firstActionValue(row.video_p25_watched_actions),
    video_plays_50: firstActionValue(row.video_p50_watched_actions),
    video_plays_75: firstActionValue(row.video_p75_watched_actions),
    video_plays_95: firstActionValue(row.video_p95_watched_actions),
    video_plays_100: firstActionValue(row.video_p100_watched_actions),
    video_plays: firstActionValue(row.video_play_actions),
    thruplays: firstActionValue(row.video_thruplay_watched_actions),
    cost_per_thruplay: toNumberOrNull(row.cost_per_thruplay),
    unique_clicks: toBigIntOrNull(row.unique_clicks),
    unique_ctr: toNumberOrNull(row.unique_ctr),
    cost_per_unique_click: toNumberOrNull(row.cost_per_unique_click),
    outbound_clicks: toNumberOrNull(row.outbound_clicks),
    outbound_clicks_ctr: toNumberOrNull(row.outbound_clicks_ctr),
    unique_outbound_clicks: toNumberOrNull(row.unique_outbound_clicks),
    unique_outbound_clicks_ctr: toNumberOrNull(row.unique_outbound_clicks_ctr),
    quality_ranking: row.quality_ranking ?? null,
    engagement_rate_ranking: row.engagement_rate_ranking ?? null,
    conversion_rate_ranking: row.conversion_rate_ranking ?? null,
    post_engagement: toNumberOrNull(row.post_engagement),
    page_engagement: toNumberOrNull(row.page_engagement),
    last_synced_at: syncedAt,
    last_sync_run_id: input.syncRunId,
  };

  const actions: NormalizedActionRow[] = normalizeAllActions(row.actions).map((action) => ({
    ad_account_id: input.adAccountId,
    date,
    campaign_id: campaignId,
    adset_id: adsetId,
    ad_id: adId,
    action_type: action.action_type,
    value: action.value,
    last_synced_at: syncedAt,
    sync_run_id: input.syncRunId,
  }));

  const actionValues: NormalizedActionValueRow[] = normalizeAllActions(row.action_values).map(
    (action) => ({
      ad_account_id: input.adAccountId,
      date,
      campaign_id: campaignId,
      adset_id: adsetId,
      ad_id: adId,
      action_type: action.action_type,
      conversion_value: action.value,
      last_synced_at: syncedAt,
      sync_run_id: input.syncRunId,
    })
  );

  return { daily, actions, actionValues };
}

export function persistableInsightBundle(bundle: NormalizedInsightBundle): Record<string, unknown> {
  const raw = bundle.daily as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !["raw", "payload", "response", "actions", "action_values"].includes(key))
  );
}

export function dedupeDailyRows(rows: NormalizedDailyRow[]): NormalizedDailyRow[] {
  const map = new Map<string, NormalizedDailyRow>();
  for (const row of rows) {
    map.set(dailyIdentity(row), row);
  }
  return [...map.values()];
}
