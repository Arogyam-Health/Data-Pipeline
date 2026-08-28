export type SyncMode =
  | "test"
  | "today"
  | "recent_repair"
  | "backfill"
  | "repair"
  | "metadata"
  | "breakdown";

export type SyncStatus = "running" | "success" | "partial" | "failed";

export type BackfillStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type MetaErrorClass =
  | "authentication"
  | "permission"
  | "rate_limit"
  | "server"
  | "network"
  | "invalid_field"
  | "invalid_parameter"
  | "other";

export interface MetaAction {
  action_type?: string;
  value?: string | number;
}

export interface MetaInsightRow {
  date_start?: string;
  date_stop?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  objective?: string;
  spend?: string | number;
  impressions?: string | number;
  reach?: string | number;
  frequency?: string | number;
  clicks?: string | number;
  inline_link_clicks?: string | number;
  inline_link_click_ctr?: string | number;
  ctr?: string | number;
  cpc?: string | number;
  cpm?: string | number;
  cost_per_inline_link_click?: string | number;
  actions?: MetaAction[];
  action_values?: MetaAction[];
  purchase_roas?: MetaAction[];
  website_purchase_roas?: MetaAction[];
  video_avg_time_watched_actions?: MetaAction[];
  video_p25_watched_actions?: MetaAction[];
  video_p50_watched_actions?: MetaAction[];
  video_p75_watched_actions?: MetaAction[];
  video_p95_watched_actions?: MetaAction[];
  video_p100_watched_actions?: MetaAction[];
  video_play_actions?: MetaAction[];
  video_thruplay_watched_actions?: MetaAction[];
  video_30_sec_watched_actions?: MetaAction[];
  cost_per_thruplay?: string | number | MetaAction[];
  unique_clicks?: string | number;
  unique_ctr?: string | number;
  cost_per_unique_click?: string | number;
  outbound_clicks?: string | number | MetaAction[];
  outbound_clicks_ctr?: string | number | MetaAction[];
  unique_outbound_clicks?: string | number | MetaAction[];
  unique_outbound_clicks_ctr?: string | number | MetaAction[];
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
  post_engagement?: string | number;
  page_engagement?: string | number;
  publisher_platform?: string;
  platform_position?: string;
  impression_device?: string;
  age?: string;
  gender?: string;
  country?: string;
  region?: string;
}

export interface MetaPaging {
  next?: string;
  previous?: string;
  cursors?: { before?: string; after?: string };
}

export interface MetaGraphResponse<T> {
  data?: T[];
  paging?: MetaPaging;
  error?: MetaGraphErrorBody;
}

export interface MetaGraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
}

export interface DateRange {
  since: string;
  until: string;
}

export interface NormalizedDailyRow {
  ad_account_id: string;
  date: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  objective: string | null;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  inline_link_clicks: number | null;
  inline_link_click_ctr: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cost_per_inline_link_click: number | null;
  landing_page_views: number | null;
  adds_to_cart: number | null;
  checkouts_initiated: number | null;
  checkouts_initiated_value: number | null;
  purchases: number | null;
  purchase_value: number | null;
  website_purchases: number | null;
  messaging_conversations_started: number | null;
  registrations_completed: number | null;
  purchase_roas: number | null;
  website_purchase_roas: number | null;
  instant_experience_view_percentage: number | null;
  video_avg_play_time: number | null;
  video_plays_25: number | null;
  video_plays_50: number | null;
  video_plays_75: number | null;
  video_plays_95: number | null;
  video_plays_100: number | null;
  video_plays: number | null;
  thruplays: number | null;
  cost_per_thruplay: number | null;
  unique_clicks: number | null;
  unique_ctr: number | null;
  cost_per_unique_click: number | null;
  outbound_clicks: number | null;
  outbound_clicks_ctr: number | null;
  unique_outbound_clicks: number | null;
  unique_outbound_clicks_ctr: number | null;
  quality_ranking: string | null;
  engagement_rate_ranking: string | null;
  conversion_rate_ranking: string | null;
  post_engagement: number | null;
  page_engagement: number | null;
  last_synced_at: string;
  last_sync_run_id: string;
}

export interface NormalizedActionRow {
  ad_account_id: string;
  date: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  action_type: string;
  value: number | null;
  last_synced_at: string;
  sync_run_id: string;
}

export interface NormalizedActionValueRow {
  ad_account_id: string;
  date: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  action_type: string;
  conversion_value: number | null;
  last_synced_at: string;
  sync_run_id: string;
}

export interface NormalizedInsightBundle {
  daily: NormalizedDailyRow;
  actions: NormalizedActionRow[];
  actionValues: NormalizedActionValueRow[];
}

export interface SyncRunCounts {
  rowsFetched: number;
  rowsInserted: number;
  rowsUpdated: number;
  actionsUpserted: number;
  actionValuesUpserted: number;
  apiRequests: number;
  pagesFetched: number;
  retryCount: number;
}

export interface SyncRunResult extends SyncRunCounts {
  success: boolean;
  runId: string;
  mode: SyncMode;
  status: SyncStatus;
  requestedFrom: string | null;
  requestedTo: string | null;
  durationMs: number;
  warning: string | null;
  resumable?: boolean;
}

export interface SyncStateRow {
  ad_account_id: string;
  last_successful_today_sync_at: string | null;
  last_successful_recent_repair_at: string | null;
  last_backfill_completed_at: string | null;
  last_attempted_sync_at: string | null;
  account_timezone: string | null;
  account_currency: string | null;
  api_version: string | null;
  last_warning: string | null;
}

export interface BackfillJobRow {
  id: string;
  ad_account_id: string;
  requested_from: string;
  requested_to: string;
  chunk_days: number;
  next_chunk_start: string | null;
  status: BackfillStatus;
  last_error: string | null;
}

export interface MetaAccountRow {
  ad_account_id: string;
  account_name: string | null;
  currency: string | null;
  timezone_name: string | null;
  timezone_offset_hours: number | null;
  account_status: string | null;
  business_name: string | null;
}

export interface MetaCampaignNode {
  id?: string;
  name?: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  buying_type?: string;
  special_ad_categories?: string[];
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export interface MetaAdsetNode {
  id?: string;
  name?: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
}

export interface MetaCreativeNode {
  id?: string;
  name?: string;
  title?: string;
  body?: string;
  call_to_action_type?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  instagram_actor_id?: string;
  url_tags?: string;
}

export interface MetaAdNode {
  id?: string;
  name?: string;
  adset_id?: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  creative?: MetaCreativeNode;
  created_time?: string;
  updated_time?: string;
}

export interface SyncStatusSnapshot {
  state: SyncStateRow | null;
  latest: {
    id: string;
    mode: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    rows_fetched: number;
    pages_fetched: number;
    api_requests: number;
    retry_count: number;
    last_error_code: string | null;
    last_error_message: string | null;
  } | null;
  backfill: BackfillJobRow | null;
  account: MetaAccountRow | null;
}
