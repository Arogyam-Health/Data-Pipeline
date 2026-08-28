import {
  AUTH_MODE,
  FORBIDDEN_PRIVATE_KEY_ENV,
  GA4_READONLY_SCOPE,
  GOOGLE_STS_TOKEN_URL,
  SUBJECT_TOKEN_TYPE,
} from "./constants";
import { getGa4Env, type Ga4Env } from "./env";
import { Ga4AuthError, Ga4ConfigError, GA4_OIDC_MISSING_MESSAGE } from "./errors";
import type { ExternalAccountConfig, SubjectTokenSupplier } from "./types";

export interface Ga4AuthOptions {
  env?: Ga4Env;
  getSubjectToken?: () => Promise<string>;
}

let cachedClient: { client: GoogleAuthLike; expiresAt: number } | null = null;

export interface GoogleAuthLike {
  getAccessToken: () => Promise<{ token?: string | null } | string | null | undefined>;
  request?: <T>(opts: { url: string; method?: string; data?: unknown; headers?: Record<string, string> }) => Promise<{ data: T }>;
}

export function buildWifAudience(env: Pick<Ga4Env, "GCP_PROJECT_NUMBER" | "GCP_WORKLOAD_IDENTITY_POOL_ID" | "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID">): string {
  return `//iam.googleapis.com/projects/${env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${env.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`;
}

export function buildServiceAccountImpersonationUrl(email: string): string {
  return `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`;
}

export function assertNoPrivateKeyConfig(config: Record<string, unknown>): void {
  const forbidden = ["private_key", "private_key_id", "client_secret"];
  for (const key of forbidden) {
    if (key in config) {
      throw new Ga4ConfigError("GA4 WIF config must not include a private key.");
    }
  }
}

export function forbiddenPrivateKeyEnvNames(): string[] {
  return [...FORBIDDEN_PRIVATE_KEY_ENV];
}

export function ga4ReadsPrivateKeyEnvVars(): string[] {
  return [];
}

export async function getDefaultSubjectToken(): Promise<string> {
  try {
    const { getVercelOidcToken } = await import("@vercel/oidc");
    const token = await getVercelOidcToken();
    if (!token || typeof token !== "string") {
      throw new Ga4AuthError(GA4_OIDC_MISSING_MESSAGE);
    }
    return token;
  } catch (err) {
    if (err instanceof Ga4AuthError) throw err;
    throw new Ga4AuthError(GA4_OIDC_MISSING_MESSAGE);
  }
}

export function buildExternalAccountConfig(
  env: Ga4Env,
  getSubjectToken: () => Promise<string>
): ExternalAccountConfig {
  const config: ExternalAccountConfig = {
    type: "external_account",
    audience: buildWifAudience(env),
    subject_token_type: SUBJECT_TOKEN_TYPE,
    token_url: GOOGLE_STS_TOKEN_URL,
    service_account_impersonation_url: buildServiceAccountImpersonationUrl(env.GCP_SERVICE_ACCOUNT_EMAIL),
    scopes: [GA4_READONLY_SCOPE],
    subject_token_supplier: {
      getSubjectToken,
    },
  };
  assertNoPrivateKeyConfig(config as unknown as Record<string, unknown>);
  return config;
}

export function createRuntimeSubjectTokenSupplier(
  getSubjectToken: () => Promise<string>
): SubjectTokenSupplier {
  return {
    getSubjectToken: async () => getSubjectToken(),
  };
}

export async function createGa4AuthClient(opts: Ga4AuthOptions = {}): Promise<GoogleAuthLike> {
  const env = opts.env ?? getGa4Env();
  const getSubjectToken = opts.getSubjectToken ?? getDefaultSubjectToken;
  const config = buildExternalAccountConfig(env, getSubjectToken);
  const { ExternalAccountClient } = await import("google-auth-library");
  const client = ExternalAccountClient.fromJSON(config as unknown as Parameters<typeof ExternalAccountClient.fromJSON>[0]);
  if (!client) {
    throw new Ga4AuthError("Failed to construct the Google WIF external-account client.");
  }
  return client as GoogleAuthLike;
}

export async function getGa4AuthClient(opts: Ga4AuthOptions = {}): Promise<GoogleAuthLike> {
  if (opts.getSubjectToken || opts.env) {
    return createGa4AuthClient(opts);
  }
  if (cachedClient && cachedClient.expiresAt > Date.now() + 60_000) {
    return cachedClient.client;
  }
  const client = await createGa4AuthClient(opts);
  cachedClient = { client, expiresAt: Date.now() + 50 * 60 * 1000 };
  return client;
}

export async function getGoogleAccessToken(opts: Ga4AuthOptions = {}): Promise<string> {
  const client = await getGa4AuthClient(opts);
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result?.token;
  if (!token) {
    throw new Ga4AuthError(GA4_OIDC_MISSING_MESSAGE);
  }
  return token;
}

export function getAuthMode(): typeof AUTH_MODE {
  return AUTH_MODE;
}

export function resetGa4AuthCache(): void {
  cachedClient = null;
}
