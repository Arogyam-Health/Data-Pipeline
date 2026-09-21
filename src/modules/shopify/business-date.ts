import { resolveDateRange } from "./http";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function toBusinessCalendarDate(value: string): string {
  if (DATE_ONLY.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid business date");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function resolveBusinessDateRange(input: {
  from?: string;
  to?: string;
  range?: "7d" | "30d" | "90d" | "custom";
}): { from: string; to: string } {
  if (input.from && input.to && DATE_ONLY.test(input.from) && DATE_ONLY.test(input.to)) {
    return { from: input.from, to: input.to };
  }
  const resolved = resolveDateRange(input);
  return { from: toBusinessCalendarDate(resolved.from), to: toBusinessCalendarDate(resolved.to) };
}
