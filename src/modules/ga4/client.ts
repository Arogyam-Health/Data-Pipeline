import { GA4_DATA_API_BASE, INTEGRATION, MAX_PAGING_PAGES } from "./constants";
import { getGa4Env, getGa4PropertyId, type Ga4Env } from "./env";
import {
  Ga4AuthError,
  Ga4Error,
  Ga4PermissionError,
  classifyGa4Error,
  isRetryableGa4Failure,
  sanitizeGa4Error,
} from "./errors";
import { logger } from "@/lib/logger";
import { nextOffset, shouldStopPaging } from "./pagination";
import { parseRetryAfterMs, retryDelayMs } from "./retry";
import { getGoogleAccessToken, type Ga4AuthOptions } from "./auth";
import type { DateRange, Ga4CompatibilityResponse, Ga4ReportResponse } from "./types";

export interface Ga4ClientOptions extends Ga4AuthOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  getAccessToken?: () => Promise<string>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Ga4DataClient {
  readonly env: Ga4Env;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly authOptions: Ga4AuthOptions;
  private readonly getAccessTokenImpl?: () => Promise<string>;
  apiRequests = 0;
  retryCount = 0;
  pagesFetched = 0;

  constructor(opts: Ga4ClientOptions = {}) {
    this.env = opts.env ?? getGa4Env();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.authOptions = { env: this.env, getSubjectToken: opts.getSubjectToken };
    this.getAccessTokenImpl = opts.getAccessToken;
  }

  propertyPath(propertyId = getGa4PropertyId(this.env)): string {
    return `${GA4_DATA_API_BASE}/properties/${propertyId}`;
  }

  runReportUrl(propertyId = getGa4PropertyId(this.env)): string {
    return `${this.propertyPath(propertyId)}:runReport`;
  }

  checkCompatibilityUrl(propertyId = getGa4PropertyId(this.env)): string {
    return `${this.propertyPath(propertyId)}:checkCompatibility`;
  }

  async runReport(
    body: Record<string, unknown>,
    propertyId = getGa4PropertyId(this.env)
  ): Promise<Ga4ReportResponse> {
    return this.request<Ga4ReportResponse>(this.runReportUrl(propertyId), body);
  }

  async checkCompatibility(
    body: Record<string, unknown>,
    propertyId = getGa4PropertyId(this.env)
  ): Promise<Ga4CompatibilityResponse> {
    return this.request<Ga4CompatibilityResponse>(this.checkCompatibilityUrl(propertyId), body);
  }

  async fetchReportPages(input: {
    dimensions: string[];
    metrics: string[];
    range: DateRange;
    propertyId?: string;
  }): Promise<{ rows: Ga4ReportResponse["rows"]; pagesFetched: number; metadata?: Ga4ReportResponse["metadata"] }> {
    const limit = this.env.GA4_API_PAGE_LIMIT;
    let offset = 0;
    const rows: NonNullable<Ga4ReportResponse["rows"]> = [];
    let metadata: Ga4ReportResponse["metadata"] | undefined;
    let pages = 0;

    while (!shouldStopPaging(pages, MAX_PAGING_PAGES)) {
      const page = await this.runReport(
        {
          dateRanges: [{ startDate: input.range.since, endDate: input.range.until }],
          dimensions: input.dimensions.map((name) => ({ name })),
          metrics: input.metrics.map((name) => ({ name })),
          limit,
          offset,
        },
        input.propertyId
      );
      pages += 1;
      this.pagesFetched += 1;
      metadata = page.metadata ?? metadata;
      const pageRows = page.rows ?? [];
      rows.push(...pageRows);
      const next = nextOffset(offset, limit, pageRows.length);
      if (next == null) break;
      offset = next;
    }

    return { rows, pagesFetched: pages, metadata };
  }

  private async request<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const maxAttempts = this.env.GA4_MAX_RETRIES + 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      this.apiRequests += 1;
      try {
        const token = this.getAccessTokenImpl
          ? await this.getAccessTokenImpl()
          : await getGoogleAccessToken(this.authOptions);
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const text = await response.text();
        const parsed = text ? safeJson(text) : {};

        if (response.ok) {
          return parsed as T;
        }

        const message = extractGoogleError(parsed, text);
        const classification = classifyGa4Error({ status: response.status, message });
        const retryable = isRetryableGa4Failure({ status: response.status, message, classification });

        if (!retryable || attempt >= maxAttempts - 1) {
          throw this.toTypedError(response.status, message, classification);
        }

        this.retryCount += 1;
        const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
        const delay = retryDelayMs(attempt, retryAfter);
        logger.warn("GA4 request retrying", {
          provider: INTEGRATION,
          status: response.status,
          attempt: attempt + 1,
          delay_ms: delay,
        });
        await this.sleep(delay);
      } catch (err) {
        lastError = err;
        if (err instanceof Ga4Error && !err.retryable) throw err;
        const message = err instanceof Error ? err.message : "request failed";
        const classification = classifyGa4Error({ message });
        if (!isRetryableGa4Failure({ message, classification }) || attempt >= maxAttempts - 1) {
          throw err instanceof Ga4Error ? err : new Ga4Error(sanitizeGa4Error(message), "REQUEST_FAILED", false);
        }
        this.retryCount += 1;
        await this.sleep(retryDelayMs(attempt));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Ga4Error("GA4 request failed after retries", "REQUEST_FAILED", false);
  }

  private toTypedError(status: number, message: string, classification: ReturnType<typeof classifyGa4Error>): Ga4Error {
    const safe = sanitizeGa4Error(message);
    if (classification === "authentication") return new Ga4AuthError(safe);
    if (classification === "permission") return new Ga4PermissionError(safe);
    return new Ga4Error(safe, classification.toUpperCase(), isRetryableGa4Failure({ status, message, classification }), status, classification);
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 200) };
  }
}

function extractGoogleError(body: Record<string, unknown>, fallback: string): string {
  const error = body.error;
  if (error && typeof error === "object") {
    const record = error as { message?: string; status?: string };
    return sanitizeGa4Error(record.message || record.status || fallback.slice(0, 200));
  }
  return sanitizeGa4Error(fallback.slice(0, 200));
}
