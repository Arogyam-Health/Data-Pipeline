export const INTEGRATION = "ga4" as const;

export const AUTH_MODE = "vercel-oidc-wif" as const;

export const DATASETS = ["daily", "channel", "utm"] as const;
export type Ga4Dataset = (typeof DATASETS)[number];

export const NOT_SET = "(not set)";

export const GA4_DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";
export const GOOGLE_STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";
export const GA4_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";

export const DEFAULT_DAILY_BACKFILL_DAYS = 90;
export const DEFAULT_DAILY_BACKFILL_CHUNK_DAYS = 3;
export const DEFAULT_CHANNEL_BACKFILL_DAYS = 90;
export const DEFAULT_CHANNEL_BACKFILL_CHUNK_DAYS = 3;
export const DEFAULT_UTM_BACKFILL_START_DATE = "2025-10-14";
export const DEFAULT_UTM_BACKFILL_CHUNK_DAYS = 30;
export const DEFAULT_RECENT_DAYS_BACK = 2;
export const DEFAULT_API_PAGE_LIMIT = 250000;
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_BASE_RETRY_MS = 3000;
export const DEFAULT_TEST_MAX_DAYS = 3;
export const DEFAULT_REPAIR_MAX_DAYS = 31;
export const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
export const SCHEDULER_STARTUP_DELAY_MS = 20_000;
export const SYNC_LOCK_TTL_SECONDS = 15 * 60;
export const MAX_PAGING_PAGES = 50;
export const UPSERT_BATCH_SIZE = 200;
export const DASHBOARD_MAX_PAGE_SIZE = 100;

/** Apps Script retry: 3s, 6s, 12s, 24s, 48s */
export const RETRY_BACKOFF_MS = [3000, 6000, 12000, 24000, 48000] as const;

export const BASE_METRICS = [
  "sessions",
  "engagedSessions",
  "engagementRate",
  "bounceRate",
  "totalUsers",
  "newUsers",
  "screenPageViews",
  "ecommercePurchases",
  "totalRevenue",
] as const;

export const ECOMMERCE_METRICS = ["addToCarts", "itemsAddedToCart", "checkouts"] as const;

export const DAILY_DIMENSIONS = ["date"] as const;
export const CHANNEL_DIMENSIONS = ["date", "sessionDefaultChannelGroup"] as const;
export const UTM_DIMENSIONS = [
  "date",
  "sessionManualSource",
  "sessionManualCampaignName",
  "sessionManualMedium",
  "sessionManualAdContent",
] as const;

export const FORBIDDEN_PRIVATE_KEY_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
] as const;
