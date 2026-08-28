import { MAX_PAGING_PAGES } from "./constants";

export function nextOffset(currentOffset: number, limit: number, rowsReturned: number): number | null {
  if (rowsReturned < limit) return null;
  return currentOffset + limit;
}

export function shouldStopPaging(pagesFetched: number, maxPages = MAX_PAGING_PAGES): boolean {
  return pagesFetched >= maxPages;
}
