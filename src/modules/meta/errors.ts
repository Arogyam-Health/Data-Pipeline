import type { MetaErrorClass } from "./types";

export const META_AUTH_FAILURE_MESSAGE =
  "Meta authorization failed. Verify META_ACCESS_TOKEN and META_AD_ACCOUNT_ID. Existing Google Apps Script configuration was not modified.";

export class MetaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly status?: number,
    public readonly classification: MetaErrorClass = "other"
  ) {
    super(message);
    this.name = "MetaError";
  }
}

export class MetaAuthError extends MetaError {
  constructor(message = META_AUTH_FAILURE_MESSAGE, retryable = false) {
    super(sanitizeMetaError(message), "AUTH_FAILED", retryable, 401, "authentication");
    this.name = "MetaAuthError";
  }
}

export class MetaPermissionError extends MetaError {
  constructor(message = META_AUTH_FAILURE_MESSAGE) {
    super(sanitizeMetaError(message), "PERMISSION_DENIED", false, 403, "permission");
    this.name = "MetaPermissionError";
  }
}

export class MetaSyncDisabledError extends MetaError {
  constructor() {
    super(
      "Meta sync is disabled. Set META_SYNC_ENABLED=true to run scheduled synchronization.",
      "SYNC_DISABLED",
      false,
      409
    );
    this.name = "MetaSyncDisabledError";
  }
}

export class MetaSyncLockError extends MetaError {
  constructor(adAccountId: string) {
    super(
      `A Meta sync is already running for ${adAccountId}.`,
      "SYNC_IN_PROGRESS",
      false,
      409
    );
    this.name = "MetaSyncLockError";
  }
}

export class MetaSyncConflictError extends MetaError {
  constructor(message: string) {
    super(message, "SYNC_CONFLICT", false, 409);
    this.name = "MetaSyncConflictError";
  }
}

export class MetaConfigError extends MetaError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", false, 400);
    this.name = "MetaConfigError";
  }
}

export class MetaInvalidFieldError extends MetaError {
  constructor(message: string) {
    super(sanitizeMetaError(message), "INVALID_FIELD", false, 400, "invalid_field");
    this.name = "MetaInvalidFieldError";
  }
}

const SECRET_PATTERNS = [
  /EAA[A-Za-z0-9]+/g,
  /access_token=[^&\s"']+/gi,
  /client_secret=[^&\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /META_ACCESS_TOKEN=[^\s"']+/gi,
  /META_V2_ACCESS_TOKEN=[^\s"']+/gi,
];

export function sanitizeMetaError(message: string): string {
  let sanitized = message;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  sanitized = sanitized.replace(/https?:\/\/[^\s"']*access_token[^\s"']*/gi, "[REDACTED_URL]");
  return sanitized;
}

export function stripAccessTokenFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("access_token");
    parsed.searchParams.delete("appsecret_proof");
    return parsed.toString();
  } catch {
    return url.replace(/([?&])access_token=[^&]*/gi, "$1access_token=[REDACTED]");
  }
}

export function classifyMetaError(input: {
  status?: number;
  code?: number;
  message?: string;
}): MetaErrorClass {
  const status = input.status ?? 0;
  const code = input.code ?? 0;
  const text = (input.message ?? "").toLowerCase();

  if (status === 401 || code === 190 || text.includes("invalid oauth") || text.includes("session has expired")) {
    return "authentication";
  }
  if (status === 403 || code === 10 || code === 200 || text.includes("permission")) {
    return "permission";
  }
  if (
    status === 429 ||
    [4, 17, 32, 613, 80004].includes(code) ||
    text.includes("rate") ||
    text.includes("quota") ||
    text.includes("too many")
  ) {
    return "rate_limit";
  }
  if (
    status === 400 &&
    (code === 100 ||
      code === 2500 ||
      text.includes("unknown field") ||
      text.includes("nonexisting field") ||
      text.includes("tried accessing nonexisting"))
  ) {
    return "invalid_field";
  }
  if (status === 400 || code === 100) {
    return "invalid_parameter";
  }
  if (status >= 500 || text.includes("temporarily unavailable")) {
    return "server";
  }
  return "other";
}

export function isRetryableMetaFailure(input: {
  status?: number;
  message?: string;
  classification?: MetaErrorClass;
}): boolean {
  if (
    input.classification === "authentication" ||
    input.classification === "permission" ||
    input.classification === "invalid_field" ||
    input.classification === "invalid_parameter"
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
    text.includes("rate") ||
    text.includes("quota") ||
    text.includes("temporarily unavailable") ||
    text.includes("please reduce the amount of data")
  );
}
