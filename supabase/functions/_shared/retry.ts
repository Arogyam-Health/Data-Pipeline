/**
 * Calculate exponential backoff delay in milliseconds.
 * attempt 1 → 15s, attempt 2 → 30s, ... cap at 15 minutes.
 */
export function calculateRetryDelay(
  attempt: number,
  opts: { baseMs?: number; maxMs?: number } = {}
): number {
  const baseMs = opts.baseMs ?? 15_000;
  const maxMs = opts.maxMs ?? 15 * 60 * 1000;
  return Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
}

export function isDeadLetter(
  attemptCount: number,
  maxAttempts: number = 10
): boolean {
  return attemptCount >= maxAttempts;
}
