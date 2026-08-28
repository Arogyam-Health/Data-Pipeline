import { NextResponse } from "next/server";
import { z } from "zod";
import { addCalendarDays, formatDateInTimeZone, isValidIsoDate } from "./dates";
import {
  MetaAuthError,
  MetaError,
  MetaSyncConflictError,
  MetaSyncDisabledError,
  MetaSyncLockError,
  sanitizeMetaError,
} from "./errors";

export function metaErrorResponse(err: unknown): NextResponse {
  if (err instanceof MetaSyncLockError || err instanceof MetaSyncConflictError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 409 });
  }
  if (err instanceof MetaSyncDisabledError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 409 });
  }
  if (err instanceof MetaAuthError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 401 });
  }
  if (err instanceof MetaError) {
    const status =
      err.code === "CONFIG_ERROR" || err.code === "VALIDATION_ERROR" ? 400 : err.status ?? 500;
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
  }
  const message = sanitizeMetaError(err instanceof Error ? err.message : "Internal server error");
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional()
);

const optionalNumber = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) return undefined;
  return value;
}, z.coerce.number().finite().optional());

export const dashboardRangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  range: z.enum(["today", "7d", "30d", "90d", "custom"]).optional(),
  campaignId: optionalText,
  adsetId: optionalText,
  adId: optionalText,
  objective: optionalText,
  search: optionalText,
  purchaseStatus: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["all", "with", "without"]).optional()
  ),
  videoStatus: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["all", "has_video"]).optional()
  ),
  funnelStatus: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["all", "has_lpv", "has_atc", "has_checkout"]).optional()
  ),
  messagingStatus: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["all", "with", "without"]).optional()
  ),
  minSpend: optionalNumber,
  maxSpend: optionalNumber,
  minRoas: optionalNumber,
  maxRoas: optionalNumber,
  minFrequency: optionalNumber,
  maxFrequency: optionalNumber,
  minPurchases: optionalNumber,
  sort: z.enum(["spend", "purchases", "roas", "ctr", "frequency", "name"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

export function parseMetaFilters(input: z.infer<typeof dashboardRangeSchema>) {
  return {
    campaignId: input.campaignId,
    adsetId: input.adsetId,
    adId: input.adId,
    objective: input.objective,
    search: input.search,
    purchaseStatus: input.purchaseStatus,
    videoStatus: input.videoStatus,
    funnelStatus: input.funnelStatus,
    messagingStatus: input.messagingStatus,
    minSpend: input.minSpend,
    maxSpend: input.maxSpend,
    minRoas: input.minRoas,
    maxRoas: input.maxRoas,
    minFrequency: input.minFrequency,
    maxFrequency: input.maxFrequency,
    minPurchases: input.minPurchases,
    sort: input.sort,
    dir: input.dir,
  };
}

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
      throw new MetaError("Dates must use YYYY-MM-DD", "VALIDATION_ERROR", false);
    }
    if (from > to) {
      throw new MetaError("from must be before to", "VALIDATION_ERROR", false);
    }
    return { from, to };
  }
  if (input.range === "today") return { from: today, to: today };
  const days = input.range === "7d" ? 7 : input.range === "90d" ? 90 : 30;
  return { from: addCalendarDays(today, -(days - 1)), to: today };
}

export function publicSyncResult(result: {
  runId: string;
  requestedFrom: string | null;
  requestedTo: string | null;
  rowsFetched: number;
  rowsInserted: number;
  rowsUpdated: number;
  actionsUpserted: number;
  pagesFetched: number;
  apiRequests: number;
  retryCount: number;
  durationMs: number;
  status: string;
  mode: string;
  warning?: string | null;
}) {
  return {
    runId: result.runId,
    mode: result.mode,
    status: result.status,
    since: result.requestedFrom,
    until: result.requestedTo,
    rowsFetched: result.rowsFetched,
    rowsInserted: result.rowsInserted,
    rowsUpdated: result.rowsUpdated,
    actionsUpserted: result.actionsUpserted,
    pagesFetched: result.pagesFetched,
    apiRequests: result.apiRequests,
    retryCount: result.retryCount,
    duration: result.durationMs,
    warning: result.warning ?? null,
  };
}
