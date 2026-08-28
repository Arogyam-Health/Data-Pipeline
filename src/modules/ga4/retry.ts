import { DEFAULT_BASE_RETRY_MS, RETRY_BACKOFF_MS } from "./constants";

export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return null;
}

export function retryDelayMs(
  attempt: number,
  retryAfterMs?: number | null,
  jitterMs = Math.floor(Math.random() * 1000)
): number {
  if (retryAfterMs != null && retryAfterMs > 0) {
    return retryAfterMs;
  }
  const base = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)] ?? DEFAULT_BASE_RETRY_MS;
  return base + jitterMs;
}
