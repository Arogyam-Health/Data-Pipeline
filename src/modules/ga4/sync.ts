import { logger } from "@/lib/logger";
import { getAuthMode } from "./auth";
import { channelReportSpec, normalizeChannelRows } from "./channel";
import { Ga4DataClient } from "./client";
import {
  DATASETS,
  DEFAULT_REPAIR_MAX_DAYS,
  DEFAULT_TEST_MAX_DAYS,
  INTEGRATION,
} from "./constants";
import { dailyReportSpec, normalizeDailyRows } from "./daily";
import { getRecentRange, inclusiveDayCount, isValidIanaTimeZone, isValidIsoDate } from "./dates";
import { getGa4Env, getGa4PropertyId, isGa4SyncEnabled, type Ga4Env } from "./env";
import {
  Ga4ConfigError,
  Ga4Error,
  Ga4SyncDisabledError,
  Ga4SyncLockError,
  sanitizeGa4Error,
} from "./errors";
import { acquireGa4SyncLock, assertNoActiveBackfillConflict, releaseGa4SyncLock } from "./locking";
import {
  createSyncRun,
  finishSyncRun,
  getActiveBackfillJob,
  getLatestSyncRuns,
  getProperty,
  getSyncState,
  recordSyncError,
  upsertChannelRows,
  upsertDailyRows,
  upsertProperty,
  upsertSyncState,
  upsertUtmRows,
} from "./repository";
import { normalizeUtmRows, utmReportSpec } from "./utm";
import type {
  DateRange,
  Ga4CompatibilityResponse,
  Ga4Dataset,
  Ga4ReportMetadata,
  Ga4ReportResponse,
  SyncMode,
  SyncRunCounts,
  SyncRunResult,
  SyncStatus,
} from "./types";

export interface RunGa4SyncInput {
  dataset: Ga4Dataset;
  mode: SyncMode;
  since?: string;
  until?: string;
  env?: Ga4Env;
  requireEnabled?: boolean;
  client?: Ga4DataClient;
  now?: Date;
  timeZone?: string;
}

const emptyCounts = (): SyncRunCounts => ({
  baseRowsFetched: 0,
  ecommerceRowsFetched: 0,
  rowsUpserted: 0,
  apiRequests: 0,
  pagesFetched: 0,
  retryCount: 0,
});

export function assertAllowedRange(mode: SyncMode, range: DateRange): void {
  const days = inclusiveDayCount(range.since, range.until);
  if (mode === "test" && days > DEFAULT_TEST_MAX_DAYS) {
    throw new Ga4Error(`Test sync is limited to ${DEFAULT_TEST_MAX_DAYS} calendar days`, "VALIDATION_ERROR", false);
  }
  if (mode === "repair" && days > DEFAULT_REPAIR_MAX_DAYS) {
    throw new Ga4Error(`Repair sync is limited to ${DEFAULT_REPAIR_MAX_DAYS} calendar days`, "VALIDATION_ERROR", false);
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
      throw new Ga4Error("Dates must use YYYY-MM-DD", "VALIDATION_ERROR", false);
    }
    if (input.since > input.until) {
      throw new Ga4Error("since must be on or before until", "VALIDATION_ERROR", false);
    }
    return { since: input.since, until: input.until };
  }
  if (input.mode === "recent" || input.mode === "test") {
    return getRecentRange(input.recentDays, input.timeZone, input.now);
  }
  throw new Ga4Error("since and until are required for this GA4 sync mode", "VALIDATION_ERROR", false);
}

export function resolveReportingTimeZone(input: {
  stored?: string | null;
  configured?: string;
  metadata?: string;
  allowUtcFallback?: boolean;
}): string {
  const candidates = [input.metadata, input.stored, input.configured].filter(
    (value): value is string => Boolean(value && value.trim())
  );
  for (const candidate of candidates) {
    if (isValidIanaTimeZone(candidate)) return candidate;
  }
  if (input.allowUtcFallback) return "UTC";
  throw new Ga4ConfigError(
    "GA4 reporting timezone is unknown. Set GA4_REPORTING_TIMEZONE or run a connection test after WIF is configured. UTC is not assumed for scheduled production sync."
  );
}

export async function fetchBaseReport(
  client: Ga4DataClient,
  dataset: Ga4Dataset,
  range: DateRange
): Promise<Ga4ReportResponse> {
  const spec = dataset === "daily" ? dailyReportSpec() : dataset === "channel" ? channelReportSpec() : utmReportSpec();
  const page = await client.fetchReportPages({
    dimensions: spec.dimensions,
    metrics: spec.baseMetrics,
    range,
  });
  return { rows: page.rows, metadata: page.metadata };
}

export async function fetchEcommerceReport(
  client: Ga4DataClient,
  dataset: Ga4Dataset,
  range: DateRange
): Promise<Ga4ReportResponse> {
  const spec = dataset === "daily" ? dailyReportSpec() : dataset === "channel" ? channelReportSpec() : utmReportSpec();
  const page = await client.fetchReportPages({
    dimensions: spec.dimensions,
    metrics: spec.ecommerceMetrics,
    range,
  });
  return { rows: page.rows, metadata: page.metadata };
}

export function mergeDatasetReports(
  dataset: Ga4Dataset,
  propertyId: string,
  base: Ga4ReportResponse,
  ecommerce: Ga4ReportResponse
) {
  if (dataset === "daily") return normalizeDailyRows(propertyId, base, ecommerce);
  if (dataset === "channel") return normalizeChannelRows(propertyId, base, ecommerce);
  return normalizeUtmRows(propertyId, base, ecommerce);
}

export async function runGa4Sync(input: RunGa4SyncInput): Promise<SyncRunResult> {
  const env = input.env ?? getGa4Env();
  if (input.requireEnabled !== false && !isGa4SyncEnabled(env)) {
    throw new Ga4SyncDisabledError();
  }

  const propertyId = getGa4PropertyId(env);
  const started = Date.now();
  const activeBackfill = await getActiveBackfillJob(propertyId, input.dataset);
  if (input.mode !== "backfill") {
    assertNoActiveBackfillConflict(input.mode, activeBackfill);
  }

  const lockToken = await acquireGa4SyncLock(propertyId, input.dataset, input.mode);
  if (!lockToken) {
    throw new Ga4SyncLockError(propertyId, input.dataset);
  }

  const client = input.client ?? new Ga4DataClient({ env });
  let runId = "";
  const counts = emptyCounts();

  try {
    const stored = await getProperty(propertyId);
    const timeZone = resolveReportingTimeZone({
      stored: stored?.reporting_timezone,
      configured: env.GA4_REPORTING_TIMEZONE,
      allowUtcFallback: input.mode === "test" || Boolean(input.timeZone),
    });
    const range = resolveSyncRange({
      mode: input.mode,
      since: input.since,
      until: input.until,
      timeZone: input.timeZone ?? timeZone,
      recentDays: env.GA4_RECENT_DAYS_BACK,
      now: input.now,
    });
    assertAllowedRange(input.mode, range);

    runId = await createSyncRun({
      propertyId,
      dataset: input.dataset,
      mode: input.mode,
      requestedFrom: range.since,
      requestedTo: range.until,
    });

    const base = await fetchBaseReport(client, input.dataset, range);
    const ecommerce = await fetchEcommerceReport(client, input.dataset, range);
    counts.baseRowsFetched = base.rows?.length ?? 0;
    counts.ecommerceRowsFetched = ecommerce.rows?.length ?? 0;
    counts.apiRequests = client.apiRequests;
    counts.pagesFetched = client.pagesFetched;
    counts.retryCount = client.retryCount;

    const rows = mergeDatasetReports(input.dataset, propertyId, base, ecommerce).map((row) => ({
      ...row,
      last_sync_run_id: runId,
    }));

    if (input.dataset === "daily") {
      counts.rowsUpserted = await upsertDailyRows(rows);
    } else if (input.dataset === "channel") {
      counts.rowsUpserted = await upsertChannelRows(rows as Awaited<ReturnType<typeof normalizeChannelRows>>);
    } else {
      counts.rowsUpserted = await upsertUtmRows(rows as Awaited<ReturnType<typeof normalizeUtmRows>>);
    }

    const metadata = base.metadata ?? ecommerce.metadata;
    await persistPropertyMetadata(propertyId, env, metadata, stored);

    await upsertSyncState({
      property_id: propertyId,
      dataset: input.dataset,
      last_successful_sync_at: new Date().toISOString(),
      last_successful_from: range.since,
      last_successful_to: range.until,
      last_backfill_completed_at:
        input.mode === "backfill"
          ? (await getSyncState(propertyId, input.dataset))?.last_backfill_completed_at ?? null
          : (await getSyncState(propertyId, input.dataset))?.last_backfill_completed_at ?? null,
    });

    await finishSyncRun(runId, "success", counts);
    return buildResult(runId, input.dataset, input.mode, "success", counts, range, started);
  } catch (err) {
    const message = sanitizeGa4Error(err instanceof Error ? err.message : "GA4 sync failed");
    const code = err instanceof Ga4Error ? err.code : "SYNC_FAILED";
    if (runId) {
      await recordSyncError({
        syncRunId: runId,
        dataset: input.dataset,
        operation: "sync",
        errorCode: code,
        errorMessage: message,
        retryable: err instanceof Ga4Error ? err.retryable : false,
      });
      await finishSyncRun(runId, "failed", counts, code, message);
    }
    logger.error("GA4 sync failed", { provider: INTEGRATION, dataset: input.dataset, error: message });
    if (err instanceof Ga4Error) throw err;
    throw new Ga4Error(message, code, false);
  } finally {
    await releaseGa4SyncLock(propertyId, input.dataset, lockToken);
  }
}

export async function runRecentSync(input: {
  datasets?: Ga4Dataset[];
  env?: Ga4Env;
  requireEnabled?: boolean;
  force?: boolean;
  client?: Ga4DataClient;
  now?: Date;
}): Promise<{ success: boolean; disabled?: boolean; results: SyncRunResult[] }> {
  const env = input.env ?? getGa4Env();
  if (input.requireEnabled !== false && !input.force && !isGa4SyncEnabled(env)) {
    return { success: false, disabled: true, results: [] };
  }

  const datasets = input.datasets?.length ? input.datasets : [...DATASETS];
  const results: SyncRunResult[] = [];
  for (const dataset of datasets) {
    try {
      results.push(
        await runGa4Sync({
          dataset,
          mode: "recent",
          env,
          requireEnabled: false,
          client: input.client,
          now: input.now,
        })
      );
    } catch (err) {
      results.push({
        runId: "",
        dataset,
        mode: "recent",
        status: "failed",
        requestedFrom: null,
        requestedTo: null,
        durationMs: 0,
        success: false,
        warning: sanitizeGa4Error(err instanceof Error ? err.message : "sync failed"),
        ...emptyCounts(),
      });
    }
  }
  return { success: results.every((result) => result.success), results };
}

export async function runConnectionTest(input: {
  env?: Ga4Env;
  client?: Ga4DataClient;
}): Promise<{
  ok: boolean;
  propertyId: string;
  reportingTimezone: string | null;
  currencyCode: string | null;
  authMode: string;
}> {
  const env = input.env ?? getGa4Env();
  const propertyId = getGa4PropertyId(env);
  const client = input.client ?? new Ga4DataClient({ env });
  const stored = await getProperty(propertyId);
  const timeZone = resolveReportingTimeZone({
    stored: stored?.reporting_timezone,
    configured: env.GA4_REPORTING_TIMEZONE,
    allowUtcFallback: true,
  });
  const range = getRecentRange(0, timeZone);
  const report = await client.runReport({
    dateRanges: [{ startDate: range.since, endDate: range.until }],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }],
    limit: 1,
  });
  const metadata = report.metadata;
  await persistPropertyMetadata(propertyId, env, metadata, stored, true);
  return {
    ok: true,
    propertyId,
    reportingTimezone: metadata?.timeZone || stored?.reporting_timezone || env.GA4_REPORTING_TIMEZONE || null,
    currencyCode: metadata?.currencyCode || stored?.currency_code || env.GA4_CURRENCY || null,
    authMode: getAuthMode(),
  };
}

export async function runCompatibilityCheck(input: {
  dataset: Ga4Dataset;
  env?: Ga4Env;
  client?: Ga4DataClient;
}): Promise<Ga4CompatibilityResponse> {
  const env = input.env ?? getGa4Env();
  const client = input.client ?? new Ga4DataClient({ env });
  const spec =
    input.dataset === "daily" ? dailyReportSpec() : input.dataset === "channel" ? channelReportSpec() : utmReportSpec();
  return client.checkCompatibility({
    dimensions: spec.dimensions.map((name) => ({ name })),
    metrics: [...spec.baseMetrics, ...spec.ecommerceMetrics].map((name) => ({ name })),
  });
}

export async function getSyncStatus() {
  const env = getGa4Env();
  const propertyId = getGa4PropertyId(env);
  const property = await getProperty(propertyId);
  const runs = await getLatestSyncRuns(propertyId);
  const states = await Promise.all(DATASETS.map((dataset) => getSyncState(propertyId, dataset)));
  const backfills = await Promise.all(DATASETS.map((dataset) => getActiveBackfillJob(propertyId, dataset)));
  return {
    property,
    authMode: getAuthMode(),
    datasets: DATASETS.map((dataset, index) => ({
      dataset,
      state: states[index],
      lastRun: runs[index]?.run ?? null,
      activeBackfill: backfills[index],
    })),
  };
}

async function persistPropertyMetadata(
  propertyId: string,
  env: Ga4Env,
  metadata: Ga4ReportMetadata | undefined,
  stored: { reporting_timezone: string | null; currency_code: string | null; display_name: string | null } | null,
  verified = false
): Promise<void> {
  await upsertProperty({
    property_id: propertyId,
    display_name: stored?.display_name ?? null,
    reporting_timezone: metadata?.timeZone || stored?.reporting_timezone || env.GA4_REPORTING_TIMEZONE || null,
    currency_code: metadata?.currencyCode || stored?.currency_code || env.GA4_CURRENCY || null,
    last_synced_at: new Date().toISOString(),
    ...(verified ? { last_verified_at: new Date().toISOString() } : {}),
  });
}

function buildResult(
  runId: string,
  dataset: Ga4Dataset,
  mode: SyncMode,
  status: SyncStatus,
  counts: SyncRunCounts,
  range: DateRange,
  started: number
): SyncRunResult {
  return {
    runId,
    dataset,
    mode,
    status,
    requestedFrom: range.since,
    requestedTo: range.until,
    durationMs: Date.now() - started,
    success: status === "success",
    ...counts,
  };
}
