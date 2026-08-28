import { addCalendarDays, chunkDateRange, getBackfillWindow } from "./dates";
import { getMetaEnv, type MetaEnv } from "./env";
import { MetaSyncConflictError } from "./errors";
import { assertBackfillAllowed } from "./locking";
import { createBackfillJob, getActiveBackfillJob, updateBackfillJob } from "./repository";
import { runMetaSync } from "./sync";
import type { DateRange, SyncRunResult } from "./types";

export function planBackfillChunks(
  totalDaysBack: number,
  chunkDays: number,
  timeZone: string,
  now?: Date
): DateRange[] {
  const window = getBackfillWindow(totalDaysBack, timeZone, now);
  return chunkDateRange(window.since, window.until, chunkDays);
}

export async function runMetaBackfill(input: {
  resume?: boolean;
  env?: MetaEnv;
  timeZone?: string;
}): Promise<SyncRunResult> {
  const env = input.env ?? getMetaEnv();
  const adAccountId = env.META_AD_ACCOUNT_ID;
  const existing = await getActiveBackfillJob(adAccountId);
  assertBackfillAllowed(Boolean(input.resume), existing);

  const timeZone = input.timeZone ?? "UTC";
  let jobId: string;
  let nextStart: string;
  let requestedFrom: string;
  let requestedTo: string;
  const chunkDays = existing?.chunk_days ?? env.META_BACKFILL_CHUNK_DAYS;

  if (input.resume && existing) {
    if (!existing.next_chunk_start) {
      throw new MetaSyncConflictError("The active Meta backfill job has no remaining chunk.");
    }
    jobId = existing.id;
    nextStart = existing.next_chunk_start;
    requestedFrom = existing.requested_from;
    requestedTo = existing.requested_to;
    await updateBackfillJob(jobId, { status: "running" });
  } else {
    const window = getBackfillWindow(env.META_BACKFILL_DAYS, timeZone);
    requestedFrom = window.since;
    requestedTo = window.until;
    nextStart = window.since;
    jobId = await createBackfillJob({
      adAccountId,
      requestedFrom,
      requestedTo,
      chunkDays,
      nextChunkStart: nextStart,
    });
  }

  const chunkUntilCandidate = addCalendarDays(nextStart, chunkDays - 1);
  const chunkUntil = chunkUntilCandidate > requestedTo ? requestedTo : chunkUntilCandidate;

  const result = await runMetaSync({
    mode: "backfill",
    since: nextStart,
    until: chunkUntil,
    env,
    requireEnabled: false,
  });

  const following = addCalendarDays(chunkUntil, 1);
  const hasMore = following <= requestedTo;

  if (result.success) {
    if (!hasMore) {
      await updateBackfillJob(jobId, {
        status: "completed",
        next_chunk_start: null,
        finished_at: new Date().toISOString(),
        last_error: null,
      });
    } else {
      await updateBackfillJob(jobId, {
        status: "paused",
        next_chunk_start: following,
        last_error: null,
      });
    }
  } else {
    await updateBackfillJob(jobId, {
      status: "failed",
      last_error: result.warning,
    });
  }

  return {
    ...result,
    resumable: result.success && hasMore,
  };
}
