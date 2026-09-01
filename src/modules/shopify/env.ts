import { z } from "zod";
import {
  DEFAULT_API_VERSION,
  DEFAULT_BACKFILL_CHUNK_DAYS,
  DEFAULT_BACKFILL_DAYS,
  DEFAULT_INCREMENTAL_BUFFER_MINUTES,
  DEFAULT_MAX_FETCH_RETRIES,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  DEFAULT_MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TEST_FETCH_DAYS,
} from "./constants";
import { ShopifyConfigError } from "./errors";

const shopifyEnvSchema = z.object({
  SHOPIFY_SHOP_DOMAIN: z
    .string()
    .min(1)
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/$/, "")),
  SHOPIFY_ACCESS_TOKEN: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().min(1).default(DEFAULT_API_VERSION),
  SHOPIFY_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SHOPIFY_INTERNAL_SYNC_SECRET: z.string().min(1),
  SHOPIFY_BACKFILL_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_BACKFILL_DAYS),
  SHOPIFY_TEST_FETCH_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_TEST_FETCH_DAYS),
  SHOPIFY_INCREMENTAL_BUFFER_MINUTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_INCREMENTAL_BUFFER_MINUTES),
  SHOPIFY_PAGE_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(DEFAULT_MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  SHOPIFY_MAX_FETCH_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .max(8)
    .default(DEFAULT_MAX_FETCH_RETRIES),
  SHOPIFY_BACKFILL_CHUNK_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_BACKFILL_CHUNK_DAYS),
  SHOPIFY_SYNC_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(180)
    .default(DEFAULT_SYNC_INTERVAL_MINUTES),
  SHOPIFY_SYNC_DEBUG: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type ShopifyEnv = z.infer<typeof shopifyEnvSchema>;

let _env: ShopifyEnv | null = null;

export function resetShopifyEnvCache(): void {
  _env = null;
}

export function getShopifyEnv(overrides?: Record<string, string | undefined>): ShopifyEnv {
  if (_env && !overrides) return _env;

  const source = overrides ?? process.env;
  const result = shopifyEnvSchema.safeParse(source);

  if (!result.success) {
    const formatted = result.error.format();
    const missing = Object.keys(formatted)
      .filter((k) => k !== "_errors")
      .map((k) => {
        const field = formatted[k as keyof typeof formatted];
        const errors =
          field && typeof field === "object" && "_errors" in field
            ? (field as { _errors?: string[] })._errors?.join(", ")
            : undefined;
        return `  ${k}: ${errors || "missing"}`;
      });

    throw new ShopifyConfigError(
      `Shopify environment validation failed:\n${missing.join("\n")}\n\n` +
        "Copy .env.example to .env and fill in the Shopify placeholders. Never commit real secrets."
    );
  }

  if (!overrides) {
    _env = result.data;
  }
  return result.data;
}

export function isShopifySyncEnabled(env?: ShopifyEnv): boolean {
  return (env ?? getShopifyEnv()).SHOPIFY_SYNC_ENABLED;
}
