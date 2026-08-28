import { z } from "zod";
import {
  DEFAULT_API_PAGE_LIMIT,
  DEFAULT_BASE_RETRY_MS,
  DEFAULT_CHANNEL_BACKFILL_CHUNK_DAYS,
  DEFAULT_CHANNEL_BACKFILL_DAYS,
  DEFAULT_DAILY_BACKFILL_CHUNK_DAYS,
  DEFAULT_DAILY_BACKFILL_DAYS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RECENT_DAYS_BACK,
  DEFAULT_UTM_BACKFILL_CHUNK_DAYS,
  DEFAULT_UTM_BACKFILL_START_DATE,
} from "./constants";
import { Ga4ConfigError } from "./errors";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "must be a valid date");

const ga4EnvSchema = z.object({
  GA4_PROPERTY_ID: z.string().min(1),
  GCP_PROJECT_ID: z.string().min(1),
  GCP_PROJECT_NUMBER: z.string().min(1),
  GCP_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GCP_WORKLOAD_IDENTITY_POOL_ID: z.string().min(1),
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: z.string().min(1),
  GA4_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  GA4_INTERNAL_SYNC_SECRET: z.string().min(1),
  GA4_DAILY_BACKFILL_DAYS: z.coerce.number().int().positive().default(DEFAULT_DAILY_BACKFILL_DAYS),
  GA4_DAILY_BACKFILL_CHUNK_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_DAILY_BACKFILL_CHUNK_DAYS),
  GA4_CHANNEL_BACKFILL_DAYS: z.coerce.number().int().positive().default(DEFAULT_CHANNEL_BACKFILL_DAYS),
  GA4_CHANNEL_BACKFILL_CHUNK_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_CHANNEL_BACKFILL_CHUNK_DAYS),
  GA4_UTM_BACKFILL_START_DATE: isoDate.default(DEFAULT_UTM_BACKFILL_START_DATE),
  GA4_UTM_BACKFILL_CHUNK_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_UTM_BACKFILL_CHUNK_DAYS),
  GA4_RECENT_DAYS_BACK: z.coerce.number().int().min(0).max(14).default(DEFAULT_RECENT_DAYS_BACK),
  GA4_API_PAGE_LIMIT: z.coerce.number().int().min(1).max(250000).default(DEFAULT_API_PAGE_LIMIT),
  GA4_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(DEFAULT_MAX_RETRIES),
  GA4_BASE_RETRY_MS: z.coerce.number().int().positive().default(DEFAULT_BASE_RETRY_MS),
  GA4_REPORTING_TIMEZONE: z.string().optional().default(""),
  GA4_CURRENCY: z.string().optional().default(""),
});

export type Ga4Env = z.infer<typeof ga4EnvSchema>;

let _env: Ga4Env | null = null;

export function resetGa4EnvCache(): void {
  _env = null;
}

export function getGa4Env(overrides?: Record<string, string | undefined>): Ga4Env {
  if (_env && !overrides) return _env;

  const source = overrides ?? process.env;
  const result = ga4EnvSchema.safeParse(source);

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

    throw new Ga4ConfigError(
      `GA4 environment validation failed:\n${missing.join("\n")}\n\n` +
        "Copy .env.example to .env and fill the GA4 / GCP WIF placeholders. Never commit real secrets. Do not use a Google private key."
    );
  }

  if (!overrides) {
    _env = result.data;
  }
  return result.data;
}

export function isGa4SyncEnabled(env?: Ga4Env): boolean {
  return (env ?? getGa4Env()).GA4_SYNC_ENABLED;
}

export function normalizePropertyId(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("properties/") ? trimmed.slice("properties/".length) : trimmed;
}

export function getGa4PropertyId(env?: Ga4Env): string {
  return normalizePropertyId((env ?? getGa4Env()).GA4_PROPERTY_ID);
}

export function ga4EnvUsesPrivateKey(): boolean {
  return false;
}
