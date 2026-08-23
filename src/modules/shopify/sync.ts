import { logger } from "@/lib/logger";
import {
  DEFAULT_ACCESSIBLE_HISTORY_DAYS,
  DETAIL_NESTED_FIRST,
  INTEGRATION,
  LIST_NESTED_FIRST,
  LIST_ORDER_PAGE_SIZE,
} from "./constants";
import { getShopifyEnv, isShopifySyncEnabled, type ShopifyEnv } from "./env";
import {
  ShopifyAuthError,
  ShopifyError,
  ShopifySyncConflictError,
  ShopifySyncDisabledError,
  ShopifySyncLockError,
  sanitizeShopifyError,
} from "./errors";
import { ShopifyGraphqlClient, connectionNodes } from "./graphql";
import { normalizeOrder } from "./normalizer";
import {
  ACCESS_SCOPES_QUERY,
  ORDER_CHILDREN_QUERY,
  ORDER_FULFILLMENT_ITEMS_QUERY,
  ORDER_LINE_ITEMS_QUERY,
  ORDER_REFUND_ITEMS_QUERY,
  ORDER_SHIPPING_LINES_QUERY,
  ORDERS_QUERY,
  buildOrdersSearchQuery,
} from "./queries";
import {
  acquireSyncLock,
  createBackfillJob,
  createSyncRun,
  finishSyncRun,
  getActiveBackfillJob,
  getLatestSyncRun,
  getSyncState,
  persistNormalizedOrder,
  recordSchemaDrift,
  recordSyncError,
  releaseSyncLock,
  updateBackfillJob,
  upsertSyncState,
} from "./repository";
import { detectSchemaDrift, mergeDriftObservations } from "./schema-drift";
import type {
  Connection,
  GraphQLResponse,
  ShopifyFulfillmentLineItemNode,
  ShopifyLineItemNode,
  ShopifyOrderNode,
  ShopifyRefundLineItemNode,
  ShopifyShippingLineNode,
  SyncMode,
  SyncRunCounts,
  SyncRunResult,
  SyncStatus,
  SyncWindow,
} from "./types";

export function computeSyncWindow(input: {
  mode: SyncMode;
  now: Date;
  lastSuccessfulSyncAt: string | null;
  bufferMinutes: number;
  testDays: number;
  from?: Date;
  to?: Date;
  grantedScopes: string[];
  requestedBackfillDays: number;
}): SyncWindow {
  const requestedTo = input.to ?? input.now;
  let requestedFrom: Date;

  if (input.from) {
    requestedFrom = input.from;
  } else if (input.mode === "test") {
    requestedFrom = new Date(input.now.getTime() - input.testDays * 24 * 60 * 60 * 1000);
  } else if (input.mode === "incremental") {
    if (!input.lastSuccessfulSyncAt) {
      throw new ShopifyError(
        "No last_successful_sync_at watermark. Run /api/internal/shopify/sync/test or /backfill first.",
        "WATERMARK_MISSING",
        false
      );
    }
    requestedFrom = new Date(
      new Date(input.lastSuccessfulSyncAt).getTime() - input.bufferMinutes * 60 * 1000
    );
  } else {
    requestedFrom = new Date(
      input.now.getTime() - input.requestedBackfillDays * 24 * 60 * 60 * 1000
    );
  }

  const hasAllOrders = input.grantedScopes.includes("read_all_orders");
  const accessibleDays = hasAllOrders
    ? input.requestedBackfillDays
    : DEFAULT_ACCESSIBLE_HISTORY_DAYS;
  const accessibleFrom = new Date(
    input.now.getTime() - accessibleDays * 24 * 60 * 60 * 1000
  );

  let actualFrom = requestedFrom;
  let historyWarning: string | null = null;
  if (!hasAllOrders && requestedFrom < accessibleFrom) {
    actualFrom = accessibleFrom;
    historyWarning =
      `Shopify granted scopes do not include read_all_orders. ` +
      `Only approximately the last ${DEFAULT_ACCESSIBLE_HISTORY_DAYS} days are accessible. ` +
      `Requested ${input.requestedBackfillDays}-day range was clamped.`;
  }

  return {
    requestedFrom,
    requestedTo,
    actualFrom,
    actualTo: requestedTo,
    historyWarning,
    accessibleHistoryDays: accessibleDays,
  };
}

export function shouldAdvanceWatermark(
  mode: SyncMode,
  status: SyncStatus,
  existingWatermark?: string | null
): boolean {
  if (status !== "success") return false;
  if (mode === "incremental") return true;
  if (mode === "test") return !existingWatermark;
  return false;
}

export function assertIncrementalAllowed(activeBackfill: { id: string } | null): void {
  if (activeBackfill) {
    throw new ShopifySyncConflictError(
      "A Shopify backfill is already active for this shop."
    );
  }
}

export function assertBackfillAllowed(
  resume: boolean,
  existing: { id: string } | null
): void {
  if (!resume && existing) {
    throw new ShopifySyncConflictError("A Shopify backfill is already active for this shop.");
  }
  if (resume && !existing) {
    throw new ShopifySyncConflictError("No resumable Shopify backfill job was found for this shop.");
  }
}

export function chunkDateRange(start: Date, end: Date, chunkDays: number): Array<{ from: Date; to: Date }> {
  const chunks: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(cursor.getTime() + chunkDays * 24 * 60 * 60 * 1000);
    chunks.push({ from: cursor, to: next > end ? end : next });
    cursor = next;
  }
  return chunks;
}

async function fetchGrantedScopes(client: ShopifyGraphqlClient): Promise<string[]> {
  try {
    const result = await client.request<{
      currentAppInstallation?: { accessScopes?: Array<{ handle?: string }> };
    }>(ACCESS_SCOPES_QUERY);
    return (result.data?.currentAppInstallation?.accessScopes ?? [])
      .map((s) => s.handle)
      .filter((h): h is string => Boolean(h));
  } catch (err) {
    if (err instanceof ShopifyAuthError) throw err;
    return [];
  }
}

function nextCursor(
  connection: { pageInfo?: { hasNextPage: boolean; endCursor: string | null } } | null | undefined
): string | null {
  return connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
}

export async function expandNestedConnections(
  client: ShopifyGraphqlClient,
  order: ShopifyOrderNode
): Promise<ShopifyOrderNode> {
  const nestedFirst = DETAIL_NESTED_FIRST;
  const orderId = order.id;
  if (!orderId) return order;

  let working: ShopifyOrderNode = order;
  const missingChildren =
    order.fulfillments == null &&
    order.refunds == null &&
    order.shippingLines == null &&
    order.transactions == null;

  if (missingChildren) {
    const extra = await client.request<{ order?: ShopifyOrderNode }>(ORDER_CHILDREN_QUERY, {
      id: orderId,
      nestedFirst,
    });
    if (extra.data?.order) {
      working = {
        ...order,
        fulfillments: extra.data.order.fulfillments,
        refunds: extra.data.order.refunds,
        shippingLines: extra.data.order.shippingLines,
        transactions: extra.data.order.transactions,
      };
    }
  }

  let lineItems = connectionNodes(working.lineItems);
  let lineAfter = nextCursor(working.lineItems);
  while (lineAfter) {
    const extra = await client.request<{
      order?: { lineItems?: Connection<ShopifyLineItemNode> };
    }>(ORDER_LINE_ITEMS_QUERY, {
      id: orderId,
      nestedFirst,
      lineItemsAfter: lineAfter,
    });
    const page = extra.data?.order?.lineItems;
    lineItems = [...lineItems, ...connectionNodes(page)];
    lineAfter = nextCursor(page);
  }

  let fulfillments = connectionNodes(working.fulfillments);
  for (let i = 0; i < fulfillments.length; i += 1) {
    const fulfillment = fulfillments[i];
    if (!fulfillment.id || !fulfillment.fulfillmentLineItems?.pageInfo?.hasNextPage) continue;
    let items = connectionNodes(fulfillment.fulfillmentLineItems);
    let after = nextCursor(fulfillment.fulfillmentLineItems);
    while (after) {
      const extra = await client.request<{
        fulfillment?: { fulfillmentLineItems?: Connection<ShopifyFulfillmentLineItemNode> };
      }>(ORDER_FULFILLMENT_ITEMS_QUERY, {
        id: fulfillment.id,
        nestedFirst,
        fulfillmentItemsAfter: after,
      });
      const page = extra.data?.fulfillment?.fulfillmentLineItems;
      items = [...items, ...connectionNodes(page)];
      after = nextCursor(page);
    }
    fulfillments[i] = {
      ...fulfillment,
      fulfillmentLineItems: { nodes: items, pageInfo: { hasNextPage: false, endCursor: null } },
    };
  }

  const refunds = connectionNodes(working.refunds);

  for (let i = 0; i < refunds.length; i += 1) {
    const refund = refunds[i];
    if (!refund.id || !refund.refundLineItems?.pageInfo?.hasNextPage) continue;
    let items = connectionNodes(refund.refundLineItems);
    let after = nextCursor(refund.refundLineItems);
    while (after) {
      const extra = await client.request<{
        refund?: { refundLineItems?: Connection<ShopifyRefundLineItemNode> };
      }>(ORDER_REFUND_ITEMS_QUERY, {
        id: refund.id,
        nestedFirst,
        refundItemsAfter: after,
      });
      const page = extra.data?.refund?.refundLineItems;
      items = [...items, ...connectionNodes(page)];
      after = nextCursor(page);
    }
    refunds[i] = {
      ...refund,
      refundLineItems: { nodes: items, pageInfo: { hasNextPage: false, endCursor: null } },
    };
  }

  let shippingLines = connectionNodes(working.shippingLines);
  let shippingAfter = nextCursor(working.shippingLines);
  if (working.shippingLines == null) {
    const extra = await client.request<{
      order?: { shippingLines?: Connection<ShopifyShippingLineNode> };
    }>(ORDER_SHIPPING_LINES_QUERY, {
      id: orderId,
      nestedFirst,
      after: null,
    });
    const page = extra.data?.order?.shippingLines;
    shippingLines = connectionNodes(page);
    shippingAfter = nextCursor(page);
  }
  while (shippingAfter) {
    const extra = await client.request<{
      order?: { shippingLines?: Connection<ShopifyShippingLineNode> };
    }>(ORDER_SHIPPING_LINES_QUERY, {
      id: orderId,
      nestedFirst,
      after: shippingAfter,
    });
    const page = extra.data?.order?.shippingLines;
    shippingLines = [...shippingLines, ...connectionNodes(page)];
    shippingAfter = nextCursor(page);
  }

  const transactions = connectionNodes(working.transactions);

  return {
    ...working,
    lineItems: { nodes: lineItems, pageInfo: { hasNextPage: false, endCursor: null } },
    fulfillments,
    refunds: { nodes: refunds, pageInfo: { hasNextPage: false, endCursor: null } },
    shippingLines: { nodes: shippingLines, pageInfo: { hasNextPage: false, endCursor: null } },
    transactions: { nodes: transactions, pageInfo: { hasNextPage: false, endCursor: null } },
  };
}

async function fetchOrdersInWindow(
  client: ShopifyGraphqlClient,
  from: Date,
  to: Date
): Promise<{ orders: ShopifyOrderNode[]; pagesFetched: number }> {
  const orders: ShopifyOrderNode[] = [];
  let after: string | null = null;
  let pagesFetched = 0;
  const pageSize = Math.min(client.env.SHOPIFY_PAGE_SIZE, LIST_ORDER_PAGE_SIZE);
  const search = buildOrdersSearchQuery(from, to);

  do {
    const result: GraphQLResponse<{
      orders?: {
        nodes?: ShopifyOrderNode[];
        pageInfo?: { hasNextPage: boolean; endCursor: string | null };
      };
    }> = await client.request(ORDERS_QUERY, {
      first: pageSize,
      after,
      query: search,
      nestedFirst: LIST_NESTED_FIRST,
      lineItemsAfter: null,
    });

    pagesFetched += 1;
    const page = result.data?.orders;
    const nodes: ShopifyOrderNode[] = connectionNodes(page);
    for (const node of nodes) {
      orders.push(await expandNestedConnections(client, node));
    }
    after = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? null : null;
  } while (after);

  return { orders, pagesFetched };
}

async function persistOrders(
  orders: ShopifyOrderNode[],
  runId: string,
  apiVersion: string,
  counts: SyncRunCounts
): Promise<boolean> {
  let allOk = true;
  counts.ordersFetched += orders.length;
  const drift = mergeDriftObservations(orders.flatMap(detectSchemaDrift));
  if (drift.length > 0) {
    await recordSchemaDrift(drift, apiVersion);
  }

  for (const node of orders) {
    try {
      const normalized = normalizeOrder(node);
      const { inserted } = await persistNormalizedOrder(normalized, runId);
      if (inserted) counts.ordersInserted += 1;
      else counts.ordersUpdated += 1;
      counts.itemsUpserted += normalized.line_items.length;
      if (normalized.customer) counts.customersUpserted += 1;
      counts.refundsUpserted += normalized.refunds.length;
      counts.fulfillmentsUpserted += normalized.fulfillments.length;
    } catch (err) {
      allOk = false;
      const message = sanitizeShopifyError(
        err instanceof Error ? err.message : "order persist failed"
      );
      logger.error("Shopify order persist failed", {
        provider: INTEGRATION,
        run_id: runId,
        error: message,
      });
      await recordSyncError({
        syncRunId: runId,
        shopifyOrderId: node.legacyResourceId ? String(node.legacyResourceId) : null,
        entityType: "order",
        operation: "upsert",
        errorCode: err instanceof ShopifyError ? err.code : "PERSIST_ERROR",
        errorMessage: message,
        retryable: false,
      });
    }
  }
  return allOk;
}

export interface RunSyncOptions {
  mode: SyncMode;
  env?: ShopifyEnv;
  client?: ShopifyGraphqlClient;
  now?: Date;
  from?: Date;
  to?: Date;
  requireEnabled?: boolean;
}

export async function runShopifySync(options: RunSyncOptions): Promise<SyncRunResult> {
  const env = options.env ?? getShopifyEnv();
  const requireEnabled = options.requireEnabled ?? options.mode === "incremental";
  if (requireEnabled && !isShopifySyncEnabled(env)) {
    throw new ShopifySyncDisabledError();
  }

  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const now = options.now ?? new Date();

  if (options.mode === "incremental" || options.mode === "repair") {
    assertIncrementalAllowed(await getActiveBackfillJob(shopDomain));
  }

  const lockToken = await acquireSyncLock(shopDomain, options.mode);
  if (!lockToken) {
    throw new ShopifySyncLockError(shopDomain);
  }

  const counts: SyncRunCounts = {
    ordersFetched: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    itemsUpserted: 0,
    customersUpserted: 0,
    refundsUpserted: 0,
    fulfillmentsUpserted: 0,
    pagesFetched: 0,
    apiRequests: 0,
    retryCount: 0,
  };

  let runId = "";
  try {
    const client = options.client ?? new ShopifyGraphqlClient({ env });
    const grantedScopes = await fetchGrantedScopes(client);
    const state = await getSyncState(shopDomain);
    const window = computeSyncWindow({
      mode: options.mode,
      now,
      lastSuccessfulSyncAt: state?.last_successful_sync_at ?? null,
      bufferMinutes: env.SHOPIFY_INCREMENTAL_BUFFER_MINUTES,
      testDays: env.SHOPIFY_TEST_FETCH_DAYS,
      from: options.from,
      to: options.to,
      grantedScopes,
      requestedBackfillDays: env.SHOPIFY_BACKFILL_DAYS,
    });

    await upsertSyncState(shopDomain, {
      shop_domain: shopDomain,
      last_attempted_sync_at: now.toISOString(),
      granted_scopes: grantedScopes,
      api_version: env.SHOPIFY_API_VERSION,
      accessible_history_days: window.accessibleHistoryDays,
      history_warning: window.historyWarning,
    });

    runId = await createSyncRun({
      shopDomain,
      mode: options.mode,
      requestedFrom: window.requestedFrom.toISOString(),
      requestedTo: window.requestedTo.toISOString(),
      actualFrom: window.actualFrom.toISOString(),
      actualTo: window.actualTo.toISOString(),
      historyWarning: window.historyWarning,
    });

    logger.info("Shopify sync started", {
      provider: INTEGRATION,
      run_id: runId,
      mode: options.mode,
      shop_domain: shopDomain,
      from: window.actualFrom.toISOString(),
      to: window.actualTo.toISOString(),
    });

    const { orders, pagesFetched } = await fetchOrdersInWindow(
      client,
      window.actualFrom,
      window.actualTo
    );
    counts.pagesFetched = pagesFetched;
    counts.apiRequests = client.apiRequests;
    counts.retryCount = client.retryCount;

    const persisted = await persistOrders(orders, runId, env.SHOPIFY_API_VERSION, counts);
    const status = persisted ? "success" : "partial";

    if (shouldAdvanceWatermark(options.mode, status, state?.last_successful_sync_at)) {
      await upsertSyncState(shopDomain, {
        shop_domain: shopDomain,
        last_successful_sync_at: window.actualTo.toISOString(),
        last_attempted_sync_at: now.toISOString(),
        granted_scopes: grantedScopes,
        api_version: env.SHOPIFY_API_VERSION,
        accessible_history_days: window.accessibleHistoryDays,
        history_warning: window.historyWarning,
      });
    }

    await finishSyncRun(
      runId,
      status,
      counts,
      persisted ? null : "PARTIAL_ORDER_FAILURES",
      persisted ? null : "One or more orders failed to persist",
      window.historyWarning
    );

    logger.info("Shopify sync finished", {
      provider: INTEGRATION,
      run_id: runId,
      mode: options.mode,
      status,
      orders_count: counts.ordersFetched,
      pages: counts.pagesFetched,
      retries: counts.retryCount,
    });

    return {
      success: persisted,
      runId,
      mode: options.mode,
      status,
      from: window.requestedFrom.toISOString(),
      to: window.requestedTo.toISOString(),
      actualFrom: window.actualFrom.toISOString(),
      actualTo: window.actualTo.toISOString(),
      historyWarning: window.historyWarning,
      ordersFetched: counts.ordersFetched,
      itemsUpserted: counts.itemsUpserted,
      pagesFetched: counts.pagesFetched,
      retryCount: counts.retryCount,
    };
  } catch (err) {
    const message = sanitizeShopifyError(err instanceof Error ? err.message : "sync failed");
    const code = err instanceof ShopifyError ? err.code : "SYNC_FAILED";
    if (runId) {
      await finishSyncRun(runId, "failed", counts, code, message);
    }
    if (
      err instanceof ShopifySyncLockError ||
      err instanceof ShopifySyncDisabledError ||
      err instanceof ShopifySyncConflictError ||
      err instanceof ShopifyAuthError
    ) {
      throw err;
    }
    logger.error("Shopify sync failed", {
      provider: INTEGRATION,
      run_id: runId || undefined,
      mode: options.mode,
      error: message,
    });
    throw new ShopifyError(message, code, err instanceof ShopifyError ? err.retryable : false);
  } finally {
    await releaseSyncLock(shopDomain, lockToken);
  }
}

export async function runBackfill(options: {
  env?: ShopifyEnv;
  client?: ShopifyGraphqlClient;
  resume?: boolean;
  now?: Date;
}): Promise<SyncRunResult> {
  const env = options.env ?? getShopifyEnv();
  const now = options.now ?? new Date();
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;

  const existing = await getActiveBackfillJob(shopDomain);
  assertBackfillAllowed(Boolean(options.resume), existing);

  let job = existing;
  if (!job) {
    const end = now;
    const start = new Date(end.getTime() - env.SHOPIFY_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
    job = await createBackfillJob({
      shopDomain,
      requestedDays: env.SHOPIFY_BACKFILL_DAYS,
      chunkDays: env.SHOPIFY_BACKFILL_CHUNK_DAYS,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    });
  }

  await updateBackfillJob(job.id, {
    status: "running",
    started_at: job.started_at ?? now.toISOString(),
  });

  const chunkStart = new Date(job.next_chunk_start ?? job.start_at);
  const jobEnd = new Date(job.end_at);
  const chunkEnd = new Date(
    Math.min(
      jobEnd.getTime(),
      chunkStart.getTime() + env.SHOPIFY_BACKFILL_CHUNK_DAYS * 24 * 60 * 60 * 1000
    )
  );

  try {
    const result = await runShopifySync({
      mode: "backfill",
      env,
      client: options.client,
      now,
      from: chunkStart,
      to: chunkEnd,
      requireEnabled: false,
    });

    const done = chunkEnd >= jobEnd;
    await updateBackfillJob(job.id, {
      next_chunk_start: done ? jobEnd.toISOString() : chunkEnd.toISOString(),
      status: done ? "completed" : "paused",
      finished_at: done ? new Date().toISOString() : null,
      last_error: result.success ? null : "partial chunk",
      history_warning: result.historyWarning,
    });

    if (done && result.success) {
      const state = await getSyncState(shopDomain);
      const endAt = job.end_at;
      const current = state?.last_successful_sync_at;
      const patch: {
        shop_domain: string;
        last_backfill_completed_at: string;
        last_backfill_start_at: string;
        last_successful_sync_at?: string;
      } = {
        shop_domain: shopDomain,
        last_backfill_completed_at: new Date().toISOString(),
        last_backfill_start_at: job.start_at,
      };
      if (!current || new Date(endAt).getTime() > new Date(current).getTime()) {
        patch.last_successful_sync_at = endAt;
      }
      await upsertSyncState(shopDomain, patch);
    }

    return {
      ...result,
      resumable: !done,
    };
  } catch (err) {
    await updateBackfillJob(job.id, {
      status: "paused",
      last_error: sanitizeShopifyError(err instanceof Error ? err.message : "chunk failed"),
    });
    throw err;
  }
}

export async function getSyncStatus(shopDomain?: string) {
  const env = getShopifyEnv();
  const domain = shopDomain ?? env.SHOPIFY_SHOP_DOMAIN;
  const [state, latest, backfill] = await Promise.all([
    getSyncState(domain),
    getLatestSyncRun(domain),
    getActiveBackfillJob(domain),
  ]);
  return { state, latest, backfill };
}
