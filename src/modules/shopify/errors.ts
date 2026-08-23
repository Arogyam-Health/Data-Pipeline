export const SHOPIFY_AUTH_FAILURE_MESSAGE =
  "Shopify authorization failed. Verify SHOPIFY_ACCESS_TOKEN and currently granted app scopes. Existing Google Apps Script configuration was not modified.";

export class ShopifyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ShopifyError";
  }
}

export class ShopifyAuthError extends ShopifyError {
  constructor(message = SHOPIFY_AUTH_FAILURE_MESSAGE, retryable = false) {
    super(sanitizeShopifyError(message), "AUTH_FAILED", retryable);
    this.name = "ShopifyAuthError";
  }
}

export class ShopifySyncDisabledError extends ShopifyError {
  constructor() {
    super(
      "Shopify sync is disabled. Set SHOPIFY_SYNC_ENABLED=true to run synchronization.",
      "SYNC_DISABLED",
      false
    );
    this.name = "ShopifySyncDisabledError";
  }
}

export class ShopifySyncLockError extends ShopifyError {
  constructor(shopDomain: string) {
    super(
      `A Shopify sync is already running for ${shopDomain}.`,
      "SYNC_IN_PROGRESS",
      false
    );
    this.name = "ShopifySyncLockError";
  }
}

export class ShopifySyncConflictError extends ShopifyError {
  constructor(message: string) {
    super(message, "SYNC_CONFLICT", false);
    this.name = "ShopifySyncConflictError";
  }
}

export class ShopifyConfigError extends ShopifyError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", false);
    this.name = "ShopifyConfigError";
  }
}

const SECRET_PATTERNS = [
  /shpat_[A-Za-z0-9]+/g,
  /shpss_[A-Za-z0-9]+/g,
  /shpua_[A-Za-z0-9]+/g,
  /access_token=[^&\s]+/gi,
  /client_secret=[^&\s]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

export function sanitizeShopifyError(message: string): string {
  let sanitized = message;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]");
}
