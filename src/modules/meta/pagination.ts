import { MAX_PAGING_PAGES } from "./constants";
import { stripAccessTokenFromUrl } from "./errors";

export function nextPagingUrl(paging?: { next?: string } | null): string | null {
  const next = paging?.next;
  if (!next) return null;
  return stripAccessTokenFromUrl(next);
}

export function detectRepeatedPagingUrl(
  seen: Set<string>,
  url: string | null
): { repeated: boolean; sanitized: string | null } {
  if (!url) return { repeated: false, sanitized: null };
  const sanitized = stripAccessTokenFromUrl(url);
  if (seen.has(sanitized)) return { repeated: true, sanitized };
  seen.add(sanitized);
  return { repeated: false, sanitized };
}

export function shouldStopPaging(pagesFetched: number, maxPages = MAX_PAGING_PAGES): boolean {
  return pagesFetched >= maxPages;
}
