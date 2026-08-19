export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export class PayloadParseError extends IntegrationError {
  constructor(provider: string, detail: string) {
    super(`Failed to parse webhook payload: ${detail}`, provider, "PARSE_ERROR", false);
    this.name = "PayloadParseError";
  }
}
