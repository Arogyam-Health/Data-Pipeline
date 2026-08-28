import { logger } from "@/lib/logger";
import { DEFAULT_GRAPH_BASE_URL, INTEGRATION, PAGE_SLEEP_MS } from "./constants";
import { getMetaAccessToken, getMetaEnv, type MetaEnv } from "./env";
import {
  MetaAuthError,
  MetaError,
  MetaInvalidFieldError,
  MetaPermissionError,
  classifyMetaError,
  isRetryableMetaFailure,
  sanitizeMetaError,
  stripAccessTokenFromUrl,
} from "./errors";
import { detectRepeatedPagingUrl, nextPagingUrl, shouldStopPaging } from "./pagination";
import { parseRetryAfterMs, retryDelayMs } from "./retry";
import type { MetaGraphErrorBody, MetaGraphResponse } from "./types";

export interface MetaClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  env?: MetaEnv;
  getAccessToken?: () => string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function buildAuthorizationHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export class MetaGraphClient {
  readonly env: MetaEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly getAccessToken: () => string;
  apiRequests = 0;
  retryCount = 0;
  pagesFetched = 0;

  constructor(opts: MetaClientOptions = {}) {
    this.env = opts.env ?? getMetaEnv();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.getAccessToken = opts.getAccessToken ?? (() => getMetaAccessToken(this.env));
  }

  graphUrl(path: string): string {
    const version = this.env.META_API_VERSION;
    const clean = path.startsWith("/") ? path : `/${path}`;
    return `${DEFAULT_GRAPH_BASE_URL}/${version}${clean}`;
  }

  async get<T>(
    pathOrUrl: string,
    query: Record<string, string | undefined> = {}
  ): Promise<MetaGraphResponse<T>> {
    const url = pathOrUrl.startsWith("http")
      ? stripAccessTokenFromUrl(pathOrUrl)
      : this.withQuery(this.graphUrl(pathOrUrl), query);
    return this.request<T>(url);
  }

  async getPaged<T>(
    path: string,
    query: Record<string, string | undefined> = {}
  ): Promise<T[]> {
    const firstUrl = this.withQuery(this.graphUrl(path), query);
    const rows: T[] = [];
    const seen = new Set<string>();
    let url: string | null = firstUrl;

    while (url) {
      const { repeated, sanitized } = detectRepeatedPagingUrl(seen, url);
      if (repeated) {
        logger.warn("Meta paging stopped after repeated cursor", {
          provider: INTEGRATION,
          pages_fetched: this.pagesFetched,
        });
        break;
      }
      if (shouldStopPaging(this.pagesFetched)) {
        logger.warn("Meta paging stopped at page cap", {
          provider: INTEGRATION,
          pages_fetched: this.pagesFetched,
        });
        break;
      }

      const page = await this.request<T>(sanitized ?? url);
      this.pagesFetched += 1;
      if (Array.isArray(page.data)) {
        rows.push(...page.data);
      }
      url = nextPagingUrl(page.paging);
      if (url) {
        await this.sleep(PAGE_SLEEP_MS);
      }
    }

    return rows;
  }

  private withQuery(url: string, query: Record<string, string | undefined>): string {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        parsed.searchParams.set(key, value);
      }
    }
    parsed.searchParams.delete("access_token");
    return parsed.toString();
  }

  private async request<T>(url: string): Promise<MetaGraphResponse<T>> {
    const maxRetries = this.env.META_MAX_RETRIES;
    let attempt = 0;
    let lastError: MetaError | null = null;

    while (attempt <= maxRetries) {
      const token = this.getAccessToken();
      let response: Response;
      try {
        this.apiRequests += 1;
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...buildAuthorizationHeader(token),
          },
        });
      } catch (err) {
        lastError = new MetaError(
          sanitizeMetaError(err instanceof Error ? err.message : "network error"),
          "NETWORK_ERROR",
          true,
          undefined,
          "network"
        );
        if (attempt >= maxRetries) throw lastError;
        this.retryCount += 1;
        await this.sleep(retryDelayMs(attempt));
        attempt += 1;
        continue;
      }

      const bodyText = await response.text();
      const parsed = safeJson(bodyText);
      const graphError = extractGraphError(parsed);
      const classification = classifyMetaError({
        status: response.status,
        code: graphError?.code,
        message: graphError?.message ?? bodyText,
      });

      if (response.ok) {
        return (parsed ?? {}) as MetaGraphResponse<T>;
      }

      const safeMessage = sanitizeMetaError(
        graphError?.message ?? `Meta API error ${response.status}`
      );

      if (classification === "authentication") {
        throw new MetaAuthError();
      }
      if (classification === "permission") {
        throw new MetaPermissionError();
      }
      if (classification === "invalid_field") {
        throw new MetaInvalidFieldError(safeMessage);
      }

      const retryable = isRetryableMetaFailure({
        status: response.status,
        message: graphError?.message ?? bodyText,
        classification,
      });

      lastError = new MetaError(
        safeMessage,
        graphError?.code != null ? String(graphError.code) : `HTTP_${response.status}`,
        retryable,
        response.status,
        classification
      );

      if (!retryable || attempt >= maxRetries) {
        throw lastError;
      }

      this.retryCount += 1;
      logger.warn("Meta API retry", {
        provider: INTEGRATION,
        attempt: attempt + 1,
        status: response.status,
        error_code: lastError.code,
      });
      await this.sleep(retryDelayMs(attempt, parseRetryAfterMs(response.headers.get("retry-after"))));
      attempt += 1;
    }

    throw lastError ?? new MetaError("Meta API failed after retries", "RETRY_EXHAUSTED", false);
  }
}

function safeJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: "Unparseable Meta response" } };
  }
}

function extractGraphError(parsed: unknown): MetaGraphErrorBody | null {
  if (!parsed || typeof parsed !== "object") return null;
  const error = (parsed as { error?: MetaGraphErrorBody }).error;
  return error ?? null;
}
