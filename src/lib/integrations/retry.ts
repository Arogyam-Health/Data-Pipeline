/**
 * Calculate exponential backoff delay in milliseconds.
 *
 * attempt 1 → 15s
 * attempt 2 → 30s
 * attempt 3 → 60s
 * attempt 4 → 120s
 * ...cap at 15 minutes
 */
export function calculateRetryDelay(
  attempt: number,
  opts: { baseMs?: number; maxMs?: number } = {}
): number {
  const baseMs = opts.baseMs ?? 15_000;
  const maxMs = opts.maxMs ?? 15 * 60 * 1000; // 15 minutes
  return Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
}

/**
 * Whether the attempt count exceeds the dead-letter threshold.
 */
export function isDeadLetter(
  attemptCount: number,
  maxAttempts: number = 10
): boolean {
  return attemptCount >= maxAttempts;
}
