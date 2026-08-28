import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { INTEGRATION, SYNC_LOCK_TTL_SECONDS } from "./constants";
import { Ga4SyncConflictError } from "./errors";
import type { BackfillJobRow, Ga4Dataset, SyncMode } from "./types";

export async function acquireGa4SyncLock(
  propertyId: string,
  dataset: Ga4Dataset,
  mode: SyncMode,
  ttlSeconds = SYNC_LOCK_TTL_SECONDS
): Promise<string | null> {
  const { data, error } = await getSupabaseClient().rpc("try_acquire_ga4_sync_lock", {
    p_property_id: propertyId,
    p_dataset: dataset,
    p_mode: mode,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) {
    logger.error("Failed to acquire GA4 sync lock", {
      provider: INTEGRATION,
      error: error.message,
    });
    throw new Error(`Failed to acquire GA4 sync lock: ${error.message}`);
  }
  return (data as string | null) ?? null;
}

export async function releaseGa4SyncLock(
  propertyId: string,
  dataset: Ga4Dataset,
  lockToken: string
): Promise<void> {
  await getSupabaseClient().rpc("release_ga4_sync_lock", {
    p_property_id: propertyId,
    p_dataset: dataset,
    p_lock_token: lockToken,
  });
}

export function assertNoActiveBackfillConflict(mode: SyncMode, active: BackfillJobRow | null): void {
  if (!active) return;
  if (mode === "backfill") {
    throw new Ga4SyncConflictError("A GA4 backfill is already active for this property/dataset.");
  }
  if (mode === "recent" || mode === "repair") {
    throw new Ga4SyncConflictError(
      "A GA4 backfill is already active for this dataset. Resume or cancel it instead of overlapping."
    );
  }
}

export function assertBackfillAllowed(resume: boolean, existing: BackfillJobRow | null): void {
  if (!resume && existing) {
    throw new Ga4SyncConflictError("A GA4 backfill is already active for this property/dataset.");
  }
  if (resume && !existing) {
    throw new Ga4SyncConflictError("No resumable GA4 backfill job was found for this property/dataset.");
  }
}

export function lockIdentity(propertyId: string, dataset: Ga4Dataset): string {
  return `ga4:${propertyId}:${dataset}`;
}
