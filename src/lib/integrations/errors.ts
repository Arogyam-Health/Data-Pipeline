export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export class WebhookAuthError extends IntegrationError {
  constructor(provider: string) {
    super("Webhook authentication failed", provider, "AUTH_FAILED", false);
    this.name = "WebhookAuthError";
  }
}

export class DuplicateEventError extends IntegrationError {
  constructor(provider: string, requestHash: string) {
    super(
      `Duplicate event detected (hash: ${requestHash})`,
      provider,
      "DUPLICATE",
      false
    );
    this.name = "DuplicateEventError";
  }
}

export class PayloadParseError extends IntegrationError {
  constructor(provider: string, detail: string) {
    super(
      `Failed to parse webhook payload: ${detail}`,
      provider,
      "PARSE_ERROR",
      false
    );
    this.name = "PayloadParseError";
  }
}

export class QueueError extends IntegrationError {
  constructor(provider: string, detail: string) {
    super(`Queue operation failed: ${detail}`, provider, "QUEUE_ERROR", true);
    this.name = "QueueError";
  }
}

export class ExternalServiceError extends IntegrationError {
  constructor(provider: string, service: string, detail: string) {
    super(
      `External service error (${service}): ${detail}`,
      provider,
      "EXTERNAL_SERVICE_ERROR",
      true
    );
    this.name = "ExternalServiceError";
  }
}
