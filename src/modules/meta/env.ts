import { z } from "zod";
import {
  DEFAULT_API_VERSION,
  DEFAULT_BACKFILL_CHUNK_DAYS,
  DEFAULT_BACKFILL_DAYS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_PAGE_LIMIT,
  DEFAULT_RECENT_REPAIR_DAYS,
} from "./constants";
import { MetaConfigError } from "./errors";

const adAccountIdSchema = z
  .string()
  .min(1)
  .transform((value) => {
    const trimmed = value.trim();
    if (/^act_\d+$/.test(trimmed)) return trimmed;
    if (/^\d+$/.test(trimmed)) return `act_${trimmed}`;
    throw new Error("META_AD_ACCOUNT_ID must look like act_123 or 123");
  });

const metaEnvSchema = z.object({
  META_ACCESS_TOKEN: z.string().min(1),
  META_AD_ACCOUNT_ID: adAccountIdSchema,
  META_API_VERSION: z.string().min(1).default(DEFAULT_API_VERSION),
  META_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  META_INTERNAL_SYNC_SECRET: z.string().min(1),
  META_BACKFILL_DAYS: z.coerce.number().int().positive().default(DEFAULT_BACKFILL_DAYS),
  META_BACKFILL_CHUNK_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_BACKFILL_CHUNK_DAYS),
  META_PAGE_LIMIT: z.coerce.number().int().min(1).max(1000).default(DEFAULT_PAGE_LIMIT),
  META_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(DEFAULT_MAX_RETRIES),
  META_RECENT_REPAIR_DAYS: z.coerce
    .number()
    .int()
    .min(0)
    .max(14)
    .default(DEFAULT_RECENT_REPAIR_DAYS),
  META_EXTENDED_INSIGHTS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  META_METADATA_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  META_BREAKDOWN_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type MetaEnv = z.infer<typeof metaEnvSchema>;

let _env: MetaEnv | null = null;

export function resetMetaEnvCache(): void {
  _env = null;
}

export function getMetaEnv(overrides?: Record<string, string | undefined>): MetaEnv {
  if (_env && !overrides) return _env;

  const source = overrides ?? process.env;
  const result = metaEnvSchema.safeParse(source);

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

    throw new MetaConfigError(
      `Meta environment validation failed:\n${missing.join("\n")}\n\n` +
        "Copy .env.example to .env and fill in the Meta placeholders. Never commit real secrets."
    );
  }

  if (!overrides) {
    _env = result.data;
  }
  return result.data;
}

export function isMetaSyncEnabled(env?: MetaEnv): boolean {
  return (env ?? getMetaEnv()).META_SYNC_ENABLED;
}

export function getMetaAccessToken(env?: MetaEnv): string {
  const token = (env ?? getMetaEnv()).META_ACCESS_TOKEN;
  if (!token) {
    throw new MetaConfigError(
      "META_ACCESS_TOKEN is missing. Copy the existing authorized token into the private server environment."
    );
  }
  return token;
}

export function getMetaAdAccountId(env?: MetaEnv): string {
  return (env ?? getMetaEnv()).META_AD_ACCOUNT_ID;
}
