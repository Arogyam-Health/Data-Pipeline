import { logger } from "@/lib/logger";
import { INTEGRATION, SCHEDULER_STARTUP_DELAY_MS } from "./constants";
import { getGa4Env, isGa4SyncEnabled } from "./env";
import { sanitizeGa4Error } from "./errors";
import { runRecentSync } from "./sync";

type SchedulerGlobal = typeof globalThis & {
  __ga4RecentTimer?: ReturnType<typeof setInterval>;
  __ga4Startup?: ReturnType<typeof setTimeout>;
  __ga4InFlight?: boolean;
};

export function shouldStartLocalGa4Scheduler(input: {
  syncEnabled: boolean;
  runtime?: string;
  jestWorkerId?: string;
}): boolean {
  if (input.jestWorkerId) return false;
  if (input.runtime && input.runtime !== "nodejs") return false;
  return input.syncEnabled;
}

export async function runScheduledRecentSync(): Promise<boolean> {
  const g = globalThis as SchedulerGlobal;
  if (g.__ga4InFlight) return false;
  g.__ga4InFlight = true;
  try {
    const result = await runRecentSync({ requireEnabled: true });
    if (result.disabled) {
      logger.info("GA4 scheduled recent sync skipped; disabled", { provider: INTEGRATION });
      return false;
    }
    logger.info("GA4 scheduled recent sync finished", {
      provider: INTEGRATION,
      success: result.success,
      datasets: result.results.map((row) => `${row.dataset}:${row.status}`).join(","),
    });
    return result.success;
  } catch (err) {
    logger.error("GA4 scheduled recent sync failed", {
      provider: INTEGRATION,
      error: sanitizeGa4Error(err instanceof Error ? err.message : "sync failed"),
    });
    return false;
  } finally {
    g.__ga4InFlight = false;
  }
}

export function startGa4Scheduler(): boolean {
  if (
    !shouldStartLocalGa4Scheduler({
      syncEnabled: process.env.GA4_SYNC_ENABLED === "true",
      runtime: process.env.NEXT_RUNTIME,
      jestWorkerId: process.env.JEST_WORKER_ID,
    })
  ) {
    return false;
  }

  const g = globalThis as SchedulerGlobal;
  if (g.__ga4RecentTimer || g.__ga4Startup) return false;

  try {
    getGa4Env();
  } catch (err) {
    logger.error("GA4 scheduler skipped; environment is invalid", {
      provider: INTEGRATION,
      error: sanitizeGa4Error(err instanceof Error ? err.message : "invalid env"),
    });
    return false;
  }

  if (!isGa4SyncEnabled()) return false;

  g.__ga4Startup = setTimeout(() => {
    g.__ga4Startup = undefined;
    void runScheduledRecentSync();
    g.__ga4RecentTimer = setInterval(() => {
      void runScheduledRecentSync();
    }, 15 * 60 * 1000);
  }, SCHEDULER_STARTUP_DELAY_MS);

  logger.info("GA4 recent scheduler started", {
    provider: INTEGRATION,
    interval_minutes: 15,
  });
  return true;
}

export function stopGa4Scheduler(): void {
  const g = globalThis as SchedulerGlobal;
  if (g.__ga4Startup) {
    clearTimeout(g.__ga4Startup);
    g.__ga4Startup = undefined;
  }
  if (g.__ga4RecentTimer) {
    clearInterval(g.__ga4RecentTimer);
    g.__ga4RecentTimer = undefined;
  }
  g.__ga4InFlight = false;
}
