import { logger } from "@/lib/logger";
import { DEFAULT_TEST_MAX_DAYS, INTEGRATION } from "./constants";
import { MetaGraphClient } from "./client";
import {
  getRecentRepairRange,
  getTodayRange,
  inclusiveDayCount,
  isValidIsoDate,
} from "./dates";
import { getMetaAdAccountId, getMetaEnv, isMetaSyncEnabled, type MetaEnv } from "./env";
import {
  MetaAuthError,
  MetaError,
  MetaSyncDisabledError,
  MetaSyncLockError,
  sanitizeMetaError,
} from "./errors";
import {
  fetchBreakdownInsights,
  fetchCoreInsights,
  fetchExtendedInsights,
  mergeInsightRows,
} from "./insights";
import { acquireMetaSyncLock, assertNoActiveBackfillConflict, releaseMetaSyncLock } from "./locking";
import { fetchAndStoreAccount, syncMetadata } from "./metadata";
import { dedupeDailyRows, normalizeInsightRow } from "./normalizer";
import {
  createSyncRun,
  finishSyncRun,
  getAccount,
  getActiveBackfillJob,
  getLatestSyncRun,
  getSyncState,
  recordSyncError,
  upsertActionValues,
  upsertActions,
  upsertAdStubs,
  upsertAdsetStubs,
  upsertCampaignStubs,
  upsertDailyFacts,
  upsertDemographicRows,
  upsertDeviceRows,
  upsertGeoRows,
  upsertPlacementRows,
  upsertSyncState,
} from "./repository";
import { mapParityActions, toNumberOrNull } from "./actions";
import { storeMetaReportDate } from "./dates";
import type {
  DateRange,
  MetaInsightRow,
  NormalizedActionRow,
  NormalizedActionValueRow,
  NormalizedDailyRow,
  SyncMode,
  SyncRunCounts,
  SyncRunResult,
  SyncStatus,
  SyncStatusSnapshot,
} from "./types";

export interface RunMetaSyncInput {
  mode: SyncMode;
  since?: string;
  until?: string;
  env?: MetaEnv;
  requireEnabled?: boolean;
  client?: MetaGraphClient;
  now?: Date;
}

const emptyCounts = (): SyncRunCounts => ({
  rowsFetched: 0,
  rowsInserted: 0,
  rowsUpdated: 0,
  actionsUpserted: 0,
  actionValuesUpserted: 0,
  apiRequests: 0,
  pagesFetched: 0,
  retryCount: 0,
});

export function assertAllowedTestRange(mode: SyncMode, range: DateRange): void {
  if (mode === "test" && inclusiveDayCount(range.since, range.until) > DEFAULT_TEST_MAX_DAYS) {
    throw new MetaError(
      `Test sync is limited to ${DEFAULT_TEST_MAX_DAYS} days`,
      "VALIDATION_ERROR",
      false
    );
  }
}

export function resolveSyncRange(input: {
  mode: SyncMode;
  since?: string;
  until?: string;
  timeZone: string;
  recentDays: number;
  now?: Date;
}): DateRange {
  if (input.since && input.until) {
    if (!isValidIsoDate(input.since) || !isValidIsoDate(input.until)) {
      throw new MetaError("Dates must use YYYY-MM-DD", "VALIDATION_ERROR", false);
    }
    if (input.since > input.until) {
      throw new MetaError("since must be on or before until", "VALIDATION_ERROR", false);
    }
    return { since: input.since, until: input.until };
  }
  if (input.mode === "today" || input.mode === "test") {
    return input.since && input.until
      ? { since: input.since, until: input.until }
      : getTodayRange(input.timeZone, input.now);
  }
  if (input.mode === "recent_repair") {
    return getRecentRepairRange(input.recentDays, input.timeZone, input.now);
  }
  throw new MetaError("since and until are required for this Meta sync mode", "VALIDATION_ERROR", false);
}

export async function runMetaSync(input: RunMetaSyncInput): Promise<SyncRunResult> {
  const env = input.env ?? getMetaEnv();
  if (input.requireEnabled !== false && !isMetaSyncEnabled(env)) {
    throw new MetaSyncDisabledError();
  }

  const adAccountId = getMetaAdAccountId(env);
  const started = Date.now();
  const activeBackfill = await getActiveBackfillJob(adAccountId);
  if (input.mode !== "backfill") {
    assertNoActiveBackfillConflict(input.mode, activeBackfill);
  }

  const lockToken = await acquireMetaSyncLock(adAccountId, input.mode);
  if (!lockToken) {
    throw new MetaSyncLockError(adAccountId);
  }

  const client = input.client ?? new MetaGraphClient({ env });
  let runId = "";
  const counts = emptyCounts();
  let warning: string | null = null;

  try {
    const storedAccount = await getAccount(adAccountId);
    let account;
    try {
      account = await fetchAndStoreAccount(client, adAccountId);
    } catch (err) {
      if (err instanceof MetaAuthError) throw err;
      account = storedAccount ?? {
        ad_account_id: adAccountId,
        account_name: null,
        currency: null,
        timezone_name: "UTC",
        timezone_offset_hours: null,
        account_status: null,
        business_name: null,
      };
      warning = sanitizeMetaError(
        `Account metadata refresh failed; using stored timezone. ${err instanceof Error ? err.message : ""}`
      );
    }

    const timeZone = account.timezone_name || storedAccount?.timezone_name || "UTC";
    await upsertSyncState(adAccountId, {
      ad_account_id: adAccountId,
      last_attempted_sync_at: new Date().toISOString(),
      account_timezone: timeZone,
      account_currency: account.currency,
      api_version: env.META_API_VERSION,
    });

    if (input.mode === "metadata") {
      runId = await createSyncRun({
        adAccountId,
        mode: "metadata",
        requestedFrom: null,
        requestedTo: null,
      });
      const meta = await syncMetadata(client, adAccountId);
      counts.rowsFetched = meta.campaigns + meta.adsets + meta.ads;
      counts.rowsInserted = meta.creatives;
      counts.apiRequests = client.apiRequests;
      counts.pagesFetched = client.pagesFetched;
      counts.retryCount = client.retryCount;
      await finishSyncRun(runId, "success", counts, null, null, warning);
      return buildResult(runId, input.mode, "success", counts, null, null, warning, started);
    }

    const range = resolveSyncRange({
      mode: input.mode,
      since: input.since,
      until: input.until,
      timeZone,
      recentDays: env.META_RECENT_REPAIR_DAYS,
      now: input.now,
    });

    assertAllowedTestRange(input.mode, range);
    if (input.mode === "repair" && inclusiveDayCount(range.since, range.until) > env.META_BACKFILL_DAYS) {
      throw new MetaError(
        `Repair range exceeds META_BACKFILL_DAYS (${env.META_BACKFILL_DAYS})`,
        "VALIDATION_ERROR",
        false
      );
    }

    runId = await createSyncRun({
      adAccountId,
      mode: input.mode,
      requestedFrom: range.since,
      requestedTo: range.until,
    });

    if (input.mode === "breakdown") {
      warning = await runBreakdowns(client, range, adAccountId, runId, counts, env);
      counts.apiRequests = client.apiRequests;
      counts.pagesFetched = client.pagesFetched;
      counts.retryCount = client.retryCount;
      await finishSyncRun(runId, warning ? "partial" : "success", counts, null, null, warning);
      return buildResult(
        runId,
        input.mode,
        warning ? "partial" : "success",
        counts,
        range.since,
        range.until,
        warning,
        started
      );
    }

    const coreRows = await fetchCoreInsights(client, range, adAccountId);
    counts.rowsFetched = coreRows.length;

    let merged = coreRows;
    if (env.META_EXTENDED_INSIGHTS_ENABLED) {
      try {
        const extra = await fetchExtendedInsights(client, range, adAccountId, true);
        merged = mergeInsightRows(coreRows, extra.rows);
        warning = joinWarnings(warning, extra.warning);
      } catch (err) {
        warning = joinWarnings(
          warning,
          `Extended insights skipped; core parity succeeded. ${sanitizeMetaError(err instanceof Error ? err.message : "extended failed")}`
        );
        logger.warn("Meta extended insights failed; core sync continues", {
          provider: INTEGRATION,
          run_id: runId,
        });
      }
    }

    const daily: NormalizedDailyRow[] = [];
    const actions: NormalizedActionRow[] = [];
    const actionValues: NormalizedActionValueRow[] = [];
    for (const row of merged) {
      const bundle = normalizeInsightRow(row, { adAccountId, syncRunId: runId });
      if (!bundle) continue;
      daily.push(bundle.daily);
      actions.push(...bundle.actions);
      actionValues.push(...bundle.actionValues);
    }

    const uniqueDaily = dedupeDailyRows(daily);
    if (uniqueDaily.length > 0) {
      await upsertCampaignStubs(
        uniqueDaily.map((row) => ({
          campaign_id: row.campaign_id,
          ad_account_id: adAccountId,
          name: row.campaign_name,
          objective: row.objective,
        }))
      );
      await upsertAdsetStubs(
        uniqueDaily.map((row) => ({
          adset_id: row.adset_id,
          campaign_id: row.campaign_id,
          ad_account_id: adAccountId,
          name: row.adset_name,
        }))
      );
      await upsertAdStubs(
        uniqueDaily.map((row) => ({
          ad_id: row.ad_id,
          adset_id: row.adset_id,
          campaign_id: row.campaign_id,
          ad_account_id: adAccountId,
          name: row.ad_name,
        }))
      );
    }

    const factCounts = await upsertDailyFacts(uniqueDaily);
    counts.rowsInserted = factCounts.inserted;
    counts.rowsUpdated = factCounts.updated;
    counts.actionsUpserted = await upsertActions(actions);
    counts.actionValuesUpserted = await upsertActionValues(actionValues);

    if (env.META_BREAKDOWN_SYNC_ENABLED && input.mode !== "test") {
      try {
        const breakdownWarning = await runBreakdowns(client, range, adAccountId, runId, counts, env);
        warning = joinWarnings(warning, breakdownWarning);
      } catch (err) {
        warning = joinWarnings(
          warning,
          `Breakdown sync skipped; core parity succeeded. ${sanitizeMetaError(err instanceof Error ? err.message : "breakdown failed")}`
        );
      }
    }

    counts.apiRequests = client.apiRequests;
    counts.pagesFetched = client.pagesFetched;
    counts.retryCount = client.retryCount;

    const status: SyncStatus = warning ? "partial" : "success";
    await finishSyncRun(runId, status, counts, null, null, warning);

    const watermarkPatch: Parameters<typeof upsertSyncState>[1] = {
      ad_account_id: adAccountId,
      account_timezone: timeZone,
      account_currency: account.currency,
      api_version: env.META_API_VERSION,
      last_warning: warning,
    };
    if (input.mode === "today") {
      watermarkPatch.last_successful_today_sync_at = new Date().toISOString();
    }
    if (input.mode === "recent_repair") {
      watermarkPatch.last_successful_recent_repair_at = new Date().toISOString();
    }
    if (input.mode === "backfill") {
      const job = await getActiveBackfillJob(adAccountId);
      if (job && job.next_chunk_start && addCalendarSafe(range.until, 1) > job.requested_to) {
        watermarkPatch.last_backfill_completed_at = new Date().toISOString();
      }
    }
    await upsertSyncState(adAccountId, watermarkPatch);

    logger.info("Meta sync finished", {
      provider: INTEGRATION,
      run_id: runId,
      mode: input.mode,
      since: range.since,
      until: range.until,
      rows_fetched: counts.rowsFetched,
      pages_fetched: counts.pagesFetched,
      api_requests: counts.apiRequests,
      retry_count: counts.retryCount,
      duration_ms: Date.now() - started,
    });

    return buildResult(runId, input.mode, status, counts, range.since, range.until, warning, started);
  } catch (err) {
    const metaErr = err instanceof MetaError ? err : null;
    const message = sanitizeMetaError(err instanceof Error ? err.message : "Meta sync failed");
    const code = metaErr?.code ?? "SYNC_FAILED";
    if (runId) {
      counts.apiRequests = client.apiRequests;
      counts.pagesFetched = client.pagesFetched;
      counts.retryCount = client.retryCount;
      await finishSyncRun(runId, "failed", counts, code, message, warning);
      await recordSyncError({
        syncRunId: runId,
        entityType: "insights",
        operation: input.mode,
        errorCode: code,
        errorMessage: message,
        retryable: metaErr?.retryable ?? false,
      });
    }
    logger.error("Meta sync failed", {
      provider: INTEGRATION,
      run_id: runId || undefined,
      mode: input.mode,
      error_code: code,
    });
    throw err;
  } finally {
    await releaseMetaSyncLock(adAccountId, lockToken);
  }
}

async function runBreakdowns(
  client: MetaGraphClient,
  range: DateRange,
  adAccountId: string,
  runId: string,
  counts: SyncRunCounts,
  env: MetaEnv
): Promise<string | null> {
  if (!env.META_BREAKDOWN_SYNC_ENABLED) {
    return "Breakdown sync not enabled";
  }

  const warnings: string[] = [];
  const placement = await fetchBreakdownInsights(
    client,
    range,
    adAccountId,
    ["publisher_platform", "platform_position"],
    true
  );
  warnings.push(...compact([placement.warning]));
  await upsertPlacementRows(
    placement.rows
      .map((row) => breakdownFact(row, adAccountId, runId))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row) => ({
        ...row,
        publisher_platform: String((row as { publisher_platform?: string }).publisher_platform ?? "unknown"),
        platform_position: String((row as { platform_position?: string }).platform_position ?? "unknown"),
      }))
  );

  const device = await fetchBreakdownInsights(client, range, adAccountId, ["impression_device"], false);
  warnings.push(...compact([device.warning]));
  await upsertDeviceRows(
    device.rows
      .map((row) => breakdownFact(row, adAccountId, runId))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row) => ({
        ...row,
        impression_device: String((row as { impression_device?: string }).impression_device ?? "unknown"),
      }))
  );

  const demo = await fetchBreakdownInsights(client, range, adAccountId, ["age", "gender"], false);
  warnings.push(...compact([demo.warning]));
  await upsertDemographicRows(
    demo.rows
      .map((row) => breakdownFact(row, adAccountId, runId))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row) => ({
        ...row,
        age: String((row as { age?: string }).age ?? "unknown"),
        gender: String((row as { gender?: string }).gender ?? "unknown"),
      }))
  );

  const geo = await fetchBreakdownInsights(client, range, adAccountId, ["country"], false);
  warnings.push(...compact([geo.warning]));
  await upsertGeoRows(
    geo.rows
      .map((row) => breakdownFact(row, adAccountId, runId))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row) => ({
        ...row,
        country: String((row as { country?: string }).country ?? "unknown"),
        region: (row as { region?: string }).region ?? "",
      }))
  );

  counts.rowsFetched +=
    placement.rows.length + device.rows.length + demo.rows.length + geo.rows.length;
  return warnings.length > 0 ? warnings.join("; ") : null;
}

function breakdownFact(
  row: MetaInsightRow,
  adAccountId: string,
  runId: string
): Record<string, unknown> | null {
  const date = storeMetaReportDate(row.date_start);
  if (!date || !row.campaign_id || !row.adset_id || !row.ad_id) return null;
  const mapped = mapParityActions(row);
  return {
    ad_account_id: adAccountId,
    date,
    campaign_id: row.campaign_id,
    adset_id: row.adset_id,
    ad_id: row.ad_id,
    publisher_platform: row.publisher_platform,
    platform_position: row.platform_position,
    impression_device: row.impression_device,
    age: row.age,
    gender: row.gender,
    country: row.country,
    region: row.region ?? "",
    spend: toNumberOrNull(row.spend),
    impressions: toNumberOrNull(row.impressions),
    reach: toNumberOrNull(row.reach),
    clicks: toNumberOrNull(row.clicks),
    link_clicks: toNumberOrNull(row.inline_link_clicks),
    purchases: mapped.purchases,
    purchase_value: mapped.purchaseValue,
    last_synced_at: new Date().toISOString(),
    last_sync_run_id: runId,
    updated_at: new Date().toISOString(),
  };
}

export async function getSyncStatus(env?: MetaEnv): Promise<SyncStatusSnapshot> {
  const resolved = env ?? getMetaEnv();
  const adAccountId = resolved.META_AD_ACCOUNT_ID;
  const [state, latest, backfill, account] = await Promise.all([
    getSyncState(adAccountId),
    getLatestSyncRun(adAccountId),
    getActiveBackfillJob(adAccountId),
    getAccount(adAccountId),
  ]);
  return { state, latest, backfill, account };
}

function buildResult(
  runId: string,
  mode: SyncMode,
  status: SyncStatus,
  counts: SyncRunCounts,
  requestedFrom: string | null,
  requestedTo: string | null,
  warning: string | null,
  started: number
): SyncRunResult {
  return {
    success: status === "success" || status === "partial",
    runId,
    mode,
    status,
    requestedFrom,
    requestedTo,
    durationMs: Date.now() - started,
    warning,
    ...counts,
  };
}

function joinWarnings(current: string | null, next: string | null): string | null {
  return [current, next].filter(Boolean).join("; ") || null;
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value != null && value !== "");
}

function addCalendarSafe(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
