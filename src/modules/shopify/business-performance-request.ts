import { datePickerRangeToTimestamps } from "@/lib/date-range";
import type { BusinessPerformanceLevel } from "./business-performance";

export function buildBusinessPerformanceQuery(input: {
  embedded: boolean;
  from?: string;
  to?: string;
  range: "7d" | "30d" | "90d" | "custom";
  customFrom: string;
  customTo: string;
  level: BusinessPerformanceLevel;
  parents: Record<string, string>;
}): URLSearchParams {
  if (input.embedded) {
    const params = new URLSearchParams({ range: "custom", level: input.level, ...input.parents });
    if (input.from && input.to) {
      params.set("from", input.from);
      params.set("to", input.to);
    }
    return params;
  }

  const params = new URLSearchParams({ range: input.range, level: input.level, ...input.parents });
  if (input.range === "custom" && input.customFrom && input.customTo) {
    const timestamps = datePickerRangeToTimestamps(input.customFrom, input.customTo);
    params.set("from", timestamps.from);
    params.set("to", timestamps.to);
  }
  return params;
}

export function isLatestBusinessPerformanceRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}
