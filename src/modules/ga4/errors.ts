import type { Ga4ErrorClass } from "./types";

export const GA4_AUTH_FAILURE_MESSAGE =
  "GA4 authentication failed. Vercel OIDC + Google Workload Identity Federation is required. No Google private key fallback exists.";

export const GA4_OIDC_MISSING_MESSAGE =
  "Vercel OIDC token is unavailable. Link the project with `vercel link` and `vercel env pull`, or deploy to Vercel. Service-account JSON keys are not supported.";

export class Ga4Error extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly status?: number,
    public readonly classification: Ga4ErrorClass = "other"
  ) {
    super(message);
    this.name = "Ga4Error";
  }
}

export class Ga4AuthError extends Ga4Error {
  constructor(message = GA4_AUTH_FAILURE_MESSAGE) {
    super(sanitizeGa4Error(message), "AUTH_FAILED", false, 401, "authentication");
    this.name = "Ga4AuthError";
  }
}

export class Ga4PermissionError extends Ga4Error {
  constructor(message = "GA4 property access was denied. Add the service account as Viewer on the GA4 property.") {
    super(sanitizeGa4Error(message), "PERMISSION_DENIED", false, 403, "permission");
    this.name = "Ga4PermissionError";
  }
}

export class Ga4SyncDisabledError extends Ga4Error {
  constructor() {
    super(
      "GA4 sync is disabled. Set GA4_SYNC_ENABLED=true to run scheduled synchronization.",
      "SYNC_DISABLED",
      false,
      409
    );
    this.name = "Ga4SyncDisabledError";
  }
}

export class Ga4SyncLockError extends Ga4Error {
  constructor(propertyId: string, dataset: string) {
    super(
      `A GA4 ${dataset} sync is already running for property ${propertyId}.`,
      "SYNC_IN_PROGRESS",
      false,
      409
    );
    this.name = "Ga4SyncLockError";
  }
}

export class Ga4SyncConflictError extends Ga4Error {
  constructor(message: string) {
    super(message, "SYNC_CONFLICT", false, 409);
    this.name = "Ga4SyncConflictError";
  }
}

export class Ga4ConfigError extends Ga4Error {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", false, 400);
    this.name = "Ga4ConfigError";
  }
}

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
  /VERCEL_OIDC_TOKEN=[^\s"']+/gi,
  /access_token=[^&\s"']+/gi,
  /Authorization:\s*[^\s"']+/gi,
  /GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=[^\s"']+/gi,
  /GOOGLE_SERVICE_ACCOUNT_JSON=[^\s"']+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

export function sanitizeGa4Error(message: string): string {
  let sanitized = message;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}

export function classifyGa4Error(input: {
  status?: number;
  message?: string;
}): Ga4ErrorClass {
  const status = input.status ?? 0;
  const text = (input.message ?? "").toLowerCase();

  if (status === 401 || text.includes("unauthenticated") || text.includes("invalid credentials")) {
    return "authentication";
  }
  if (status === 403 || text.includes("permission") || text.includes("forbidden")) {
    return "permission";
  }
  if (
    status === 429 ||
    text.includes("resource exhausted") ||
    text.includes("quota") ||
    text.includes("too many requests") ||
    text.includes("rate")
  ) {
    return "rate_limit";
  }
  if (text.includes("invalid dimension") || text.includes("unknown dimension")) {
    return "invalid_dimension";
  }
  if (text.includes("invalid metric") || text.includes("unknown metric")) {
    return "invalid_metric";
  }
  if (status === 400 || text.includes("invalid argument") || text.includes("invalid property")) {
    return "invalid_argument";
  }
  if (text.includes("deadline") || text.includes("timeout") || text.includes("timed out")) {
    return "timeout";
  }
  if (
    status === 500 ||
    status === 503 ||
    text.includes("backend error") ||
    text.includes("internal error") ||
    text.includes("service unavailable")
  ) {
    return "server";
  }
  return "other";
}

export function isRetryableGa4Failure(input: {
  status?: number;
  message?: string;
  classification?: Ga4ErrorClass;
}): boolean {
  const classification = input.classification ?? classifyGa4Error(input);
  if (
    classification === "authentication" ||
    classification === "permission" ||
    classification === "invalid_argument" ||
    classification === "invalid_dimension" ||
    classification === "invalid_metric"
  ) {
    return false;
  }
  const status = input.status ?? 0;
  const text = (input.message ?? "").toLowerCase();
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    classification === "rate_limit" ||
    classification === "server" ||
    classification === "timeout" ||
    text.includes("resource exhausted") ||
    text.includes("quota") ||
    text.includes("too many requests") ||
    text.includes("deadline") ||
    text.includes("timeout")
  );
}
