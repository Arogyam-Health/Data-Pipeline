import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ShopifyAuthError,
  ShopifyError,
  ShopifySyncConflictError,
  ShopifySyncDisabledError,
  ShopifySyncLockError,
  sanitizeShopifyError,
} from "./errors";

export function shopifyErrorResponse(err: unknown): NextResponse {
  if (err instanceof ShopifySyncLockError || err instanceof ShopifySyncConflictError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 409 });
  }
  if (err instanceof ShopifySyncDisabledError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 409 });
  }
  if (err instanceof ShopifyAuthError) {
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 401 });
  }
  if (err instanceof ShopifyError) {
    const status = err.code === "CONFIG_ERROR" || err.code === "VALIDATION_ERROR" ? 400 : 500;
    return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
  }
  const message = sanitizeShopifyError(err instanceof Error ? err.message : "Internal server error");
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  range: z.enum(["7d", "30d", "90d", "custom"]).optional(),
});

export function resolveDateRange(input: {
  from?: string;
  to?: string;
  range?: "7d" | "30d" | "90d" | "custom";
}): { from: string; to: string } {
  const to = input.to ? new Date(input.to) : new Date();
  if (Number.isNaN(to.getTime())) {
    throw new ShopifyError("Invalid to date", "VALIDATION_ERROR", false);
  }
  if (input.from) {
    const from = new Date(input.from);
    if (Number.isNaN(from.getTime())) {
      throw new ShopifyError("Invalid from date", "VALIDATION_ERROR", false);
    }
    if (from > to) {
      throw new ShopifyError("from must be before to", "VALIDATION_ERROR", false);
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const days = input.range === "7d" ? 7 : input.range === "90d" ? 90 : 30;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}
