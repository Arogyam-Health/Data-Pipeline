import type { Ga4Dataset } from "./constants";

export type { Ga4Dataset };

export type SyncMode = "test" | "recent" | "backfill" | "repair" | "connection_test";
export type SyncStatus = "running" | "success" | "partial" | "failed";
export type BackfillStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type Ga4ErrorClass =
  | "authentication"
  | "permission"
  | "rate_limit"
  | "server"
  | "timeout"
  | "invalid_argument"
  | "invalid_dimension"
  | "invalid_metric"
  | "other";

export interface DateRange {
  since: string;
  until: string;
}

export interface Ga4DimensionValue {
  value?: string;
}

export interface Ga4MetricValue {
  value?: string;
}

export interface Ga4ReportRow {
  dimensionValues?: Ga4DimensionValue[];
  metricValues?: Ga4MetricValue[];
}

export interface Ga4ReportMetadata {
  currencyCode?: string;
  timeZone?: string;
}

export interface Ga4ReportResponse {
  dimensionHeaders?: Array<{ name?: string }>;
  metricHeaders?: Array<{ name?: string; type?: string }>;
  rows?: Ga4ReportRow[];
  rowCount?: number;
  metadata?: Ga4ReportMetadata;
}

export interface Ga4CompatibilityResponse {
  dimensionCompatibilities?: Array<{
    dimensionMetadata?: { apiName?: string; uiName?: string };
    compatibility?: string;
  }>;
  metricCompatibilities?: Array<{
    metricMetadata?: { apiName?: string; uiName?: string };
    compatibility?: string;
  }>;
}

export interface Ga4MetricSet {
  sessions: number;
  engaged_sessions: number;
  engagement_rate: number | null;
  bounce_rate: number | null;
  users: number;
  new_users: number;
  views: number;
  add_to_carts: number;
  items_added_to_cart: number;
  begin_checkout: number;
  purchases: number;
  revenue: number;
}

export interface NormalizedDailyRow extends Ga4MetricSet {
  property_id: string;
  date: string;
  last_sync_run_id?: string | null;
}

export interface NormalizedChannelRow extends NormalizedDailyRow {
  channel: string;
}

export interface NormalizedUtmRow extends NormalizedDailyRow {
  utm_key: string;
  utm_source: string;
  utm_campaign: string;
  utm_medium: string;
  utm_content: string;
}

export interface SyncRunCounts {
  baseRowsFetched: number;
  ecommerceRowsFetched: number;
  rowsUpserted: number;
  apiRequests: number;
  pagesFetched: number;
  retryCount: number;
}

export interface SyncRunResult extends SyncRunCounts {
  runId: string;
  dataset: Ga4Dataset | "connection_test";
  mode: SyncMode;
  status: SyncStatus;
  requestedFrom: string | null;
  requestedTo: string | null;
  durationMs: number;
  success: boolean;
  warning?: string | null;
  resumable?: boolean;
}

export interface RecentSyncResult {
  success: boolean;
  disabled?: boolean;
  results: SyncRunResult[];
}

export interface SyncStateRow {
  property_id: string;
  dataset: Ga4Dataset;
  last_successful_sync_at: string | null;
  last_successful_from: string | null;
  last_successful_to: string | null;
  last_backfill_completed_at: string | null;
}

export interface BackfillJobRow {
  id: string;
  property_id: string;
  dataset: Ga4Dataset;
  requested_from: string;
  requested_to: string;
  chunk_days: number;
  next_chunk_start: string | null;
  status: BackfillStatus;
  last_error_code?: string | null;
  last_error_message?: string | null;
}

export interface Ga4PropertyRow {
  property_id: string;
  display_name: string | null;
  reporting_timezone: string | null;
  currency_code: string | null;
}

export interface SubjectTokenSupplier {
  getSubjectToken: () => Promise<string>;
}

export interface ExternalAccountConfig {
  type: "external_account";
  audience: string;
  subject_token_type: string;
  token_url: string;
  service_account_impersonation_url: string;
  scopes: string[];
  subject_token_supplier: SubjectTokenSupplier;
}
