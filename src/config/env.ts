import { z } from "zod";

const envSchema = z.object({
  // Required secrets
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SHIPROCKET_WEBHOOK_SECRET: z.string().min(1),
  WORKER_SECRET: z.string().min(1),

  // Optional
  PABBLY_SHIPROCKET_URL: z.string().url().or(z.literal("")).optional(),
  SHIPROCKET_PABBLY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Existing Apps Script Web App URL. Used only to fan-out the raw webhook. */
  SHIPROCKET_APPS_SCRIPT_WEBHOOK_URL: z.string().url().or(z.literal("")).optional(),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

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

    throw new Error(
      `Environment validation failed:\n${missing.join("\n")}\n\n` +
        "Copy .env.example to .env and fill in the required values."
    );
  }

  _env = result.data;
  return _env;
}
