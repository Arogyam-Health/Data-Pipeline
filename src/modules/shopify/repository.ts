import { getSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { SYNC_LOCK_TTL_SECONDS } from "./constants";
import type {
  NormalizedOrder,
  SchemaDriftObservation,
  SyncMode,
  SyncRunCounts,
  SyncStateRow,
  SyncStatus,
} from "./types";

function shopifyPersistenceDebugEnabled(): boolean {
  return process.env.SHOPIFY_SYNC_DEBUG === "true";
}

function logShopifyPersistenceDebug(message: string, meta: Record<string, unknown> = {}): void {
  if (!shopifyPersistenceDebugEnabled()) return;
  logger.info(message, { provider: "shopify", ...meta });
}

async function withPersistenceTiming<T>(
  label: string,
  orderId: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logShopifyPersistenceDebug("Shopify persistence step finished", {
      order_id: orderId,
      step: label,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logShopifyPersistenceDebug("Shopify persistence step failed", {
      order_id: orderId,
      step: label,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "unknown error",
    });
    throw error;
  }
}

function pipelineClient() {
  return getSupabaseClient();
}

export async function acquireSyncLock(
  shopDomain: string,
  mode: SyncMode
): Promise<string | null> {
  const { data, error } = await pipelineClient().rpc("try_acquire_shopify_sync_lock", {
    p_shop_domain: shopDomain,
    p_mode: mode,
    p_ttl_seconds: SYNC_LOCK_TTL_SECONDS,
  });
  if (error) {
    logger.error("Failed to acquire Shopify sync lock", {
      provider: "shopify",
      shop_domain: shopDomain,
      error: error.message,
    });
    throw new Error(`Failed to acquire sync lock: ${error.message}`);
  }
  return (data as string | null) ?? null;
}

export async function releaseSyncLock(
  shopDomain: string,
  lockToken: string
): Promise<void> {
  await pipelineClient().rpc("release_shopify_sync_lock", {
    p_shop_domain: shopDomain,
    p_lock_token: lockToken,
  });
}

export async function getSyncState(shopDomain: string): Promise<SyncStateRow | null> {
  const { data, error } = await pipelineClient()
    .from("shopify_sync_state")
    .select(
      "shop_domain, last_successful_sync_at, last_attempted_sync_at, last_backfill_completed_at, last_backfill_start_at, granted_scopes, api_version, accessible_history_days, history_warning"
    )
    .eq("shop_domain", shopDomain)
    .maybeSingle();
  if (error) throw new Error(`Failed to load sync state: ${error.message}`);
  return (data as SyncStateRow | null) ?? null;
}

export async function upsertSyncState(
  shopDomain: string,
  patch: Partial<SyncStateRow>
): Promise<void> {
  const { error } = await pipelineClient().from("shopify_sync_state").upsert(
    {
      shop_domain: shopDomain,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_domain" }
  );
  if (error) throw new Error(`Failed to upsert sync state: ${error.message}`);
}

export async function createSyncRun(input: {
  shopDomain: string;
  mode: SyncMode;
  requestedFrom: string;
  requestedTo: string;
  actualFrom: string;
  actualTo: string;
  historyWarning: string | null;
}): Promise<string> {
  const { data, error } = await pipelineClient()
    .from("shopify_sync_runs")
    .insert({
      shop_domain: input.shopDomain,
      mode: input.mode,
      status: "running",
      requested_from: input.requestedFrom,
      requested_to: input.requestedTo,
      actual_from: input.actualFrom,
      actual_to: input.actualTo,
      history_warning: input.historyWarning,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to create sync run: ${error?.message}`);
  return data.id as string;
}

export async function finishSyncRun(
  runId: string,
  status: SyncStatus,
  counts: SyncRunCounts,
  errorCode?: string | null,
  errorMessage?: string | null,
  historyWarning?: string | null
): Promise<void> {
  const { error } = await pipelineClient()
    .from("shopify_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      orders_fetched: counts.ordersFetched,
      orders_inserted: counts.ordersInserted,
      orders_updated: counts.ordersUpdated,
      items_upserted: counts.itemsUpserted,
      customers_upserted: counts.customersUpserted,
      refunds_upserted: counts.refundsUpserted,
      fulfillments_upserted: counts.fulfillmentsUpserted,
      pages_fetched: counts.pagesFetched,
      api_requests: counts.apiRequests,
      retry_count: counts.retryCount,
      last_error_code: errorCode ?? null,
      last_error_message: errorMessage ?? null,
      history_warning: historyWarning ?? null,
    })
    .eq("id", runId);
  if (error) throw new Error(`Failed to finish sync run: ${error.message}`);
}

export async function recordSyncError(input: {
  syncRunId: string;
  shopifyOrderId?: string | null;
  entityType: string;
  operation: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  attempt?: number;
}): Promise<void> {
  await pipelineClient().from("shopify_sync_errors").insert({
    sync_run_id: input.syncRunId,
    shopify_order_id: input.shopifyOrderId ?? null,
    entity_type: input.entityType,
    operation: input.operation,
    error_code: input.errorCode,
    error_message: input.errorMessage,
    retryable: input.retryable,
    attempt: input.attempt ?? 1,
  });
}

export async function recordSchemaDrift(
  observations: SchemaDriftObservation[],
  apiVersion: string
): Promise<void> {
  if (observations.length === 0) return;
  const now = new Date().toISOString();
  for (const obs of observations) {
    const { data: existing } = await pipelineClient()
      .from("shopify_schema_drift")
      .select("id, occurrence_count")
      .eq("entity_type", obs.entity_type)
      .eq("field_path", obs.field_path)
      .eq("api_version", apiVersion)
      .maybeSingle();

    if (existing) {
      await pipelineClient()
        .from("shopify_schema_drift")
        .update({
          last_seen_at: now,
          occurrence_count: (existing.occurrence_count ?? 1) + 1,
          observed_type: obs.observed_type,
        })
        .eq("id", existing.id);
    } else {
      await pipelineClient().from("shopify_schema_drift").insert({
        entity_type: obs.entity_type,
        field_path: obs.field_path,
        observed_type: obs.observed_type,
        api_version: apiVersion,
        first_seen_at: now,
        last_seen_at: now,
        occurrence_count: 1,
      });
    }
  }
}

export function computeStaleKeys(
  existing: Array<string | number | null | undefined>,
  keep: Array<string | number | null | undefined>
): string[] {
  const keepSet = new Set(
    keep.filter((v): v is string | number => v != null).map((v) => String(v))
  );
  return existing
    .filter((v): v is string | number => v != null)
    .map((v) => String(v))
    .filter((v) => !keepSet.has(v));
}

async function loadChildKeys(
  table: string,
  parentColumn: string,
  parentId: string,
  keyColumn: string
): Promise<Array<string | number | null | undefined> | null> {
  const client = pipelineClient().schema("data_pipeline");
  let lastMessage = "unknown error";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { data, error } = await client
      .from(table)
      .select(keyColumn)
      .eq(parentColumn, parentId);
    if (!error) {
      return (data ?? []).map((row) => {
        const record = row as unknown as Record<string, unknown>;
        return record[keyColumn] as string | number | null | undefined;
      });
    }
    lastMessage = error.message;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  logger.warn("Shopify child stale lookup failed after retries; skipping cleanup", {
    provider: "shopify",
    table,
    error: lastMessage,
  });
  return null;
}

const CHILD_UPSERT_CONFLICT: Record<string, string> = {
  shopify_order_addresses: "shopify_order_id,address_type",
  shopify_order_items: "business_key",
  shopify_line_item_properties: "business_key,position",
  shopify_discount_allocations: "order_item_business_key,discount_application_index",
  shopify_note_attributes: "shopify_order_id,position",
  shopify_discount_codes: "shopify_order_id,position",
  shopify_discount_applications: "shopify_order_id,application_index",
  shopify_fulfillments: "shopify_fulfillment_id",
  shopify_fulfillment_items: "shopify_fulfillment_id,shopify_line_item_id",
  shopify_shipping_lines: "shopify_shipping_line_id",
  shopify_refunds: "shopify_refund_id",
  shopify_refund_line_items: "shopify_refund_line_item_id",
  shopify_order_adjustments: "shopify_adjustment_id",
  shopify_transactions: "shopify_transaction_id",
};

export function childUpsertConflictTarget(table: string, keyColumn: string): string {
  return CHILD_UPSERT_CONFLICT[table] ?? keyColumn;
}

async function replaceChildren(
  table: string,
  parentColumn: string,
  parentId: string,
  keyColumn: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  const client = pipelineClient().schema("data_pipeline");
  if (rows.length > 0) {
    const { error } = await client.from(table).upsert(rows, {
      onConflict: childUpsertConflictTarget(table, keyColumn),
    });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }

  if (rows.length === 0) {
    const { error } = await client.from(table).delete().eq(parentColumn, parentId);
    if (error) throw new Error(`${table} stale cleanup failed: ${error.message}`);
    return;
  }

  const existing = await loadChildKeys(table, parentColumn, parentId, keyColumn);
  if (existing == null) return;

  const keep = rows.map((row) => row[keyColumn] as string | number | null | undefined);
  const stale = computeStaleKeys(existing, keep);
  if (stale.length === 0) return;

  const { error } = await client
    .from(table)
    .delete()
    .eq(parentColumn, parentId)
    .in(keyColumn, stale);
  if (error) throw new Error(`${table} stale cleanup failed: ${error.message}`);
}

export async function getExistingOrderIds(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const { data, error } = await pipelineClient()
    .from("shopify_orders")
    .select("shopify_order_id")
    .in("shopify_order_id", orderIds);
  if (error) throw new Error(`Failed to load existing Shopify orders: ${error.message}`);
  return new Set((data ?? []).map((row) => String(row.shopify_order_id)));
}

export async function persistNormalizedOrder(
  order: NormalizedOrder,
  syncRunId: string,
  existed = false
): Promise<{ inserted: boolean }> {
  const startedAt = Date.now();
  const client = pipelineClient();
  const now = new Date().toISOString();

  logShopifyPersistenceDebug("Shopify order persistence started", {
    order_id: order.shopify_order_id,
    line_items: order.line_items.length,
    fulfillments: order.fulfillments.length,
    refunds: order.refunds.length,
    shipping_lines: order.shipping_lines.length,
    transactions: order.transactions.length,
  });

  if (order.customer) {
    const { default_address, ...customer } = order.customer;
    const { error } = await withPersistenceTiming(
      "customer_upsert",
      order.shopify_order_id,
      () =>
        client.from("shopify_customers").upsert(
          { ...customer, last_synced_at: now },
          { onConflict: "customer_id" }
        )
    );
    if (error) throw new Error(`customer upsert failed: ${error.message}`);

    if (default_address) {
      await withPersistenceTiming("customer_address_upsert", order.shopify_order_id, () =>
        client.from("shopify_customer_addresses").upsert(
          {
            customer_id: order.customer.customer_id,
            customer_address_id: default_address.customer_address_id,
            is_default: true,
            address_key: default_address.address_key,
            first_name: default_address.first_name,
            last_name: default_address.last_name,
            name: default_address.name,
            company: default_address.company,
            address1: default_address.address1,
            address2: default_address.address2,
            city: default_address.city,
            province: default_address.province,
            province_code: default_address.province_code,
            country: default_address.country,
            country_code: default_address.country_code,
            zip: default_address.zip,
            phone: default_address.phone,
            latitude: default_address.latitude,
            longitude: default_address.longitude,
          },
          { onConflict: "customer_id,address_key" }
        )
      );
    }
  }

  const { error: orderError } = await withPersistenceTiming("order_upsert", order.shopify_order_id, () =>
    client.from("shopify_orders").upsert(
      {
        shopify_order_id: order.shopify_order_id,
        admin_graphql_api_id: order.admin_graphql_api_id,
        app_id: order.app_id,
        order_name: order.order_name,
        order_number: order.order_number,
        confirmation_number: order.confirmation_number,
        customer_id: order.customer_id,
        created_at_shopify: order.created_at_shopify,
        updated_at_shopify: order.updated_at_shopify,
        processed_at: order.processed_at,
        closed_at: order.closed_at,
        cancelled_at: order.cancelled_at,
        cancel_reason: order.cancel_reason,
        confirmed: order.confirmed,
        email: order.email,
        contact_email: order.contact_email,
        phone: order.phone,
        buyer_accepts_marketing: order.buyer_accepts_marketing,
        currency: order.currency,
        presentment_currency: order.presentment_currency,
        financial_status: order.financial_status,
        fulfillment_status: order.fulfillment_status,
        subtotal_price: order.subtotal_price,
        current_subtotal_price: order.current_subtotal_price,
        total_price: order.total_price,
        current_total_price: order.current_total_price,
        total_discounts: order.total_discounts,
        current_total_discounts: order.current_total_discounts,
        total_tax: order.total_tax,
        current_total_tax: order.current_total_tax,
        total_line_items_price: order.total_line_items_price,
        total_outstanding: order.total_outstanding,
        total_tip_received: order.total_tip_received,
        total_shipping_price: order.total_shipping_price,
        total_weight: order.total_weight,
        tax_exempt: order.tax_exempt,
        taxes_included: order.taxes_included,
        duties_included: order.duties_included,
        estimated_taxes: order.estimated_taxes,
        test: order.test,
        note: order.note,
        landing_site: order.landing_site,
        landing_site_ref: order.landing_site_ref,
        referring_site: order.referring_site,
        source_name: order.source_name,
        source_identifier: order.source_identifier,
        source_url: order.source_url,
        location_id: order.location_id,
        merchant_business_entity_id: order.merchant_business_entity_id,
        merchant_of_record_app_id: order.merchant_of_record_app_id,
        payment_gateway_names: order.payment_gateway_names,
        tags: order.tags,
        staff_note: order.staff_note,
        transactions_count: order.transactions_count,
        last_synced_at: now,
        last_sync_run_id: syncRunId,
      },
      { onConflict: "shopify_order_id" }
    )
  );
  if (orderError) throw new Error(`order upsert failed: ${orderError.message}`);

  const addresses = [order.shipping_address, order.billing_address]
    .filter((a): a is NonNullable<typeof a> => Boolean(a && a.address_type))
    .map((a) => ({
      shopify_order_id: order.shopify_order_id,
      address_type: a.address_type,
      first_name: a.first_name,
      last_name: a.last_name,
      name: a.name,
      company: a.company,
      address1: a.address1,
      address2: a.address2,
      city: a.city,
      province: a.province,
      province_code: a.province_code,
      country: a.country,
      country_code: a.country_code,
      zip: a.zip,
      phone: a.phone,
      latitude: a.latitude,
      longitude: a.longitude,
    }));
  await withPersistenceTiming("order_addresses_replace", order.shopify_order_id, () =>
    replaceChildren(
      "shopify_order_addresses",
      "shopify_order_id",
      order.shopify_order_id,
      "address_type",
      addresses
    )
  );

  const itemRows = order.line_items.map((item) => ({
    shopify_order_id: order.shopify_order_id,
    shopify_line_item_id: item.shopify_line_item_id,
    business_key: item.business_key,
    line_index: item.line_index,
    product_id: item.product_id,
    variant_id: item.variant_id,
    sku: item.sku,
    name: item.name,
    title: item.title,
    variant_title: item.variant_title,
    vendor: item.vendor,
    quantity: item.quantity,
    current_quantity: item.current_quantity,
    fulfillable_quantity: item.fulfillable_quantity,
    price: item.price,
    total_discount: item.total_discount,
    grams: item.grams,
    product_exists: item.product_exists,
    requires_shipping: item.requires_shipping,
    taxable: item.taxable,
    gift_card: item.gift_card,
    fulfillment_service: item.fulfillment_service,
    fulfillment_status: item.fulfillment_status,
    variant_inventory_management: item.variant_inventory_management,
    last_synced_at: now,
  }));
  await withPersistenceTiming("order_items_replace", order.shopify_order_id, () =>
    replaceChildren(
      "shopify_order_items",
      "shopify_order_id",
      order.shopify_order_id,
      "business_key",
      itemRows
    )
  );

  for (const item of order.line_items) {
    await withPersistenceTiming("line_item_properties_replace", order.shopify_order_id, () =>
      replaceChildren(
        "shopify_line_item_properties",
        "business_key",
        item.business_key,
        "position",
        item.properties.map((p) => ({
          business_key: item.business_key,
          position: p.position,
          property_name: p.property_name,
          property_value: p.property_value,
        }))
      )
    );
    await withPersistenceTiming("discount_allocations_replace", order.shopify_order_id, () =>
      replaceChildren(
        "shopify_discount_allocations",
        "order_item_business_key",
        item.business_key,
        "discount_application_index",
        item.discount_allocations.map((a) => ({
          order_item_business_key: item.business_key,
          discount_application_index: a.discount_application_index,
          amount: a.amount,
        }))
      )
    );
  }

  await withPersistenceTiming("note_attributes_replace", order.shopify_order_id, () =>
    replaceChildren(
      "shopify_note_attributes",
      "shopify_order_id",
      order.shopify_order_id,
      "position",
      order.note_attributes.map((a) => ({
        shopify_order_id: order.shopify_order_id,
        position: a.position,
        attribute_name: a.attribute_name,
        attribute_value: a.attribute_value,
      }))
    )
  );

  await withPersistenceTiming("discount_codes_replace", order.shopify_order_id, () =>
    replaceChildren(
      "shopify_discount_codes",
      "shopify_order_id",
      order.shopify_order_id,
      "position",
      order.discount_codes.map((d) => ({
        shopify_order_id: order.shopify_order_id,
        position: d.position,
        code: d.code,
        amount: d.amount,
        discount_type: d.discount_type,
      }))
    )
  );

  await withPersistenceTiming("discount_applications_replace", order.shopify_order_id, () =>
    replaceChildren(
      "shopify_discount_applications",
      "shopify_order_id",
      order.shopify_order_id,
      "application_index",
      order.discount_applications.map((d) => ({
        shopify_order_id: order.shopify_order_id,
        application_index: d.application_index,
        target_type: d.target_type,
        application_type: d.application_type,
        value: d.value,
        value_type: d.value_type,
        allocation_method: d.allocation_method,
        target_selection: d.target_selection,
        title: d.title,
        description: d.description,
      }))
    )
  );

  const fulfillmentRows = order.fulfillments.map((f) => ({
    shopify_fulfillment_id: f.shopify_fulfillment_id,
    shopify_order_id: order.shopify_order_id,
    admin_graphql_api_id: f.admin_graphql_api_id,
    created_at_shopify: f.created_at_shopify,
    updated_at_shopify: f.updated_at_shopify,
    location_id: f.location_id,
    name: f.name,
    service: f.service,
    shipment_status: f.shipment_status,
    status: f.status,
    tracking_company: f.tracking_company,
    tracking_number: f.tracking_number,
    tracking_url: f.tracking_url,
    tracking_numbers: f.tracking_numbers,
    tracking_urls: f.tracking_urls,
    last_synced_at: now,
  }));
  await withPersistenceTiming("fulfillments_replace", order.shopify_order_id, () =>
    replaceChildren(
      "shopify_fulfillments",
      "shopify_order_id",
      order.shopify_order_id,
      "shopify_fulfillment_id",
      fulfillmentRows
    )
  );

  for (const fulfillment of order.fulfillments) {
    const itemByLine = new Map(order.line_items.map((i) => [i.shopify_line_item_id, i]));
      await withPersistenceTiming("fulfillment_items_replace", order.shopify_order_id, () =>
        replaceChildren(
          "shopify_fulfillment_items",
          "shopify_fulfillment_id",
          fulfillment.shopify_fulfillment_id,
          "shopify_line_item_id",
          fulfillment.items
            .filter((item) => item.shopify_line_item_id)
            .map((item) => ({
              shopify_fulfillment_id: fulfillment.shopify_fulfillment_id,
              shopify_line_item_id: item.shopify_line_item_id,
              order_item_business_key:
                itemByLine.get(item.shopify_line_item_id)?.business_key ?? null,
              quantity: item.quantity,
            }))
        )
      );
  }

  await withPersistenceTiming("shipping_lines_replace", order.shopify_order_id, () =>
    replaceChildren(
      "shopify_shipping_lines",
      "shopify_order_id",
      order.shopify_order_id,
      "shopify_shipping_line_id",
      order.shipping_lines.map((s) => ({
        shopify_shipping_line_id: s.shopify_shipping_line_id,
        shopify_order_id: order.shopify_order_id,
        carrier_identifier: s.carrier_identifier,
        code: s.code,
        title: s.title,
        price: s.price,
        discounted_price: s.discounted_price,
        is_removed: s.is_removed,
        phone: s.phone,
        source: s.source,
      }))
    )
  );

  const refundRows = order.refunds.map((r) => ({
    shopify_refund_id: r.shopify_refund_id,
    shopify_order_id: order.shopify_order_id,
    created_at_shopify: r.created_at_shopify,
    processed_at: r.processed_at,
    note: r.note,
    restock: r.restock,
    last_synced_at: now,
  }));
  await withPersistenceTiming("refunds_replace", order.shopify_order_id, () =>
    replaceChildren(
      "shopify_refunds",
      "shopify_order_id",
      order.shopify_order_id,
      "shopify_refund_id",
      refundRows
    )
  );

  for (const refund of order.refunds) {
    await withPersistenceTiming("refund_line_items_replace", order.shopify_order_id, () =>
      replaceChildren(
        "shopify_refund_line_items",
        "shopify_refund_id",
        refund.shopify_refund_id,
        "shopify_refund_line_item_id",
        refund.line_items.map((li) => ({
          shopify_refund_line_item_id: li.shopify_refund_line_item_id,
          shopify_refund_id: refund.shopify_refund_id,
          shopify_order_id: order.shopify_order_id,
          shopify_line_item_id: li.shopify_line_item_id,
          location_id: li.location_id,
          quantity: li.quantity,
          restock_type: li.restock_type,
          subtotal: li.subtotal,
          total_tax: li.total_tax,
        }))
      )
    );
    await withPersistenceTiming("order_adjustments_replace", order.shopify_order_id, () =>
      replaceChildren(
        "shopify_order_adjustments",
        "shopify_refund_id",
        refund.shopify_refund_id,
        "shopify_adjustment_id",
        refund.adjustments.map((adj) => ({
          shopify_adjustment_id: adj.shopify_adjustment_id,
          shopify_refund_id: refund.shopify_refund_id,
          shopify_order_id: order.shopify_order_id,
          amount: adj.amount,
          tax_amount: adj.tax_amount,
          kind: adj.kind,
          reason: adj.reason,
        }))
      )
    );
  }

  const transactionRows = [
    ...order.transactions,
    ...order.refunds.flatMap((r) => r.transactions),
  ].map((t) => ({
    shopify_transaction_id: t.shopify_transaction_id,
    shopify_order_id: order.shopify_order_id,
    shopify_refund_id: t.shopify_refund_id,
    parent_id: t.parent_id,
    amount: t.amount,
    currency: t.currency,
    authorization_code: t.authorization_code,
    gateway: t.gateway,
    kind: t.kind,
    status: t.status,
    message: t.message,
    error_code: t.error_code,
    payment_id: t.payment_id,
    source_name: t.source_name,
    created_at_shopify: t.created_at_shopify,
    processed_at: t.processed_at,
    test: t.test,
  }));
  await withPersistenceTiming("transactions_replace", order.shopify_order_id, () =>
    replaceChildren(
      "shopify_transactions",
      "shopify_order_id",
      order.shopify_order_id,
      "shopify_transaction_id",
      transactionRows
    )
  );

  logShopifyPersistenceDebug("Shopify order persistence finished", {
    order_id: order.shopify_order_id,
    inserted: !existed,
    duration_ms: Date.now() - startedAt,
  });

  return { inserted: !existed };
}

export async function getActiveBackfillJob(shopDomain: string) {
  const { data, error } = await pipelineClient()
    .from("shopify_backfill_jobs")
    .select("*")
    .eq("shop_domain", shopDomain)
    .in("status", ["pending", "running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load backfill job: ${error.message}`);
  return data;
}

export async function createBackfillJob(input: {
  shopDomain: string;
  requestedDays: number;
  chunkDays: number;
  startAt: string;
  endAt: string;
}) {
  const { data, error } = await pipelineClient()
    .from("shopify_backfill_jobs")
    .insert({
      shop_domain: input.shopDomain,
      requested_days: input.requestedDays,
      chunk_days: input.chunkDays,
      start_at: input.startAt,
      end_at: input.endAt,
      next_chunk_start: input.startAt,
      status: "pending",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to create backfill job: ${error?.message}`);
  return data;
}

export async function updateBackfillJob(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await pipelineClient()
    .from("shopify_backfill_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to update backfill job: ${error.message}`);
}

export async function getLatestSyncRun(shopDomain: string) {
  const { data } = await pipelineClient()
    .from("shopify_sync_runs")
    .select("*")
    .eq("shop_domain", shopDomain)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
