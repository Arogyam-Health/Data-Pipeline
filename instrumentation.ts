export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.JEST_WORKER_ID) return;

  try {
    const { startShopifyIncrementalScheduler } = await import(
      "@/modules/shopify/scheduler"
    );
    startShopifyIncrementalScheduler();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown scheduler error";
    console.error("Shopify incremental scheduler failed to start:", message);
  }
}
