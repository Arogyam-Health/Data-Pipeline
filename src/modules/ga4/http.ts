import { NextResponse } from "next/server";
import { z } from "zod";
import { addCalendarDays, formatDateInTimeZone, isValidIsoDate } from "./dates";
import {
  Ga4AuthError,
  Ga4Error,
  Ga4SyncConflictError,
  Ga4SyncDisabledError,
  Ga4SyncLockError,
  sanitizeGa4Error,
} from "./errors";
import type { SyncRunResult } from "./types";

export function ga4ErrorResponse(err: unknown): NextResponse {
  if (err instanceof Ga4SyncLockError || err instanceof Ga4SyncConflictError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 409 });
  }
  if (err instanceof Ga4SyncDisabledError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code, disabled: true }, { status: 409 });
  }
  if (err instanceof Ga4AuthError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 401 });
  }
  if (err instanceof Ga4Error) {
    const status =
      err.code === "CONFIG_ERROR" || err.code === "VALIDATION_ERROR" ? 400 : err.status ?? 500;
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
  }
  const message = sanitizeGa4Error(err instanceof Error ? err.message : "Internal server error");
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional()
);

export const dashboardRangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  range: z.enum(["today", "7d", "30d", "90d", "custom"]).optional(),
  channel: optionalText,
  source: optionalText,
  campaign: optionalText,
  medium: optionalText,
  content: optionalText,
  sort: z.enum(["revenue", "sessions", "users", "purchases", "conversion"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export function resolveDashboardDateRange(input: {
  from?: string;
  to?: string;
  range?: "today" | "7d" | "30d" | "90d" | "custom";
  timeZone?: string;
}): { from: string; to: string } {
  const timeZone = input.timeZone || "UTC";
  const today = formatDateInTimeZone(new Date(), timeZone);
  if (input.from || input.to) {
    const from = input.from ?? today;
    const to = input.to ?? today;
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
      throw new Ga4Error("Dates must use YYYY-MM-DD", "VALIDATION_ERROR", false);
    }
    if (from > to) {
      throw new Ga4Error("from must be before to", "VALIDATION_ERROR", false);
    }
    return { from, to };
  }
  if (input.range === "today") return { from: today, to: today };
  const days = input.range === "7d" ? 7 : input.range === "90d" ? 90 : 30;
  return { from: addCalendarDays(today, -(days - 1)), to: today };
}

export function publicSyncResult(result: SyncRunResult) {
  return {
    runId: result.runId,
    dataset: result.dataset,
    mode: result.mode,
    status: result.status,
    since: result.requestedFrom,
    until: result.requestedTo,
    baseRowsFetched: result.baseRowsFetched,
    ecommerceRowsFetched: result.ecommerceRowsFetched,
    rowsUpserted: result.rowsUpserted,
    apiRequests: result.apiRequests,
    pagesFetched: result.pagesFetched,
    retryCount: result.retryCount,
    durationMs: result.durationMs,
    warning: result.warning ?? null,
    resumable: result.resumable ?? false,
  };
}
