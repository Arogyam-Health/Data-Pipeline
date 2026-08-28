import { logger } from "@/lib/logger";
import { INTEGRATION, RECENT_REPAIR_INTERVAL_MS, SCHEDULER_STARTUP_DELAY_MS } from "./constants";
import { getMetaEnv, isMetaSyncEnabled } from "./env";
import { sanitizeMetaError } from "./errors";
import { runMetaSync } from "./sync";

type SchedulerGlobal = typeof globalThis & {
  __metaTodayTimer?: ReturnType<typeof setInterval>;
  __metaRecentTimer?: ReturnType<typeof setInterval>;
  __metaStartup?: ReturnType<typeof setTimeout>;
  __metaInFlight?: boolean;
};

export function shouldStartLocalMetaScheduler(input: {
  syncEnabled: boolean;
  runtime?: string;
  jestWorkerId?: string;
}): boolean {
  if (input.jestWorkerId) return false;
  if (input.runtime && input.runtime !== "nodejs") return false;
  return input.syncEnabled;
}

export async function runScheduledTodaySync(): Promise<boolean> {
  const g = globalThis as SchedulerGlobal;
  if (g.__metaInFlight) return false;
  g.__metaInFlight = true;
  try {
    const result = await runMetaSync({ mode: "today", requireEnabled: true });
    logger.info("Meta scheduled today sync finished", {
      provider: INTEGRATION,
      status: result.status,
      rows_fetched: result.rowsFetched,
    });
    return result.success;
  } catch (err) {
    logger.error("Meta scheduled today sync failed", {
      provider: INTEGRATION,
      error: sanitizeMetaError(err instanceof Error ? err.message : "sync failed"),
    });
    return false;
  } finally {
    g.__metaInFlight = false;
  }
}

export async function runScheduledRecentRepair(): Promise<boolean> {
  try {
    const result = await runMetaSync({ mode: "recent_repair", requireEnabled: true });
    logger.info("Meta scheduled recent repair finished", {
      provider: INTEGRATION,
      status: result.status,
      rows_fetched: result.rowsFetched,
    });
    return result.success;
  } catch (err) {
    logger.error("Meta scheduled recent repair failed", {
      provider: INTEGRATION,
      error: sanitizeMetaError(err instanceof Error ? err.message : "repair failed"),
    });
    return false;
  }
}

export function startMetaScheduler(): boolean {
  if (
    !shouldStartLocalMetaScheduler({
      syncEnabled: process.env.META_SYNC_ENABLED === "true",
      runtime: process.env.NEXT_RUNTIME,
      jestWorkerId: process.env.JEST_WORKER_ID,
    })
  ) {
    return false;
  }

  const g = globalThis as SchedulerGlobal;
  if (g.__metaTodayTimer || g.__metaStartup) return false;

  try {
    getMetaEnv();
  } catch (err) {
    logger.error("Meta scheduler skipped; environment is invalid", {
      provider: INTEGRATION,
      error: sanitizeMetaError(err instanceof Error ? err.message : "invalid env"),
    });
    return false;
  }

  if (!isMetaSyncEnabled()) return false;

  g.__metaStartup = setTimeout(() => {
    g.__metaStartup = undefined;
    void runScheduledTodaySync();
    g.__metaTodayTimer = setInterval(() => {
      void runScheduledTodaySync();
    }, 15 * 60 * 1000);
    g.__metaRecentTimer = setInterval(() => {
      void runScheduledRecentRepair();
    }, RECENT_REPAIR_INTERVAL_MS);
  }, SCHEDULER_STARTUP_DELAY_MS);

  logger.info("Meta today scheduler started", {
    provider: INTEGRATION,
    interval_minutes: 15,
  });
  return true;
}

export function stopMetaScheduler(): void {
  const g = globalThis as SchedulerGlobal;
  if (g.__metaStartup) {
    clearTimeout(g.__metaStartup);
    g.__metaStartup = undefined;
  }
  if (g.__metaTodayTimer) {
    clearInterval(g.__metaTodayTimer);
    g.__metaTodayTimer = undefined;
  }
  if (g.__metaRecentTimer) {
    clearInterval(g.__metaRecentTimer);
    g.__metaRecentTimer = undefined;
  }
  g.__metaInFlight = false;
}
