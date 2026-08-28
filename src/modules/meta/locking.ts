import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { INTEGRATION, SYNC_LOCK_TTL_SECONDS } from "./constants";
import { MetaSyncConflictError } from "./errors";
import type { BackfillJobRow, SyncMode } from "./types";

export async function acquireMetaSyncLock(
  adAccountId: string,
  mode: SyncMode,
  ttlSeconds = SYNC_LOCK_TTL_SECONDS
): Promise<string | null> {
  const { data, error } = await getSupabaseClient().rpc("try_acquire_meta_sync_lock", {
    p_ad_account_id: adAccountId,
    p_mode: mode,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) {
    logger.error("Failed to acquire Meta sync lock", {
      provider: INTEGRATION,
      error: error.message,
    });
    throw new Error(`Failed to acquire Meta sync lock: ${error.message}`);
  }
  return (data as string | null) ?? null;
}

export async function releaseMetaSyncLock(adAccountId: string, lockToken: string): Promise<void> {
  await getSupabaseClient().rpc("release_meta_sync_lock", {
    p_ad_account_id: adAccountId,
    p_lock_token: lockToken,
  });
}

export function assertNoActiveBackfillConflict(
  mode: SyncMode,
  active: BackfillJobRow | null
): void {
  if (!active) return;
  if (mode === "backfill") {
    throw new MetaSyncConflictError("A Meta backfill is already active for this ad account.");
  }
  if (mode === "today" || mode === "recent_repair" || mode === "repair") {
    throw new MetaSyncConflictError(
      "A Meta backfill is already active. Wait for it to finish or resume it instead of overlapping the same account."
    );
  }
}

export function assertBackfillAllowed(resume: boolean, existing: BackfillJobRow | null): void {
  if (!resume && existing) {
    throw new MetaSyncConflictError("A Meta backfill is already active for this ad account.");
  }
  if (resume && !existing) {
    throw new MetaSyncConflictError("No resumable Meta backfill job was found for this ad account.");
  }
}

export function rangesOverlap(
  a: { since: string; until: string },
  b: { since: string; until: string }
): boolean {
  return a.since <= b.until && b.since <= a.until;
}
