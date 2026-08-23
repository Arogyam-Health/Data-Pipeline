import { logger } from "@/lib/logger";
import { INTEGRATION, SCHEDULER_STARTUP_DELAY_MS } from "./constants";
import { getShopifyEnv, isShopifySyncEnabled } from "./env";
import { sanitizeShopifyError } from "./errors";
import { runShopifySync } from "./sync";

type SchedulerGlobal = typeof globalThis & {
  __shopifyIncTimer?: ReturnType<typeof setInterval>;
  __shopifyIncStartup?: ReturnType<typeof setTimeout>;
  __shopifyIncInFlight?: boolean;
};

export function shouldStartLocalShopifyScheduler(input: {
  syncEnabled: boolean;
  runtime?: string;
  jestWorkerId?: string;
}): boolean {
  if (input.jestWorkerId) return false;
  if (input.runtime && input.runtime !== "nodejs") return false;
  return input.syncEnabled;
}

export async function runScheduledIncrementalSync(): Promise<boolean> {
  const g = globalThis as SchedulerGlobal;
  if (g.__shopifyIncInFlight) return false;
  g.__shopifyIncInFlight = true;
  try {
    const result = await runShopifySync({ mode: "incremental", requireEnabled: true });
    logger.info("Shopify scheduled incremental sync finished", {
      provider: INTEGRATION,
      status: result.status,
      orders_count: result.ordersFetched,
    });
    return result.success;
  } catch (err) {
    logger.error("Shopify scheduled incremental sync failed", {
      provider: INTEGRATION,
      error: sanitizeShopifyError(err instanceof Error ? err.message : "sync failed"),
    });
    return false;
  } finally {
    g.__shopifyIncInFlight = false;
  }
}

export function startShopifyIncrementalScheduler(): boolean {
  if (
    !shouldStartLocalShopifyScheduler({
      syncEnabled: process.env.SHOPIFY_SYNC_ENABLED === "true",
      runtime: process.env.NEXT_RUNTIME,
      jestWorkerId: process.env.JEST_WORKER_ID,
    })
  ) {
    return false;
  }

  const g = globalThis as SchedulerGlobal;
  if (g.__shopifyIncTimer || g.__shopifyIncStartup) return false;

  let intervalMinutes: number;
  try {
    intervalMinutes = getShopifyEnv().SHOPIFY_SYNC_INTERVAL_MINUTES;
  } catch (err) {
    logger.error("Shopify scheduler skipped; environment is invalid", {
      provider: INTEGRATION,
      error: sanitizeShopifyError(err instanceof Error ? err.message : "invalid env"),
    });
    return false;
  }

  if (!isShopifySyncEnabled()) return false;

  const intervalMs = intervalMinutes * 60 * 1000;
  g.__shopifyIncStartup = setTimeout(() => {
    g.__shopifyIncStartup = undefined;
    void runScheduledIncrementalSync();
    g.__shopifyIncTimer = setInterval(() => {
      void runScheduledIncrementalSync();
    }, intervalMs);
  }, SCHEDULER_STARTUP_DELAY_MS);

  logger.info("Shopify incremental scheduler started", {
    provider: INTEGRATION,
    interval_minutes: intervalMinutes,
  });
  return true;
}

export function stopShopifyIncrementalScheduler(): void {
  const g = globalThis as SchedulerGlobal;
  if (g.__shopifyIncStartup) {
    clearTimeout(g.__shopifyIncStartup);
    g.__shopifyIncStartup = undefined;
  }
  if (g.__shopifyIncTimer) {
    clearInterval(g.__shopifyIncTimer);
    g.__shopifyIncTimer = undefined;
  }
  g.__shopifyIncInFlight = false;
}
