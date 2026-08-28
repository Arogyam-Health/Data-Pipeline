export const INTEGRATION = "meta" as const;

export const DEFAULT_API_VERSION = "v23.0";
export const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com";
export const DEFAULT_PAGE_LIMIT = 500;
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_BACKFILL_DAYS = 90;
export const DEFAULT_BACKFILL_CHUNK_DAYS = 3;
export const DEFAULT_RECENT_REPAIR_DAYS = 2;
export const DEFAULT_TEST_MAX_DAYS = 3;
export const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
export const SCHEDULER_STARTUP_DELAY_MS = 20_000;
export const RECENT_REPAIR_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const SYNC_LOCK_TTL_SECONDS = 15 * 60;
export const PAGE_SLEEP_MS = 300;
export const MAX_PAGING_PAGES = 500;
export const UPSERT_BATCH_SIZE = 200;
export const DASHBOARD_MAX_PAGE_SIZE = 100;

/** Apps Script retry: 3s, 6s, 12s, 24s, 48s */
export const RETRY_BACKOFF_MS = [3000, 6000, 12000, 24000, 48000] as const;

export const CORE_FIELDS = [
  "date_start",
  "date_stop",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "objective",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "inline_link_click_ctr",
  "ctr",
  "cpc",
  "cpm",
  "cost_per_inline_link_click",
  "actions",
  "action_values",
  "purchase_roas",
  "website_purchase_roas",
  "video_avg_time_watched_actions",
  "video_p25_watched_actions",
  "video_p95_watched_actions",
] as const;

export const VIDEO_EXTENDED_FIELDS = [
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
  "video_play_actions",
  "video_thruplay_watched_actions",
  "cost_per_thruplay",
  "video_30_sec_watched_actions",
] as const;

export const QUALITY_FIELDS = [
  "quality_ranking",
  "engagement_rate_ranking",
  "conversion_rate_ranking",
] as const;

export const CLICK_EXTENDED_FIELDS = [
  "unique_clicks",
  "unique_ctr",
  "cost_per_unique_click",
  "outbound_clicks",
  "outbound_clicks_ctr",
  "unique_outbound_clicks",
  "unique_outbound_clicks_ctr",
] as const;

export const ENGAGEMENT_FIELDS = ["post_engagement", "page_engagement"] as const;

export const BREAKDOWN_CORE_FIELDS = [
  "date_start",
  "campaign_id",
  "adset_id",
  "ad_id",
  "spend",
  "impressions",
  "clicks",
  "inline_link_clicks",
  "actions",
  "action_values",
] as const;

export const BREAKDOWN_REACH_FIELDS = ["reach"] as const;

export const ACCOUNT_FIELDS = [
  "name",
  "account_id",
  "currency",
  "timezone_name",
  "timezone_offset_hours_utc",
  "account_status",
  "business_name",
] as const;

export const CAMPAIGN_FIELDS = [
  "id",
  "name",
  "objective",
  "status",
  "effective_status",
  "buying_type",
  "special_ad_categories",
  "start_time",
  "stop_time",
  "created_time",
  "updated_time",
  "daily_budget",
  "lifetime_budget",
] as const;

export const ADSET_FIELDS = [
  "id",
  "name",
  "campaign_id",
  "status",
  "effective_status",
  "optimization_goal",
  "billing_event",
  "bid_strategy",
  "daily_budget",
  "lifetime_budget",
  "start_time",
  "end_time",
] as const;

export const AD_FIELDS = [
  "id",
  "name",
  "adset_id",
  "campaign_id",
  "status",
  "effective_status",
  "creative{id,name,title,body,call_to_action_type,thumbnail_url,image_url,video_id,instagram_actor_id,url_tags}",
  "created_time",
  "updated_time",
] as const;

export const PURCHASE_ACTION_TYPES = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
] as const;

export const WEBSITE_PURCHASE_ACTION_TYPES = [
  "offsite_conversion.fb_pixel_purchase",
] as const;

export const ADD_TO_CART_ACTION_TYPES = [
  "add_to_cart",
  "omni_add_to_cart",
  "offsite_conversion.fb_pixel_add_to_cart",
] as const;

export const CHECKOUT_ACTION_TYPES = [
  "initiate_checkout",
  "omni_initiated_checkout",
  "offsite_conversion.fb_pixel_initiate_checkout",
] as const;

export const LANDING_PAGE_VIEW_ACTION_TYPES = ["landing_page_view"] as const;

export const MESSAGING_ACTION_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "onsite_conversion.messaging_conversation_started",
  "messaging_conversation_started",
] as const;

export const REGISTRATION_ACTION_TYPES = [
  "complete_registration",
  "omni_complete_registration",
  "offsite_conversion.fb_pixel_complete_registration",
] as const;

export const INSTANT_EXPERIENCE_ACTION_TYPES = [
  "instant_experience_view_percentage",
] as const;

export const FIELD_GROUPS = {
  core: CORE_FIELDS,
  video: VIDEO_EXTENDED_FIELDS,
  quality: QUALITY_FIELDS,
  clicks: CLICK_EXTENDED_FIELDS,
  engagement: ENGAGEMENT_FIELDS,
} as const;

export type FieldGroupName = keyof typeof FIELD_GROUPS;
