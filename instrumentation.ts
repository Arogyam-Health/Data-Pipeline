export async function register() {
  const disableInternalScheduler =
    process.env.DISABLE_INTERNAL_SCHEDULER === "true";

  // ----------------------------------------------------
  // SHOPIFY INTERNAL SCHEDULER
  // ----------------------------------------------------
  if (!disableInternalScheduler) {
    try {
      const { startShopifyIncrementalScheduler } = await import(
        "@/modules/shopify/scheduler"
      );

      startShopifyIncrementalScheduler();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "unknown scheduler error";

      console.error(
        "Shopify incremental scheduler failed to start:",
        message
      );
    }
  } else {
    console.log(
      "[Scheduler] Shopify internal scheduler disabled - using external cron"
    );
  }

  // ----------------------------------------------------
  // META INTERNAL SCHEDULER
  // ----------------------------------------------------
  if (!disableInternalScheduler) {
    try {
      const { startMetaScheduler } = await import(
        "@/modules/meta/scheduler"
      );

      startMetaScheduler();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "unknown scheduler error";

      console.error(
        "Meta scheduler failed to start:",
        message
      );
    }
  } else {
    console.log(
      "[Scheduler] Meta internal scheduler disabled - using external cron"
    );
  }

  // ----------------------------------------------------
  // GA4 - KEEP RUNNING INTERNALLY FOR NOW
  // ----------------------------------------------------
  try {
    const { startGa4Scheduler } = await import(
      "@/modules/ga4/scheduler"
    );

    startGa4Scheduler();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "unknown scheduler error";

    console.error(
      "GA4 scheduler failed to start:",
      message
    );
  }
}


// export async function register() {
//   if (process.env.NEXT_RUNTIME !== "nodejs") return;
//   if (process.env.JEST_WORKER_ID) return;
//   // Auto-sync enabled for Vercel (cron-job.org is backup, not required)
//   if (process.env.DISABLE_INTERNAL_SCHEDULER === "true") return;

//   try {
//     const { startShopifyIncrementalScheduler } = await import(
//       "@/modules/shopify/scheduler"
//     );
//     startShopifyIncrementalScheduler();
//   } catch (err) {
//     const message = err instanceof Error ? err.message : "unknown scheduler error";
//     console.error("Shopify incremental scheduler failed to start:", message);
//   }

//   try {
//     const { startMetaScheduler } = await import("@/modules/meta/scheduler");
//     startMetaScheduler();
//   } catch (err) {
//     const message = err instanceof Error ? err.message : "unknown scheduler error";
//     console.error("Meta scheduler failed to start:", message);
//   }

//   try {
//     const { startGa4Scheduler } = await import("@/modules/ga4/scheduler");
//     startGa4Scheduler();
//   } catch (err) {
//     const message = err instanceof Error ? err.message : "unknown scheduler error";
//     console.error("GA4 scheduler failed to start:", message);
//   }
// }
