import { addCalendarDays, chunkDateRange, getBackfillWindow } from "./dates";
import { getGa4Env, getGa4PropertyId, type Ga4Env } from "./env";
import { Ga4SyncConflictError } from "./errors";
import { assertBackfillAllowed } from "./locking";
import { createBackfillJob, getActiveBackfillJob, updateBackfillJob, upsertSyncState, getSyncState } from "./repository";
import { resolveReportingTimeZone, runGa4Sync } from "./sync";
import { getProperty } from "./repository";
import type { DateRange, Ga4Dataset, SyncRunResult } from "./types";

export function planBackfillChunks(
  totalDaysBack: number,
  chunkDays: number,
  timeZone: string,
  now?: Date
): DateRange[] {
  const window = getBackfillWindow(totalDaysBack, timeZone, now);
  return chunkDateRange(window.since, window.until, chunkDays);
}

export function planUtmBackfillChunks(startDate: string, chunkDays: number, timeZone: string, now?: Date): DateRange[] {
  const until = getBackfillWindow(0, timeZone, now).until;
  return chunkDateRange(startDate, until, chunkDays);
}

export function defaultBackfillWindow(dataset: Ga4Dataset, env: Ga4Env, timeZone: string, now?: Date): DateRange {
  if (dataset === "utm") {
    const until = getBackfillWindow(0, timeZone, now).until;
    return { since: env.GA4_UTM_BACKFILL_START_DATE, until };
  }
  const days = dataset === "daily" ? env.GA4_DAILY_BACKFILL_DAYS : env.GA4_CHANNEL_BACKFILL_DAYS;
  return getBackfillWindow(days, timeZone, now);
}

export function defaultChunkDays(dataset: Ga4Dataset, env: Ga4Env): number {
  if (dataset === "utm") return env.GA4_UTM_BACKFILL_CHUNK_DAYS;
  if (dataset === "daily") return env.GA4_DAILY_BACKFILL_CHUNK_DAYS;
  return env.GA4_CHANNEL_BACKFILL_CHUNK_DAYS;
}

export async function runGa4Backfill(input: {
  dataset: Ga4Dataset;
  resume?: boolean;
  env?: Ga4Env;
  since?: string;
  until?: string;
  now?: Date;
}): Promise<SyncRunResult> {
  const env = input.env ?? getGa4Env();
  const propertyId = getGa4PropertyId(env);
  const existing = await getActiveBackfillJob(propertyId, input.dataset);
  assertBackfillAllowed(Boolean(input.resume), existing);

  const stored = await getProperty(propertyId);
  const timeZone = resolveReportingTimeZone({
    stored: stored?.reporting_timezone,
    configured: env.GA4_REPORTING_TIMEZONE,
    allowUtcFallback: Boolean(env.GA4_REPORTING_TIMEZONE) || input.resume,
  });

  let jobId: string;
  let nextStart: string;
  let requestedFrom: string;
  let requestedTo: string;
  const chunkDays = existing?.chunk_days ?? defaultChunkDays(input.dataset, env);

  if (input.resume && existing) {
    if (!existing.next_chunk_start) {
      throw new Ga4SyncConflictError("The active GA4 backfill job has no remaining chunk.");
    }
    jobId = existing.id;
    nextStart = existing.next_chunk_start;
    requestedFrom = existing.requested_from;
    requestedTo = existing.requested_to;
    await updateBackfillJob(jobId, { status: "running" });
  } else {
    const window =
      input.since && input.until
        ? { since: input.since, until: input.until }
        : defaultBackfillWindow(input.dataset, env, timeZone, input.now);
    requestedFrom = window.since;
    requestedTo = window.until;
    nextStart = window.since;
    jobId = await createBackfillJob({
      propertyId,
      dataset: input.dataset,
      requestedFrom,
      requestedTo,
      chunkDays,
      nextChunkStart: nextStart,
    });
  }

  const chunkUntilCandidate = addCalendarDays(nextStart, chunkDays - 1);
  const chunkUntil = chunkUntilCandidate > requestedTo ? requestedTo : chunkUntilCandidate;

  const result = await runGa4Sync({
    dataset: input.dataset,
    mode: "backfill",
    since: nextStart,
    until: chunkUntil,
    env,
    requireEnabled: false,
    now: input.now,
    timeZone,
  });

  const following = addCalendarDays(chunkUntil, 1);
  const hasMore = following <= requestedTo;

  if (result.success) {
    if (!hasMore) {
      await updateBackfillJob(jobId, {
        status: "completed",
        next_chunk_start: null,
        finished_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      });
      const state = await getSyncState(propertyId, input.dataset);
      await upsertSyncState({
        property_id: propertyId,
        dataset: input.dataset,
        last_successful_sync_at: state?.last_successful_sync_at ?? new Date().toISOString(),
        last_successful_from: state?.last_successful_from ?? requestedFrom,
        last_successful_to: state?.last_successful_to ?? requestedTo,
        last_backfill_completed_at: new Date().toISOString(),
      });
    } else {
      await updateBackfillJob(jobId, {
        status: "paused",
        next_chunk_start: following,
        last_error_code: null,
        last_error_message: null,
      });
    }
  } else {
    await updateBackfillJob(jobId, {
      status: "failed",
      last_error_code: "BACKFILL_FAILED",
      last_error_message: result.warning ?? "backfill chunk failed",
    });
  }

  return { ...result, resumable: result.success && hasMore };
}

export async function cancelGa4Backfill(dataset: Ga4Dataset, env?: Ga4Env): Promise<BackfillJobRowLike> {
  const resolved = env ?? getGa4Env();
  const propertyId = getGa4PropertyId(resolved);
  const existing = await getActiveBackfillJob(propertyId, dataset);
  if (!existing) {
    throw new Ga4SyncConflictError("No active GA4 backfill job was found for this dataset.");
  }
  await updateBackfillJob(existing.id, {
    status: "cancelled",
    finished_at: new Date().toISOString(),
  });
  return { ...existing, status: "cancelled" };
}

export async function getBackfillStatus(dataset: Ga4Dataset, env?: Ga4Env) {
  const resolved = env ?? getGa4Env();
  return getActiveBackfillJob(getGa4PropertyId(resolved), dataset);
}

type BackfillJobRowLike = Awaited<ReturnType<typeof getActiveBackfillJob>>;
