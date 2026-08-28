import type { DateRange } from "./types";

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days));
  return utc.toISOString().slice(0, 10);
}

export function inclusiveDayCount(since: string, until: string): number {
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function ga4DateToIso(value: string | undefined): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return null;
}

export function getAccountDateRange(input: {
  daysBack: number;
  now?: Date;
  timeZone: string;
}): DateRange {
  const now = input.now ?? new Date();
  const until = formatDateInTimeZone(now, input.timeZone);
  return {
    since: addCalendarDays(until, -input.daysBack),
    until,
  };
}

/** daysBack=2 means day-before-yesterday + yesterday + today (3 calendar dates). */
export function getRecentRange(daysBack: number, timeZone: string, now?: Date): DateRange {
  return getAccountDateRange({ daysBack, timeZone, now });
}

export function getBackfillWindow(totalDaysBack: number, timeZone: string, now?: Date): DateRange {
  return getAccountDateRange({ daysBack: totalDaysBack, timeZone, now });
}

export function chunkDateRange(since: string, until: string, chunkDays: number): DateRange[] {
  const ranges: DateRange[] = [];
  let cursor = since;
  while (cursor <= until) {
    const chunkEnd = addCalendarDays(cursor, chunkDays - 1);
    const untilChunk = chunkEnd > until ? until : chunkEnd;
    ranges.push({ since: cursor, until: untilChunk });
    cursor = addCalendarDays(untilChunk, 1);
  }
  return ranges;
}

export function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
