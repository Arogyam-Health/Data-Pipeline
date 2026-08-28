import "https://esm.sh/@supabase/supabase-js@2";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { calculateRetryDelay, isDeadLetter } from "../_shared/retry.ts";
import { logger } from "../_shared/logger.ts";

const BATCH_SIZE = 20;
const VISIBILITY_TIMEOUT = 300; // 5 minutes

interface QueueMessage {
  msg_id: number;
  message: { event_id: string };
}

interface IntegrationEvent {
  id: string;
  provider: string;
  request_hash: string;
  payload: Record<string, unknown>;
  status: string;
  attempt_count: number;
}

Deno.serve(async (req: Request) => {
  // Authenticate
  const authHeader = req.headers.get("authorization");
  const workerSecret = Deno.env.get("WORKER_SECRET");

  if (!workerSecret) {
    logger.error("WORKER_SECRET not configured");
    return new Response("Internal server error", { status: 500 });
  }

  const providedSecret = authHeader?.replace("Bearer ", "");
  if (!providedSecret || providedSecret.length !== workerSecret.length) {
    logger.warn("Worker authentication failed");
    return new Response("Unauthorized", { status: 401 });
  }

  const a = new TextEncoder().encode(providedSecret);
  const b = new TextEncoder().encode(workerSecret);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  if (diff !== 0) {
    logger.warn("Worker authentication failed");
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = getSupabaseClient();

  try {
    const { data: messages, error: readError } = await supabase
      
      .rpc("read_shiprocket_queue", {
        p_batch_size: BATCH_SIZE,
        p_visibility_timeout: VISIBILITY_TIMEOUT,
      });

    if (readError) {
      logger.error("Failed to read queue", { error: readError.message });
      return new Response("Queue read failed", { status: 500 });
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: "No messages in queue" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    logger.info(`Processing batch of ${messages.length} messages`);

    let processed = 0;
    let failed = 0;

    for (const msg of messages) {
      const queueMsg = msg as QueueMessage;
      const eventId = queueMsg.message.event_id;
      const msgId = queueMsg.msg_id;

      try {
        await processEvent(supabase, eventId, msgId);
        processed++;
      } catch (err) {
        failed++;
        logger.error("Failed to process event", {
          event_id: eventId,
          queue_msg_id: msgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const result = { processed, failed, total: messages.length };
    logger.info("Batch processing complete", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.error("Worker error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response("Worker error", { status: 500 });
  }
});

async function processEvent(
  supabase: ReturnType<typeof getSupabaseClient>,
  eventId: string,
  msgId: number
): Promise<void> {
  // Load event
  const { data: event, error: fetchError } = await supabase
    
    .from("integration_events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (fetchError || !event) {
    logger.error("Event not found", { event_id: eventId });
    await supabase
      
      .rpc("delete_shiprocket_queue_message", { p_msg_id: msgId });
    return;
  }

  const integrationEvent = event as IntegrationEvent;

  // Skip processed/dead-lettered
  if (
    integrationEvent.status === "processed" ||
    integrationEvent.status === "dead_letter"
  ) {
    await supabase
      
      .rpc("archive_shiprocket_queue_message", { p_msg_id: msgId });
    return;
  }

  // Mark processing
  await supabase
    
    .from("integration_events")
    .update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
      attempt_count: integrationEvent.attempt_count + 1,
    })
    .eq("id", eventId);

  try {
    const payload = integrationEvent.payload;
    const fields = extractShiprocketFields(payload);

    if (!fields.sr_order_id) {
      throw new Error("No sr_order_id found in webhook payload");
    }

    const { data: existing } = await supabase
      .from("shiprocket_orders")
      .select("*")
      .eq("sr_order_id", fields.sr_order_id)
      .maybeSingle();

    const stale = isStaleWebhookTs(fields.current_ts, existing?.current_ts);
    const scan0 = stale ? null : fields.scans[0] ?? null;
    const scan1 = stale ? null : fields.scans[1] ?? null;
    const merged = mergeSparseOrder(existing as Record<string, unknown> | null, fields, stale);

    const { error: upsertError } = await supabase
      
      .from("shiprocket_orders")
      .upsert(
        {
          sr_order_id: fields.sr_order_id,
          unique_key: keepText(existing?.unique_key, fields.unique_key),
          shipment_status_id: merged.shipment_status_id,
          shipment_status: merged.shipment_status,
          current_status_id: merged.current_status_id,
          current_status: merged.current_status,
          current_ts: merged.current_ts,
          order_status: merged.order_status,
          order_status_code: merged.order_status_code,
          payment_status: merged.payment_status,
          payment_method: merged.payment_method,
          courier_name: merged.courier_name,
          awb: merged.awb,
          channel_id: merged.channel_id,
          shipment_id: merged.shipment_id,
          tracking_url: merged.tracking_url,
          is_return: merged.is_return,
          etd: merged.etd,
          order_date: merged.order_date,
          created_at_sr: merged.created_at_sr,
          customer_name: merged.customer_name,
          customer_email: merged.customer_email,
          customer_phone: merged.customer_phone,
          pickup_location: merged.pickup_location,
          order_total: merged.order_total,
          tax: merged.tax,
          products: merged.products,
          delivered_date: merged.delivered_date,
          return_awb_code: merged.return_awb_code,
          awb_assigned_date: merged.awb_assigned_date,
          pickup_scheduled_date: merged.pickup_scheduled_date,
          pickup_exception_reason: merged.pickup_exception_reason,
          undelivered_reason: merged.undelivered_reason,
          undelivered_reason_code: merged.undelivered_reason_code,
          pick_exception_reason_code: merged.pick_exception_reason_code,
          delivery_attempt_count: merged.delivery_attempt_count,
          pickup_attempt_count: merged.pickup_attempt_count,
          qc_image: merged.qc_image,
          qc_failure_reason: merged.qc_failure_reason,
          pod_status: merged.pod_status,
          pod: merged.pod,
          shipping_method: merged.shipping_method,
          billing_name: merged.billing_name,
          billing_email: merged.billing_email,
          billing_phone: merged.billing_phone,
          source_date: merged.source_date,
          last_local_api_sync_at: existing?.last_local_api_sync_at ?? null,
          scans1_status: stale ? existing?.scans1_status ?? null : keepText(existing?.scans1_status, scan1?.status),
          scans1_sr_status_label: stale ? existing?.scans1_sr_status_label ?? null : keepText(existing?.scans1_sr_status_label, scan1?.sr_status_label),
          scans1_sr_status: stale ? existing?.scans1_sr_status ?? null : keepText(existing?.scans1_sr_status, scan1?.sr_status),
          scans1_location: stale ? existing?.scans1_location ?? null : keepText(existing?.scans1_location, scan1?.location),
          scans1_date: stale ? existing?.scans1_date ?? null : keepText(existing?.scans1_date, scan1?.date),
          scans1_activity: stale ? existing?.scans1_activity ?? null : keepText(existing?.scans1_activity, scan1?.activity),
          scans0_status: stale ? existing?.scans0_status ?? null : keepText(existing?.scans0_status, scan0?.status),
          scans0_sr_status_label: stale ? existing?.scans0_sr_status_label ?? null : keepText(existing?.scans0_sr_status_label, scan0?.sr_status_label),
          scans0_sr_status: stale ? existing?.scans0_sr_status ?? null : keepText(existing?.scans0_sr_status, scan0?.sr_status),
          scans0_location: stale ? existing?.scans0_location ?? null : keepText(existing?.scans0_location, scan0?.location),
          scans0_date: stale ? existing?.scans0_date ?? null : keepText(existing?.scans0_date, scan0?.date),
          scans0_activity: stale ? existing?.scans0_activity ?? null : keepText(existing?.scans0_activity, scan0?.activity),
          raw_payload: stale && existing?.raw_payload ? existing.raw_payload : payload,
          integration_event_id: eventId,
          last_webhook_sync_at: new Date().toISOString(),
        },
        { onConflict: "sr_order_id" }
      );

    if (upsertError) {
      throw new Error(`Upsert failed: ${upsertError.message}`);
    }

    if (!stale && fields.all_scans.length > 0) {
      await supabase.from("shiprocket_scans").delete().eq("sr_order_id", fields.sr_order_id);
      await supabase.from("shiprocket_scans").insert(
        fields.all_scans.map((scan, index) => ({
          sr_order_id: fields.sr_order_id,
          awb: fields.awb,
          scan_index: index,
          scan_date: scan.date || null,
          status: scan.status || null,
          sr_status: scan.sr_status || null,
          sr_status_label: scan.sr_status_label || null,
          activity: scan.activity || null,
          location: scan.location || null,
          latitude: scan.latitude || null,
          longitude: scan.longitude || null,
        }))
      );
    }

    try {
      await supabase.rpc("enrich_shiprocket_order", {
        p_sr_order_id: fields.sr_order_id,
      });
    } catch (enrichErr) {
      logger.warn("Shopify enrichment failed after order upsert", {
        event_id: eventId,
        sr_order_id: fields.sr_order_id,
        error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
      });
    }

    logger.info("Order upserted", {
      event_id: eventId,
      sr_order_id: fields.sr_order_id,
      queue_msg_id: msgId,
    });

    // Send to Pabbly only when explicitly enabled (default false during parallel validation)
    const pabblyUrl = Deno.env.get("PABBLY_SHIPROCKET_URL");
    const pabblyEnabled =
      Deno.env.get("SHIPROCKET_PABBLY_ENABLED") === "true";

    if (pabblyEnabled && pabblyUrl) {
      await sendToPabbly(
        supabase,
        eventId,
        fields.sr_order_id,
        payload,
        pabblyUrl
      );
    }

    // Mark processed
    await supabase
      
      .from("integration_events")
      .update({
        status: "processed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", eventId);

    // Archive queue message
    await supabase
      
      .rpc("archive_shiprocket_queue_message", { p_msg_id: msgId });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const newAttemptCount = integrationEvent.attempt_count + 1;

    if (isDeadLetter(newAttemptCount)) {
      await supabase
        
        .from("integration_events")
        .update({ status: "dead_letter", last_error: errorMessage })
        .eq("id", eventId);

      await supabase
        
.rpc("delete_shiprocket_queue_message", { p_msg_id: msgId });

      logger.warn("Event dead-lettered", {
        event_id: eventId,
        attempt: newAttemptCount,
      });
    } else {
      const delaySeconds = Math.ceil(
        calculateRetryDelay(newAttemptCount) / 1000
      );

      await supabase
        
        .from("integration_events")
        .update({ status: "failed", last_error: errorMessage })
        .eq("id", eventId);

      await supabase
        
        .rpc("retry_shiprocket_queue_message", {
          p_msg_id: msgId,
          p_delay_seconds: delaySeconds,
        });

      logger.info("Event queued for retry", {
        event_id: eventId,
        attempt: newAttemptCount,
        delay_seconds: delaySeconds,
      });
    }

    throw err;
  }
}

async function sendToPabbly(
  supabase: ReturnType<typeof getSupabaseClient>,
  eventId: string,
  srOrderKey: string,
  payload: Record<string, unknown>,
  pabblyUrl: string
): Promise<void> {
  const { data: existing } = await supabase
    
    .from("shiprocket_pabbly_deliveries")
    .select("id")
    .eq("event_id", eventId)
    .eq("status", "sent")
    .single();

  if (existing) return;

  const { data: delivery } = await supabase
    
    .from("shiprocket_pabbly_deliveries")
    .upsert(
      {
        event_id: eventId,
        status: "pending",
        attempt_count: 0,
        first_attempt_at: new Date().toISOString(),
      },
      { onConflict: "event_id" }
    )
    .select("id")
    .single();

  if (!delivery) return;

  const { data: orderRow } = await supabase
    .from("shiprocket_order_explorer")
    .select("*")
    .eq("sr_order_id", srOrderKey)
    .single();

  if (!orderRow) return;

  const pabblyPayload: Record<string, unknown> = {
    "Shiprocket Unique Key": orderRow.unique_key ?? "",
    "Sr Order Id": orderRow.sr_order_id ?? "",
    "Shipment Status Id": orderRow.shipment_status_id ?? "",
    "Shipment Status": orderRow.shipment_status ?? "",
    "Scans 1 Status": orderRow.scans1_status ?? "",
    "Scans 1 Sr-status-label": orderRow.scans1_sr_status_label ?? "",
    "Scans 1 Sr-status": orderRow.scans1_sr_status ?? "",
    "Scans 1 Location": orderRow.scans1_location ?? "",
    "Scans 1 Date": orderRow.scans1_date ?? "",
    "Scans 1 Activity": orderRow.scans1_activity ?? "",
    "Scans 0 Status": orderRow.scans0_status ?? "",
    "Scans 0 Sr-status-label": orderRow.scans0_sr_status_label ?? "",
    "Scans 0 Sr-status": orderRow.scans0_sr_status ?? "",
    "Scans 0 Location": orderRow.scans0_location ?? "",
    "Scans 0 Date": orderRow.scans0_date ?? "",
    "Scans 0 Activity": orderRow.scans0_activity ?? "",
    "Order Id": orderRow.order_id ?? "",
    "Is Return": orderRow.is_return ?? "",
    Etd: orderRow.etd ?? "",
    "Current Timestamp": orderRow.current_ts ?? "",
    "Current Status Id": orderRow.current_status_id ?? "",
    "Current Status": orderRow.current_status ?? "",
    "Courier Name": orderRow.courier_name ?? "",
    "Channel Id": orderRow.channel_id ?? "",
    Awb: orderRow.awb ?? "",
    "Order Date": orderRow.order_date ?? "",
    "Created At": orderRow.created_at_sr ?? "",
    "Customer Name": orderRow.customer_name_shopify ?? "",
    "Customer Email": orderRow.customer_email ?? "",
    "Customer Phone": orderRow.customer_phone_shopify ?? "",
    "Pickup Location": orderRow.pickup_location ?? "",
    "Payment Status": orderRow.payment_status ?? "",
    "Payment Method": orderRow.payment_method ?? "",
    "Order Total": orderRow.order_total ?? "",
    Tax: orderRow.tax ?? "",
    "Order Status": orderRow.order_status ?? "",
    "Order Status Code": orderRow.order_status_code ?? "",
    "Shipment ID": orderRow.shipment_id ?? "",
    "Tracking URL": orderRow.tracking_url ?? "",
    "Delivered Date": orderRow.delivered_date ?? "",
    Products: orderRow.products ?? "",
    "Last Local API Sync At": orderRow.last_local_api_sync_at ?? "",
    "Last Webhook Sync At": orderRow.last_webhook_sync_at ?? "",
    Coach: orderRow.coach ?? "",
    "order id shopify format": orderRow.order_id_shopify_format ?? "",
    "Sheet Action": "created_new_row",
    "Sheet Row Number": "",
    "Sheet Error": "",
    "Webhook Event Id": eventId,
    "Pabbly Idempotency Key": eventId,
  };
  for (let i = 47; i <= 67; i++) {
    pabblyPayload[`Column ${i}`] = "";
  }

  try {
    const response = await fetch(pabblyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pabblyPayload),
    });

    const responseBody = await response.text();
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      parsedBody = { raw: responseBody };
    }

    await supabase
      
      .from("shiprocket_pabbly_deliveries")
      .update({
        status: response.ok ? "sent" : "failed",
        attempt_count: 1,
        response_code: response.status,
        response_body: parsedBody,
        last_attempt_at: new Date().toISOString(),
        sent_at: response.ok ? new Date().toISOString() : null,
      })
      .eq("id", delivery.id);

    logger.info("Pabbly delivery result", {
      event_id: eventId,
      sr_order_id: srOrderKey,
      success: response.ok,
      status: response.status,
    });
  } catch (err) {
    await supabase
      
      .from("shiprocket_pabbly_deliveries")
      .update({
        status: "failed",
        attempt_count: 1,
        last_error: err instanceof Error ? err.message : String(err),
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);
  }
}

// ============================================================
// Inline Shiprocket parser (Edge Function compatible)
// Exact port of Apps Script field extraction behavior.
// ============================================================

interface ShiprocketScan {
  status: string | null;
  sr_status_label: string | null;
  sr_status: string | null;
  location: string | null;
  date: string | null;
  activity: string | null;
  latitude: string | null;
  longitude: string | null;
}

interface ExtractedFields {
  sr_order_id: string | null;
  order_id: string | null;
  shipment_status_id: string | null;
  shipment_status: string | null;
  current_status_id: string | null;
  current_status: string | null;
  order_status: string | null;
  order_status_code: string | null;
  payment_status: string | null;
  payment_method: string | null;
  courier_name: string | null;
  awb: string | null;
  channel_id: string | null;
  shipment_id: string | null;
  tracking_url: string | null;
  is_return: boolean | null;
  etd: string | null;
  order_date: string | null;
  created_at_sr: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  pickup_location: string | null;
  order_total: string | null;
  tax: string | null;
  products: string | null;
  delivered_date: string | null;
  current_ts: string | null;
  unique_key: string | null;
  scans: ShiprocketScan[];
  all_scans: ShiprocketScan[];
  return_awb_code: string | null;
  awb_assigned_date: string | null;
  pickup_scheduled_date: string | null;
  pickup_exception_reason: string | null;
  undelivered_reason: string | null;
  undelivered_reason_code: string | null;
  pick_exception_reason_code: string | null;
  delivery_attempt_count: string | null;
  pickup_attempt_count: string | null;
  qc_image: string | null;
  qc_failure_reason: string | null;
  pod_status: string | null;
  pod: string | null;
  shipping_method: string | null;
  billing_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  source_date: string | null;
}

function normalizeKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function flattenObject(
  value: unknown,
  prefix = "",
  result: Record<string, unknown> = {}
): Record<string, unknown> {
  if (value === null || value === undefined) {
    if (prefix) result[prefix] = "";
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenObject(item, prefix ? `${prefix}.${index}` : String(index), result);
    });
    return result;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      flattenObject(
        (value as Record<string, unknown>)[key],
        prefix ? `${prefix}.${key}` : key,
        result
      );
    }
    return result;
  }
  if (prefix) result[prefix] = value;
  return result;
}

function pickRaw(
  object: Record<string, unknown> | null | undefined,
  keys: string[]
): unknown {
  if (!object || typeof object !== "object") return "";
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== "") {
      return object[key];
    }
  }
  const flat = flattenObject(object);
  const flatKeys = Object.keys(flat);
  for (const target of keys) {
    const nTarget = normalizeKey(target);
    for (const fk of flatKeys) {
      const nFlat = normalizeKey(fk);
      const lastPart = normalizeKey(fk.split(".").pop() || "");
      if (nFlat === nTarget || lastPart === nTarget) {
        const v = flat[fk];
        if (v !== undefined && v !== null && v !== "") return v;
      }
    }
  }
  return "";
}

function pickStr(
  object: Record<string, unknown> | null | undefined,
  keys: string[]
): string {
  const value = pickRaw(object, keys);
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function firstNonEmpty(...candidates: (string | null | undefined | unknown)[]): string {
  for (const v of candidates) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function getScanEntry(data: Record<string, unknown>, index: number): Record<string, unknown> {
  const scans = data.scans || data.scan || data.activities || data.shipment_track_activities;
  if (Array.isArray(scans) && scans[index]) return scans[index] as Record<string, unknown>;
  return {};
}

function pickScanField(scan: Record<string, unknown>, keys: string[]): string {
  if (!scan || typeof scan !== "object") return "";
  for (const key of keys) {
    if (scan[key] !== undefined && scan[key] !== null && scan[key] !== "") return String(scan[key]);
  }
  return "";
}

function isDeliveredText(v: unknown): boolean {
  return String(v || "").trim().toUpperCase() === "DELIVERED";
}

function stringifyIfObject(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function extractShiprocketFields(payload: Record<string, unknown>): ExtractedFields {
  let data: Record<string, unknown>;
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    data = payload.data as Record<string, unknown>;
  } else {
    data = (payload || {}) as Record<string, unknown>;
  }

  const scan0 = getScanEntry(data, 0);
  const scan1 = getScanEntry(data, 1);

  const srOrderId = pickStr(data, ["Sr Order Id", "sr_order_id", "srOrderId", "shiprocket_order_id", "shiprocketOrderId", "id"]);
  const orderId = pickStr(data, ["Order Id", "order_id", "channel_order_id", "channelOrderId", "channel_order", "order_number", "external_order_id"]);
  const shipmentStatus = pickStr(data, ["Shipment Status", "shipment_status", "shipmentStatus", "current_status", "Current Status", "status"]);
  const currentStatus = pickStr(data, ["Current Status", "current_status", "Shipment Status", "shipment_status", "status"]);
  const currentTimestamp = pickStr(data, ["Current Timestamp", "current_timestamp", "currentTimestamp", "updated_at", "event_time", "status_date_time", "current_status_time"]);
  const awb = pickStr(data, ["Awb", "awb", "awb_code", "awbCode", "awb_number", "tracking_number"]);
  const shipmentId = pickStr(data, ["Shipment ID", "Shipment Id", "shipment_id", "shipmentId", "shiprocket_shipment_id"]);

  const deliveredDate =
    isDeliveredText(shipmentStatus) || isDeliveredText(currentStatus)
      ? firstNonEmpty(pickStr(data, ["Delivered Date", "delivered_date", "delivery_date"]), currentTimestamp, new Date().toISOString())
      : pickStr(data, ["Delivered Date", "delivered_date", "delivery_date"]);

  return {
    sr_order_id: srOrderId || null,
    order_id: orderId || null,
    shipment_status_id: pickStr(data, ["Shipment Status Id", "shipment_status_id", "shipmentStatusId", "current_status_id", "Current Status Id", "status_id", "status_code"]) || null,
    shipment_status: shipmentStatus || null,
    current_status_id: pickStr(data, ["Current Status Id", "current_status_id", "Shipment Status Id", "shipment_status_id", "status_id", "status_code"]) || null,
    current_status: currentStatus || null,
    order_status: pickStr(data, ["Order Status", "order_status", "status"]) || null,
    order_status_code: pickStr(data, ["Order Status Code", "order_status_code", "status_code"]) || null,
    payment_status: pickStr(data, ["Payment Status", "payment_status"]) || null,
    payment_method: pickStr(data, ["Payment Method", "payment_method", "payment_mode"]) || null,
    courier_name: pickStr(data, ["Courier Name", "courier_name", "courier", "courier_company_name"]) || null,
    awb: awb || null,
    channel_id: pickStr(data, ["Channel Id", "channel_id", "channelId", "channel"]) || null,
    shipment_id: shipmentId || null,
    tracking_url: pickStr(data, ["Tracking URL", "tracking_url", "track_url", "tracking_link"]) || null,
    is_return: parseIsReturnWorker(pickStr(data, ["Is Return", "is_return", "isReturn", "return_order", "is_reverse"])),
    etd: pickStr(data, ["Etd", "etd", "edd", "expected_delivery_date"]) || null,
    order_date: pickStr(data, ["Order Date", "order_date", "channel_created_at", "created_at"]) || null,
    created_at_sr: pickStr(data, ["Created At", "created_at", "created_on"]) || null,
    customer_name: pickStr(data, ["Customer Name", "customer_name", "billing_name", "consignee_name", "buyer_name"]) || null,
    customer_email: pickStr(data, ["Customer Email", "customer_email", "billing_email", "email"]) || null,
    customer_phone: pickStr(data, ["Customer Phone", "customer_phone", "billing_phone", "phone", "mobile", "customer_mobile"]) || null,
    pickup_location: pickStr(data, ["Pickup Location", "pickup_location"]) || null,
    order_total: pickStr(data, ["Order Total", "total", "total_amount", "amount", "order_total"]) || null,
    tax: pickStr(data, ["Tax", "tax"]) || null,
    products: stringifyIfObject(pickRaw(data, ["Products", "products", "items", "line_items", "order_items"])) || null,
    delivered_date: deliveredDate || null,
    current_ts: currentTimestamp || null,
    unique_key: firstNonEmpty(pickStr(data, ["Shiprocket Unique Key", "shiprocket_unique_key"]), srOrderId ? `shiprocket_order:${srOrderId}` : "") || null,
    scans: [
      extractWorkerScan(scan0),
      extractWorkerScan(scan1),
    ],
    all_scans: getAllWorkerScans(data),
    return_awb_code: pickStr(data, ["return_awb_code", "returnAwbCode", "return_awb"]) || null,
    awb_assigned_date: pickStr(data, ["awb_assigned_date", "awbAssignedDate"]) || null,
    pickup_scheduled_date: pickStr(data, ["pickup_scheduled_date", "pickupScheduledDate"]) || null,
    pickup_exception_reason: pickStr(data, ["pickup_exception_reason", "pickupExceptionReason"]) || null,
    undelivered_reason: pickStr(data, ["undelivered_reason", "undeliveredReason"]) || null,
    undelivered_reason_code: pickStr(data, ["undelivered_reason_code", "undeliveredReasonCode"]) || null,
    pick_exception_reason_code: pickStr(data, ["pick_exception_reason_code", "pickup_exception_reason_code", "pickExceptionReasonCode"]) || null,
    delivery_attempt_count: pickStr(data, ["delivery_attempt_count", "deliveryAttemptCount"]) || null,
    pickup_attempt_count: pickStr(data, ["pickup_attempt_count", "pickupAttemptCount"]) || null,
    qc_image: pickStr(data, ["qc_image", "qcImage"]) || null,
    qc_failure_reason: pickStr(data, ["qc_failure_reason", "qcFailureReason"]) || null,
    pod_status: pickStr(data, ["pod_status", "podStatus"]) || null,
    pod: pickStr(data, ["pod"]) || null,
    shipping_method: pickStr(data, ["shipping_method", "shippingMethod"]) || null,
    billing_name: pickStr(data, ["billing_name", "billingName"]) || null,
    billing_email: pickStr(data, ["billing_email", "billingEmail"]) || null,
    billing_phone: pickStr(data, ["billing_phone", "billingPhone"]) || null,
    source_date: pickStr(data, ["date", "Date"]) || null,
  };
}

function parseIsReturnWorker(raw: string): boolean | null {
  if (!raw || raw.trim() === "") return null;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function extractWorkerScan(scan: Record<string, unknown>): ShiprocketScan {
  return {
    status: pickScanField(scan, ["status"]),
    sr_status_label: pickScanField(scan, ["sr-status-label", "sr_status_label", "srStatusLabel", "status_label"]),
    sr_status: pickScanField(scan, ["sr-status", "sr_status", "srStatus", "status_code"]),
    location: pickScanField(scan, ["location", "scan_location", "current_location"]),
    date: pickScanField(scan, ["date", "scan_date", "status_date", "created_at", "updated_at"]),
    activity: pickScanField(scan, ["activity", "description", "remarks", "message"]),
    latitude: pickScanField(scan, ["latitude", "lat"]),
    longitude: pickScanField(scan, ["longitude", "lng", "lon"]),
  };
}

function getAllWorkerScans(data: Record<string, unknown>): ShiprocketScan[] {
  const scans = data.scans || data.scan || data.activities || data.shipment_track_activities;
  if (Array.isArray(scans)) {
    return scans.map((item) => extractWorkerScan(item && typeof item === "object" ? item as Record<string, unknown> : {}));
  }
  if (scans && typeof scans === "object") {
    return [extractWorkerScan(scans as Record<string, unknown>)];
  }
  return [];
}

function keepText(existing: unknown, incoming: unknown): unknown {
  if (incoming === undefined || incoming === null || String(incoming).trim() === "") return existing ?? incoming;
  return incoming;
}

function isStaleWebhookTs(incoming: unknown, existing: unknown): boolean {
  if (!incoming || !existing) return false;
  const a = Date.parse(String(incoming));
  const b = Date.parse(String(existing));
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a < b;
}

function mergeSparseOrder(
  existing: Record<string, unknown> | null,
  incoming: ExtractedFields,
  stale: boolean
): Record<string, unknown> {
  const row: Record<string, unknown> = { ...(existing || {}), ...incoming };
  const keys = [
    "shipment_status_id", "shipment_status", "current_status_id", "current_status", "current_ts",
    "order_status", "order_status_code", "payment_status", "payment_method", "courier_name", "awb",
    "channel_id", "shipment_id", "tracking_url", "etd", "order_date", "created_at_sr", "customer_name",
    "customer_email", "customer_phone", "pickup_location", "order_total", "tax", "products", "delivered_date",
    "return_awb_code", "awb_assigned_date", "pickup_scheduled_date", "pickup_exception_reason",
    "undelivered_reason", "undelivered_reason_code", "pick_exception_reason_code", "delivery_attempt_count",
    "pickup_attempt_count", "qc_image", "qc_failure_reason", "pod_status", "pod", "shipping_method",
    "billing_name", "billing_email", "billing_phone", "source_date",
  ];
  for (const key of keys) {
    row[key] = keepText(existing?.[key], incoming[key as keyof ExtractedFields]);
  }
  if (incoming.is_return === null || incoming.is_return === undefined) {
    row.is_return = existing?.is_return ?? false;
  } else {
    row.is_return = incoming.is_return;
  }
  if (stale && existing) {
    row.current_status = existing.current_status;
    row.current_status_id = existing.current_status_id;
    row.current_ts = existing.current_ts;
    row.shipment_status = existing.shipment_status;
    row.shipment_status_id = existing.shipment_status_id;
  }
  return row;
}
