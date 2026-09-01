export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.JEST_WORKER_ID) return;

  // Schedulers disabled — cron-job.org handles scheduling externally.
  // To re-enable, uncomment the imports below.
}
