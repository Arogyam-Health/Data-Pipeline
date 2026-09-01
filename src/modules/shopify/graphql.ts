import { logger } from "@/lib/logger";
import { RETRY_BACKOFF_MS } from "./constants";
import { ShopifyAuthError, ShopifyError, sanitizeShopifyError } from "./errors";
import { getShopifyEnv, type ShopifyEnv } from "./env";
import { getShopifyAccessToken } from "./auth";
import type { GraphQLResponse, GraphQLThrottleStatus } from "./types";

export interface ShopifyGraphqlClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  env?: ShopifyEnv;
  getAccessToken?: () => string;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function isRetryableGraphqlError(errors: Array<{ message?: string; extensions?: { code?: string } }> | undefined): boolean {
  if (!errors?.length) return false;
  return errors.some((err) => {
    const code = (err.extensions?.code ?? "").toUpperCase();
    const message = (err.message ?? "").toLowerCase();
    return (
      code === "THROTTLED" ||
      code === "INTERNAL_SERVER_ERROR" ||
      message.includes("throttl") ||
      message.includes("timeout")
    );
  });
}

export function isAuthGraphqlError(errors: Array<{ message?: string; extensions?: { code?: string } }> | undefined): boolean {
  if (!errors?.length) return false;
  return errors.some((err) => (err.extensions?.code ?? "").toUpperCase() === "UNAUTHORIZED");
}

function hasGraphqlData(data: unknown): boolean {
  return data != null && typeof data === "object" && Object.keys(data as object).length > 0;
}

function isFieldAccessDenied(
  errors: Array<{ message?: string; extensions?: { code?: string } }> | undefined
): boolean {
  if (!errors?.length) return false;
  return errors.every((err) => (err.extensions?.code ?? "").toUpperCase() === "ACCESS_DENIED");
}

export function throttleWaitMs(status?: GraphQLThrottleStatus): number {
  if (!status) return 0;
  if (status.currentlyAvailable > 50) return 0;
  if (status.restoreRate <= 0) return 1000;
  const needed = Math.max(1, 80 - status.currentlyAvailable);
  return Math.ceil((needed / status.restoreRate) * 1000);
}

export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return null;
}

export function connectionNodes<T>(
  connection:
    | { nodes?: T[]; edges?: Array<{ node: T }> }
    | T[]
    | null
    | undefined
): T[] {
  if (!connection) return [];
  if (Array.isArray(connection)) return connection;
  if (connection.nodes && connection.nodes.length > 0) return connection.nodes;
  if (connection.edges) return connection.edges.map((e) => e.node);
  return [];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function graphqlOperationName(query: string): string {
  const match = query.match(/\b(query|mutation)\s+([A-Za-z0-9_]+)/);
  return match?.[2] ?? "anonymous";
}

export class ShopifyGraphqlClient {
  readonly env: ShopifyEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly getAccessToken: () => string;
  apiRequests = 0;
  retryCount = 0;

  constructor(opts: ShopifyGraphqlClientOptions = {}) {
    this.env = opts.env ?? getShopifyEnv();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.getAccessToken = opts.getAccessToken ?? (() => getShopifyAccessToken(this.env));
  }

  async request<T>(
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<GraphQLResponse<T>> {
    const maxRetries = this.env.SHOPIFY_MAX_FETCH_RETRIES;
    let attempt = 0;
    const operation = graphqlOperationName(query);

    while (true) {
      const token = this.getAccessToken();
      const url = `https://${this.env.SHOPIFY_SHOP_DOMAIN}/admin/api/${this.env.SHOPIFY_API_VERSION}/graphql.json`;
      const startedAt = Date.now();

      if (this.env.SHOPIFY_SYNC_DEBUG) {
        logger.info("Shopify GraphQL request started", {
          provider: "shopify",
          operation,
          attempt: attempt + 1,
        });
      }

      let response: Response;
      try {
        this.apiRequests += 1;
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (err) {
        if (attempt >= maxRetries) {
          throw new ShopifyError(
            `Shopify GraphQL network error: ${err instanceof Error ? err.message : "unknown"}`,
            "NETWORK_ERROR",
            false
          );
        }
        this.retryCount += 1;
        logger.warn("Shopify GraphQL network retry", {
          provider: "shopify",
          attempt: attempt + 1,
          max_retries: maxRetries,
          error: sanitizeShopifyError(err instanceof Error ? err.message : "unknown"),
        });
        await this.sleep(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
        attempt += 1;
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new ShopifyAuthError();
      }

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        this.retryCount += 1;
        const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
        logger.warn("Shopify GraphQL HTTP retry", {
          provider: "shopify",
          attempt: attempt + 1,
          max_retries: maxRetries,
          status: response.status,
          retry_after_ms: retryAfter,
        });
        await this.sleep(
          retryAfter ?? RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]
        );
        attempt += 1;
        continue;
      }

      if (!response.ok) {
        const body = sanitizeShopifyError((await response.text()).slice(0, 200));
        throw new ShopifyError(
          `Shopify GraphQL HTTP ${response.status}: ${body}`,
          "HTTP_ERROR",
          false,
          response.status
        );
      }

      const payload = (await response.json()) as GraphQLResponse<T>;

      if (isAuthGraphqlError(payload.errors)) {
        throw new ShopifyAuthError();
      }

      if (isRetryableGraphqlError(payload.errors) && attempt < maxRetries) {
        this.retryCount += 1;
        const wait = throttleWaitMs(payload.extensions?.cost?.throttleStatus);
        logger.warn("Shopify GraphQL throttled retry", {
          provider: "shopify",
          attempt: attempt + 1,
          max_retries: maxRetries,
          wait_ms: wait,
          throttle_status: payload.extensions?.cost?.throttleStatus,
          errors: payload.errors?.map((err) => ({
            code: err.extensions?.code,
            message: sanitizeShopifyError(err.message ?? ""),
          })),
        });
        await this.sleep(
          wait > 0
            ? wait
            : RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]
        );
        attempt += 1;
        continue;
      }

      const fieldDeniedWithData =
        isFieldAccessDenied(payload.errors) && hasGraphqlData(payload.data);

      if (payload.errors?.length && !fieldDeniedWithData) {
        const first = payload.errors[0];
        const code = first.extensions?.code ?? "GRAPHQL_ERROR";
        throw new ShopifyError(sanitizeShopifyError(first.message), String(code), false);
      }

      if (fieldDeniedWithData) {
        logger.warn("Shopify field access denied; continuing with available data", {
          provider: "shopify",
          errors: payload.errors?.map((err) => ({
            code: err.extensions?.code,
            message: sanitizeShopifyError(err.message ?? ""),
            path: err.path,
          })),
        });
      }

      const wait = throttleWaitMs(payload.extensions?.cost?.throttleStatus);
      if (this.env.SHOPIFY_SYNC_DEBUG) {
        logger.info("Shopify GraphQL request finished", {
          provider: "shopify",
          operation,
          attempt: attempt + 1,
          duration_ms: Date.now() - startedAt,
          requested_cost: payload.extensions?.cost?.requestedQueryCost,
          actual_cost: payload.extensions?.cost?.actualQueryCost,
          throttle_status: payload.extensions?.cost?.throttleStatus,
        });
      }
      if (wait > 0) {
        logger.info("Shopify GraphQL throttle wait", {
          provider: "shopify",
          operation,
          wait_ms: wait,
          throttle_status: payload.extensions?.cost?.throttleStatus,
        });
        await this.sleep(wait);
      }

      return payload;
    }
  }
}
