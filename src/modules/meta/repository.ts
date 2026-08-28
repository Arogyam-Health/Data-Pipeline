import { getSupabaseClient } from "@/lib/supabase/admin";
import { UPSERT_BATCH_SIZE } from "./constants";
import { dailyIdentity } from "./normalizer";
import type {
  BackfillJobRow,
  BackfillStatus,
  MetaAccountRow,
  NormalizedActionRow,
  NormalizedActionValueRow,
  NormalizedDailyRow,
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

export async function getSyncState(adAccountId: string): Promise<SyncStateRow | null> {
  const { data, error } = await pipeline()
    .from("meta_sync_state")
    .select(
      "ad_account_id, last_successful_today_sync_at, last_successful_recent_repair_at, last_backfill_completed_at, last_attempted_sync_at, account_timezone, account_currency, api_version, last_warning"
    )
    .eq("ad_account_id", adAccountId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load Meta sync state: ${error.message}`);
  return (data as SyncStateRow | null) ?? null;
}

export async function upsertSyncState(
  adAccountId: string,
  patch: Partial<SyncStateRow>
): Promise<void> {
  const { error } = await pipeline().from("meta_sync_state").upsert(
    {
      ad_account_id: adAccountId,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ad_account_id" }
  );
  if (error) throw new Error(`Failed to upsert Meta sync state: ${error.message}`);
}

export async function createSyncRun(input: {
  adAccountId: string;
  mode: SyncMode;
  requestedFrom: string | null;
  requestedTo: string | null;
}): Promise<string> {
  const { data, error } = await pipeline()
    .from("meta_sync_runs")
    .insert({
      ad_account_id: input.adAccountId,
      mode: input.mode,
      status: "running",
      requested_from: input.requestedFrom,
      requested_to: input.requestedTo,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to create Meta sync run: ${error?.message}`);
  return data.id as string;
}

export async function finishSyncRun(
  runId: string,
  status: SyncStatus,
  counts: SyncRunCounts,
  errorCode?: string | null,
  errorMessage?: string | null,
  warning?: string | null
): Promise<void> {
  const { error } = await pipeline()
    .from("meta_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      rows_fetched: counts.rowsFetched,
      rows_inserted: counts.rowsInserted,
      rows_updated: counts.rowsUpdated,
      actions_upserted: counts.actionsUpserted,
      action_values_upserted: counts.actionValuesUpserted,
      api_requests: counts.apiRequests,
      pages_fetched: counts.pagesFetched,
      retry_count: counts.retryCount,
      last_error_code: errorCode ?? null,
      last_error_message: errorMessage ?? null,
      last_warning: warning ?? null,
    })
    .eq("id", runId);
  if (error) throw new Error(`Failed to finish Meta sync run: ${error.message}`);
}

export async function recordSyncError(input: {
  syncRunId: string;
  entityType: string;
  entityId?: string | null;
  operation: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  attempt?: number;
}): Promise<void> {
  await pipeline().from("meta_sync_errors").insert({
    sync_run_id: input.syncRunId,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    operation: input.operation,
    error_code: input.errorCode,
    error_message: input.errorMessage,
    retryable: input.retryable,
    attempt: input.attempt ?? 1,
  });
}

export async function getLatestSyncRun(adAccountId: string) {
  const { data, error } = await pipeline()
    .from("meta_sync_runs")
    .select(
      "id, mode, status, started_at, finished_at, rows_fetched, pages_fetched, api_requests, retry_count, last_error_code, last_error_message"
    )
    .eq("ad_account_id", adAccountId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load latest Meta sync run: ${error.message}`);
  return data;
}

export async function getActiveBackfillJob(adAccountId: string): Promise<BackfillJobRow | null> {
  const { data, error } = await pipeline()
    .from("meta_backfill_jobs")
    .select(
      "id, ad_account_id, requested_from, requested_to, chunk_days, next_chunk_start, status, last_error"
    )
    .eq("ad_account_id", adAccountId)
    .in("status", ["pending", "running", "paused"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load Meta backfill job: ${error.message}`);
  return (data as BackfillJobRow | null) ?? null;
}

export async function createBackfillJob(input: {
  adAccountId: string;
  requestedFrom: string;
  requestedTo: string;
  chunkDays: number;
  nextChunkStart: string;
}): Promise<string> {
  const { data, error } = await pipeline()
    .from("meta_backfill_jobs")
    .insert({
      ad_account_id: input.adAccountId,
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
  if (error || !data) throw new Error(`Failed to create Meta backfill job: ${error?.message}`);
  return data.id as string;
}

export async function updateBackfillJob(
  id: string,
  patch: {
    next_chunk_start?: string | null;
    status?: BackfillStatus;
    last_error?: string | null;
    finished_at?: string | null;
  }
): Promise<void> {
  const { error } = await pipeline()
    .from("meta_backfill_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to update Meta backfill job: ${error.message}`);
}

export async function upsertAccount(account: MetaAccountRow): Promise<void> {
  const { error } = await pipeline().from("meta_ad_accounts").upsert(
    {
      ...account,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ad_account_id" }
  );
  if (error) throw new Error(`Failed to upsert Meta ad account: ${error.message}`);
}

export async function getAccount(adAccountId: string): Promise<MetaAccountRow | null> {
  const { data, error } = await pipeline()
    .from("meta_ad_accounts")
    .select(
      "ad_account_id, account_name, currency, timezone_name, timezone_offset_hours, account_status, business_name"
    )
    .eq("ad_account_id", adAccountId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load Meta ad account: ${error.message}`);
  return (data as MetaAccountRow | null) ?? null;
}

export async function existingDailyKeys(
  adAccountId: string,
  rows: NormalizedDailyRow[]
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (rows.length === 0) return keys;
  const dates = [...new Set(rows.map((row) => row.date))];
  const { data, error } = await pipeline()
    .from("meta_ads_daily")
    .select("ad_account_id, date, campaign_id, adset_id, ad_id")
    .eq("ad_account_id", adAccountId)
    .in("date", dates);
  if (error) throw new Error(`Failed to load existing Meta daily keys: ${error.message}`);
  for (const row of data ?? []) {
    keys.add(
      dailyIdentity({
        ad_account_id: String(row.ad_account_id),
        date: String(row.date),
        campaign_id: String(row.campaign_id),
        adset_id: String(row.adset_id),
        ad_id: String(row.ad_id),
      })
    );
  }
  return keys;
}

export async function upsertDailyFacts(rows: NormalizedDailyRow[]): Promise<{
  inserted: number;
  updated: number;
}> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };
  const existing = await existingDailyKeys(rows[0].ad_account_id, rows);
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    if (existing.has(dailyIdentity(row))) updated += 1;
    else inserted += 1;
  }
  await upsertBatch(
    "meta_ads_daily",
    rows as unknown as Record<string, unknown>[],
    "ad_account_id,date,campaign_id,adset_id,ad_id"
  );
  return { inserted, updated };
}

export async function upsertActions(rows: NormalizedActionRow[]): Promise<number> {
  await upsertBatch(
    "meta_ads_actions_daily",
    rows as unknown as Record<string, unknown>[],
    "ad_account_id,date,campaign_id,adset_id,ad_id,action_type"
  );
  return rows.length;
}

export async function upsertActionValues(rows: NormalizedActionValueRow[]): Promise<number> {
  await upsertBatch(
    "meta_ads_action_values_daily",
    rows as unknown as Record<string, unknown>[],
    "ad_account_id,date,campaign_id,adset_id,ad_id,action_type"
  );
  return rows.length;
}

export async function upsertCampaignStubs(
  rows: Array<{
    campaign_id: string;
    ad_account_id: string;
    name?: string | null;
    objective?: string | null;
  }>
): Promise<void> {
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    unique.set(row.campaign_id, {
      campaign_id: row.campaign_id,
      ad_account_id: row.ad_account_id,
      name: row.name ?? null,
      objective: row.objective ?? null,
      updated_at: new Date().toISOString(),
    });
  }
  await upsertBatch("meta_campaigns", [...unique.values()], "campaign_id");
}

export async function upsertAdsetStubs(
  rows: Array<{
    adset_id: string;
    campaign_id: string;
    ad_account_id: string;
    name?: string | null;
  }>
): Promise<void> {
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    unique.set(row.adset_id, {
      adset_id: row.adset_id,
      campaign_id: row.campaign_id,
      ad_account_id: row.ad_account_id,
      name: row.name ?? null,
      updated_at: new Date().toISOString(),
    });
  }
  await upsertBatch("meta_adsets", [...unique.values()], "adset_id");
}

export async function upsertAdStubs(
  rows: Array<{
    ad_id: string;
    adset_id: string;
    campaign_id: string;
    ad_account_id: string;
    name?: string | null;
  }>
): Promise<void> {
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    unique.set(row.ad_id, {
      ad_id: row.ad_id,
      adset_id: row.adset_id,
      campaign_id: row.campaign_id,
      ad_account_id: row.ad_account_id,
      name: row.name ?? null,
      updated_at: new Date().toISOString(),
    });
  }
  await upsertBatch("meta_ads", [...unique.values()], "ad_id");
}

export async function upsertCampaigns(rows: Record<string, unknown>[]): Promise<void> {
  await upsertBatch("meta_campaigns", rows, "campaign_id");
}

export async function upsertAdsets(rows: Record<string, unknown>[]): Promise<void> {
  await upsertBatch("meta_adsets", rows, "adset_id");
}

export async function upsertAds(rows: Record<string, unknown>[]): Promise<void> {
  await upsertBatch("meta_ads", rows, "ad_id");
}

export async function upsertCreatives(rows: Record<string, unknown>[]): Promise<void> {
  await upsertBatch("meta_creatives", rows, "creative_id");
}

export async function upsertPlacementRows(rows: Record<string, unknown>[]): Promise<void> {
  await upsertBatch(
    "meta_ads_placement_daily",
    rows,
    "ad_account_id,date,campaign_id,adset_id,ad_id,publisher_platform,platform_position"
  );
}

export async function upsertDeviceRows(rows: Record<string, unknown>[]): Promise<void> {
  await upsertBatch(
    "meta_ads_device_daily",
    rows,
    "ad_account_id,date,campaign_id,adset_id,ad_id,impression_device"
  );
}

export async function upsertDemographicRows(rows: Record<string, unknown>[]): Promise<void> {
  await upsertBatch(
    "meta_ads_demographic_daily",
    rows,
    "ad_account_id,date,campaign_id,adset_id,ad_id,age,gender"
  );
}

export async function upsertGeoRows(rows: Record<string, unknown>[]): Promise<void> {
  await upsertBatch(
    "meta_ads_geo_daily",
    rows,
    "ad_account_id,date,campaign_id,adset_id,ad_id,country,region"
  );
}
