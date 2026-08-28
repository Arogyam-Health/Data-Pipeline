import { getSupabaseClient } from "@/lib/supabase/admin";
import { UPSERT_BATCH_SIZE } from "./constants";
import type {
  BackfillJobRow,
  BackfillStatus,
  Ga4Dataset,
  Ga4PropertyRow,
  NormalizedChannelRow,
  NormalizedDailyRow,
  NormalizedUtmRow,
  SyncMode,
  SyncRunCounts,
  SyncStateRow,
  SyncStatus,
} from "./types";

function pipeline() {
  return getSupabaseClient();
}

async function upsertBatch(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await pipeline().from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`Failed to upsert ${table}: ${error.message}`);
  }
}

export async function upsertProperty(row: Ga4PropertyRow & { last_verified_at?: string; last_synced_at?: string }): Promise<void> {
  const { error } = await pipeline().from("ga4_properties").upsert(
    {
      ...row,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "property_id" }
  );
  if (error) throw new Error(`Failed to upsert GA4 property: ${error.message}`);
}

export async function getProperty(propertyId: string): Promise<Ga4PropertyRow | null> {
  const { data, error } = await pipeline()
    .from("ga4_properties")
    .select("property_id, display_name, reporting_timezone, currency_code")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load GA4 property: ${error.message}`);
  return (data as Ga4PropertyRow | null) ?? null;
}

export async function getSyncState(propertyId: string, dataset: Ga4Dataset): Promise<SyncStateRow | null> {
  const { data, error } = await pipeline()
    .from("ga4_sync_state")
    .select(
      "property_id, dataset, last_successful_sync_at, last_successful_from, last_successful_to, last_backfill_completed_at"
    )
    .eq("property_id", propertyId)
    .eq("dataset", dataset)
    .maybeSingle();
  if (error) throw new Error(`Failed to load GA4 sync state: ${error.message}`);
  return (data as SyncStateRow | null) ?? null;
}

export async function upsertSyncState(row: SyncStateRow): Promise<void> {
  const { error } = await pipeline().from("ga4_sync_state").upsert(
    {
      ...row,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "property_id,dataset" }
  );
  if (error) throw new Error(`Failed to upsert GA4 sync state: ${error.message}`);
}

export async function createSyncRun(input: {
  propertyId: string;
  dataset: Ga4Dataset;
  mode: SyncMode;
  requestedFrom: string | null;
  requestedTo: string | null;
}): Promise<string> {
  const { data, error } = await pipeline()
    .from("ga4_sync_runs")
    .insert({
      property_id: input.propertyId,
      dataset: input.dataset,
      mode: input.mode,
      status: "running",
      requested_from: input.requestedFrom,
      requested_to: input.requestedTo,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to create GA4 sync run: ${error?.message}`);
  return data.id as string;
}

export async function finishSyncRun(
  runId: string,
  status: SyncStatus,
  counts: SyncRunCounts,
  errorCode?: string | null,
  errorMessage?: string | null
): Promise<void> {
  const { error } = await pipeline()
    .from("ga4_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      base_rows_fetched: counts.baseRowsFetched,
      ecommerce_rows_fetched: counts.ecommerceRowsFetched,
      rows_upserted: counts.rowsUpserted,
      api_requests: counts.apiRequests,
      pages_fetched: counts.pagesFetched,
      retry_count: counts.retryCount,
      last_error_code: errorCode ?? null,
      last_error_message: errorMessage ?? null,
    })
    .eq("id", runId);
  if (error) throw new Error(`Failed to finish GA4 sync run: ${error.message}`);
}

export async function recordSyncError(input: {
  syncRunId: string;
  dataset: Ga4Dataset;
  operation: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  attempt?: number;
}): Promise<void> {
  await pipeline().from("ga4_sync_errors").insert({
    sync_run_id: input.syncRunId,
    dataset: input.dataset,
    operation: input.operation,
    error_code: input.errorCode,
    error_message: input.errorMessage,
    retryable: input.retryable,
    attempt: input.attempt ?? null,
  });
}

export async function getLatestSyncRun(propertyId: string, dataset?: Ga4Dataset) {
  let query = pipeline()
    .from("ga4_sync_runs")
    .select(
      "id, dataset, mode, status, started_at, finished_at, base_rows_fetched, ecommerce_rows_fetched, rows_upserted, pages_fetched, api_requests, retry_count, last_error_code, last_error_message, requested_from, requested_to"
    )
    .eq("property_id", propertyId)
    .order("started_at", { ascending: false })
    .limit(1);
  if (dataset) query = query.eq("dataset", dataset);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to load latest GA4 sync run: ${error.message}`);
  return data;
}

export async function getLatestSyncRuns(propertyId: string) {
  const datasets: Ga4Dataset[] = ["daily", "channel", "utm"];
  const rows = await Promise.all(datasets.map((dataset) => getLatestSyncRun(propertyId, dataset)));
  return datasets.map((dataset, index) => ({ dataset, run: rows[index] }));
}

export async function getActiveBackfillJob(propertyId: string, dataset: Ga4Dataset): Promise<BackfillJobRow | null> {
  const { data, error } = await pipeline()
    .from("ga4_backfill_jobs")
    .select(
      "id, property_id, dataset, requested_from, requested_to, chunk_days, next_chunk_start, status, last_error_code, last_error_message"
    )
    .eq("property_id", propertyId)
    .eq("dataset", dataset)
    .in("status", ["pending", "running", "paused"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load GA4 backfill job: ${error.message}`);
  return (data as BackfillJobRow | null) ?? null;
}

export async function createBackfillJob(input: {
  propertyId: string;
  dataset: Ga4Dataset;
  requestedFrom: string;
  requestedTo: string;
  chunkDays: number;
  nextChunkStart: string;
}): Promise<string> {
  const { data, error } = await pipeline()
    .from("ga4_backfill_jobs")
    .insert({
      property_id: input.propertyId,
      dataset: input.dataset,
      requested_from: input.requestedFrom,
      requested_to: input.requestedTo,
      chunk_days: input.chunkDays,
      next_chunk_start: input.nextChunkStart,
      status: "running",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to create GA4 backfill job: ${error?.message}`);
  return data.id as string;
}

export async function updateBackfillJob(
  id: string,
  patch: {
    next_chunk_start?: string | null;
    status?: BackfillStatus;
    last_error_code?: string | null;
    last_error_message?: string | null;
    finished_at?: string | null;
  }
): Promise<void> {
  const { error } = await pipeline()
    .from("ga4_backfill_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to update GA4 backfill job: ${error.message}`);
}

export async function upsertDailyRows(rows: NormalizedDailyRow[]): Promise<number> {
  await upsertBatch(
    "ga4_daily",
    rows.map((row) => ({ ...row, last_synced_at: new Date().toISOString() })),
    "property_id,date"
  );
  return rows.length;
}

export async function upsertChannelRows(rows: NormalizedChannelRow[]): Promise<number> {
  await upsertBatch(
    "ga4_channel_daily",
    rows.map((row) => ({ ...row, last_synced_at: new Date().toISOString() })),
    "property_id,date,channel"
  );
  return rows.length;
}

export async function upsertUtmRows(rows: NormalizedUtmRow[]): Promise<number> {
  await upsertBatch(
    "ga4_utm_daily",
    rows.map((row) => ({ ...row, last_synced_at: new Date().toISOString() })),
    "property_id,date,utm_source,utm_campaign,utm_medium,utm_content"
  );
  return rows.length;
}
