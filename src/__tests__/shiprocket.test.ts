import { extractWebhookFields, toOrderRow } from "../modules/shiprocket/parser";
import { computeRequestHash } from "../lib/integrations/hashing";
import { calculateRetryDelay, isDeadLetter } from "../lib/integrations/retry";
import type { ShiprocketOrderRow, ShiprocketWebhookPayload } from "../modules/shiprocket/types";
import {
  extractShopifyOrderId,
  normalizeShopifyLegacyPhone,
  deriveCoach,
  resolveShiprocketShopifyEnrichment,
} from "../modules/shiprocket/enrichment";
import { mergeShiprocketOrderRow, isStaleWebhook } from "../modules/shiprocket/merge";
import { buildLegacyPabblyPayload } from "../modules/shiprocket/legacy";
import { validateFilterRequest, ShiprocketFilterError, GLOBAL_SEARCH_COLUMNS, SHIPROCKET_FILTER_FIELDS } from "../modules/shiprocket/filters";
import {
  SHIPROCKET_EXPLORER_COLUMN_SET,
  SHIPROCKET_EXPLORER_COLUMNS,
} from "../modules/shiprocket/explorer-contract";
import * as XLSX from "xlsx";
import { getEnv } from "../config/env";
import {
  extractShiprocketWebhookSecret,
  forwardRawWebhookToAppsScript,
} from "../modules/shiprocket/forward";
import {
  buildSyntheticRemittanceWorkbook,
  cellText,
  hashRemittanceFile,
  indexOrdersForRemittanceMatch,
  matchRemittanceOrderRow,
  normalizeBusinessIdentifier,
  parseRemittanceWorkbook,
} from "../modules/shiprocket/remittance";
import { classifyShiprocketStatus, computeOverviewFromRows } from "../modules/shiprocket/status";

// ============================================================
// Test fixtures (fake data, no real PII)
// ============================================================

const DATA_FORMAT_PAYLOAD: ShiprocketWebhookPayload = {
  data: {
    "Sr Order Id": "SR-12345",
    "Order Id": "ORD-67890",
    "Shipment Status Id": "42",
    "Shipment Status": "Delivered",
    "Current Status Id": "42",
    "Current Status": "Delivered",
    "Current Timestamp": "2025-01-14T15:30:00Z",
    "Order Status": "Delivered",
    "Order Status Code": "6",
    "Payment Status": "Paid",
    "Payment Method": "COD",
    "Courier Name": "Delhivery",
    Awb: "AWB123456789",
    "Channel Id": "CH-001",
    "Shipment ID": "SH-001",
    "Tracking URL": "https://track.example.com/AWB123456789",
    "Is Return": false,
    Etd: "2025-01-15",
    "Order Date": "2025-01-10",
    "Created At": "2025-01-10T12:00:00Z",
    "Customer Name": "Test User",
    "Customer Email": "test@example.com",
    "Customer Phone": "9876543210",
    "Pickup Location": "Warehouse-1",
    "Order Total": "1500.00",
    Tax: "270.00",
    Products: "Test Product x 1",
    "Delivered Date": "2025-01-14",
    scans: [
      {
        status: "In Transit",
        "sr-status-label": "In Transit",
        "sr-status": "transit",
        location: "Pune Hub",
        date: "2025-01-13T08:00:00Z",
        activity: "Arrived at hub",
      },
      {
        status: "Delivered",
        "sr-status-label": "Delivered",
        "sr-status": "delivered",
        location: "Mumbai",
        date: "2025-01-14T15:30:00Z",
        activity: "Delivered to consignee",
      },
    ],
  },
};

const ROOT_FORMAT_PAYLOAD: ShiprocketWebhookPayload = {
  "Sr Order Id": "SR-99999",
  "Order Id": "ORD-11111",
  "Shipment Status": "In Transit",
  "Current Status": "In Transit",
  Awb: "AWB999888777",
  "Courier Name": "BlueDart",
  "Customer Name": "Root Format User",
  "Order Total": "2500.00",
  scans: [
    {
      status: "In Transit",
      location: "Delhi Hub",
      date: "2025-01-12T10:00:00Z",
      activity: "In transit to destination",
    },
  ],
};

const SNAKE_CASE_PAYLOAD: ShiprocketWebhookPayload = {
  data: {
    sr_order_id: "SR-SNAKE",
    order_id: "ORD-SNAKE",
    shipment_status: "Processing",
    current_status: "Processing",
    courier_name: "TestCourier",
    awb: "AWB-SNAKE",
    is_return: true,
    order_total: "999.99",
    scans: [],
  },
};

const CAMEL_CASE_PAYLOAD: ShiprocketWebhookPayload = {
  data: {
    srOrderId: "SR-CAMEL",
    orderId: "ORD-CAMEL",
    shipmentStatus: "Delivered",
    currentStatus: "Delivered",
    courierName: "CamelCourier",
    awbNumber: "AWB-CAMEL",
    isReturn: true,
    total: "500.00",
  },
};

const MISSING_SR_ORDER_ID_PAYLOAD: ShiprocketWebhookPayload = {
  data: {
    "Order Id": "ORD-NO-SR",
    "Shipment Status": "Unknown",
  },
};

const EMPTY_SCANS_PAYLOAD: ShiprocketWebhookPayload = {
  data: {
    "Sr Order Id": "SR-NO-SCANS",
    "Order Id": "ORD-NO-SCANS",
    "Shipment Status": "Processing",
    "Current Status": "Processing",
  },
};

const SINGLE_SCAN_OBJECT_PAYLOAD: ShiprocketWebhookPayload = {
  data: {
    "Sr Order Id": "SR-SINGLE-SCAN",
    scan: {
      status: "Delivered",
      location: "Chennai",
      activity: "Delivered",
    },
  },
};

const ACTIVITIES_KEY_PAYLOAD: ShiprocketWebhookPayload = {
  data: {
    "Sr Order Id": "SR-ACTIVITIES",
    activities: [
      { status: "Picked Up", location: "Warehouse" },
      { status: "Delivered", location: "Home" },
    ],
  },
};

const SHIPMENT_TRACK_ACTIVITIES_PAYLOAD: ShiprocketWebhookPayload = {
  data: {
    "Sr Order Id": "SR-TRACK-ACT",
    shipment_track_activities: [
      { status: "Booked", location: "Origin" },
      { status: "In Transit", location: "Hub" },
    ],
  },
};

const TITLE_CASE_ALTERNATES_PAYLOAD: ShiprocketWebhookPayload = {
  data: {
    "Shiprocket Unique Key": "UK-001",
    "Sr Order Id": "SR-TITLE",
    "Shipment Status": "Delivered",
    "Current Status": "Delivered",
    "Current Status Id": "42",
    "Current Timestamp": "2025-01-15T10:00:00Z",
    "Courier Name": "TitleCourier",
    "Channel Id": "CH-TITLE",
    Awb: "AWB-TITLE",
    "Shipment ID": "SH-TITLE",
    "Order Date": "2025-01-10",
    "Customer Name": "Title Case User",
    "Customer Email": "title@test.com",
    "Customer Phone": "1234567890",
    "Payment Status": "Paid",
    "Payment Method": "Prepaid",
    "Order Total": "3000.00",
    "Tracking URL": "https://track.example.com/TITLE",
    "Delivered Date": "2025-01-15",
    Products: "Title Product",
  },
};

// ============================================================
// Parser tests
// ============================================================

describe("Shiprocket Parser", () => {
  describe("extractWebhookFields", () => {
    it("extracts fields from payload.data format with Title Case keys", () => {
      const fields = extractWebhookFields(DATA_FORMAT_PAYLOAD);
      expect(fields.sr_order_id).toBe("SR-12345");
      expect(fields.order_id).toBe("ORD-67890");
      expect(fields.shipment_status).toBe("Delivered");
      expect(fields.current_status).toBe("Delivered");
      expect(fields.courier_name).toBe("Delhivery");
      expect(fields.awb).toBe("AWB123456789");
      expect(fields.is_return).toBe(false);
      expect(fields.customer_name).toBe("Test User");
      expect(fields.order_total).toBe("1500.00");
      expect(fields.payment_method).toBe("COD");
      expect(fields.payment_status).toBe("Paid");
      expect(fields.current_ts).toBe("2025-01-14T15:30:00Z");
      expect(fields.unique_key).toBe("shiprocket_order:SR-12345");
    });

    it("extracts scans — scan[0]=Scans 0 (older), scan[1]=Scans 1 (newer)", () => {
      const fields = extractWebhookFields(DATA_FORMAT_PAYLOAD);
      expect(fields.scans).toHaveLength(2);
      // scan[0] = "Scans 0" (older)
      expect(fields.scans[0].status).toBe("In Transit");
      expect(fields.scans[0].location).toBe("Pune Hub");
      expect(fields.scans[0].activity).toBe("Arrived at hub");
      // scan[1] = "Scans 1" (newer)
      expect(fields.scans[1].status).toBe("Delivered");
      expect(fields.scans[1].location).toBe("Mumbai");
      expect(fields.scans[1].activity).toBe("Delivered to consignee");
    });

    it("extracts fields from root-level payload format", () => {
      const fields = extractWebhookFields(ROOT_FORMAT_PAYLOAD);
      expect(fields.sr_order_id).toBe("SR-99999");
      expect(fields.order_id).toBe("ORD-11111");
      expect(fields.shipment_status).toBe("In Transit");
      expect(fields.courier_name).toBe("BlueDart");
      expect(fields.customer_name).toBe("Root Format User");
      expect(fields.scans).toHaveLength(2);
      expect(fields.scans[0].location).toBe("Delhi Hub");
      expect(fields.scans[1].location).toBe("");
    });

    it("extracts snake_case fields", () => {
      const fields = extractWebhookFields(SNAKE_CASE_PAYLOAD);
      expect(fields.sr_order_id).toBe("SR-SNAKE");
      expect(fields.order_id).toBe("ORD-SNAKE");
      expect(fields.shipment_status).toBe("Processing");
      expect(fields.courier_name).toBe("TestCourier");
      expect(fields.awb).toBe("AWB-SNAKE");
      expect(fields.is_return).toBe(true);
      expect(fields.order_total).toBe("999.99");
    });

    it("extracts camelCase fields", () => {
      const fields = extractWebhookFields(CAMEL_CASE_PAYLOAD);
      expect(fields.sr_order_id).toBe("SR-CAMEL");
      expect(fields.order_id).toBe("ORD-CAMEL");
      expect(fields.shipment_status).toBe("Delivered");
      expect(fields.courier_name).toBe("CamelCourier");
      expect(fields.awb).toBe("AWB-CAMEL");
      expect(fields.is_return).toBe(true);
      expect(fields.order_total).toBe("500.00");
    });

    it("returns null sr_order_id when missing", () => {
      const fields = extractWebhookFields(MISSING_SR_ORDER_ID_PAYLOAD);
      expect(fields.sr_order_id).toBeNull();
    });

    it("handles empty scans array", () => {
      const fields = extractWebhookFields(EMPTY_SCANS_PAYLOAD);
      expect(fields.sr_order_id).toBe("SR-NO-SCANS");
      expect(fields.scans).toHaveLength(2);
      expect(fields.scans[0].status).toBe("");
      expect(fields.scans[1].status).toBe("");
    });

    it("handles scan as single object (not array)", () => {
      const fields = extractWebhookFields(SINGLE_SCAN_OBJECT_PAYLOAD);
      expect(fields.sr_order_id).toBe("SR-SINGLE-SCAN");
      expect(fields.scans).toHaveLength(2);
      expect(fields.scans[0].status).toBe("Delivered");
      expect(fields.scans[0].location).toBe("Chennai");
      expect(fields.scans[1].status).toBe("");
    });

    it("handles activities key instead of scans", () => {
      const fields = extractWebhookFields(ACTIVITIES_KEY_PAYLOAD);
      expect(fields.sr_order_id).toBe("SR-ACTIVITIES");
      expect(fields.scans).toHaveLength(2);
      expect(fields.scans[0].status).toBe("Picked Up");
      expect(fields.scans[1].status).toBe("Delivered");
    });

    it("handles shipment_track_activities key", () => {
      const fields = extractWebhookFields(SHIPMENT_TRACK_ACTIVITIES_PAYLOAD);
      expect(fields.sr_order_id).toBe("SR-TRACK-ACT");
      expect(fields.scans).toHaveLength(2);
      expect(fields.scans[0].status).toBe("Booked");
      expect(fields.scans[1].status).toBe("In Transit");
    });

    it("handles missing optional fields gracefully", () => {
      const fields = extractWebhookFields(MISSING_SR_ORDER_ID_PAYLOAD);
      expect(fields.courier_name).toBeNull();
      expect(fields.awb).toBeNull();
      expect(fields.tracking_url).toBeNull();
      expect(fields.customer_email).toBeNull();
      expect(fields.is_return).toBeNull();
    });

    it("extracts Title Case alternates (Shiprocket Unique Key, etc.)", () => {
      const fields = extractWebhookFields(TITLE_CASE_ALTERNATES_PAYLOAD);
      expect(fields.sr_order_id).toBe("SR-TITLE");
      expect(fields.unique_key).toBe("UK-001");
      expect(fields.shipment_status).toBe("Delivered");
      expect(fields.current_status).toBe("Delivered");
      expect(fields.current_status_id).toBe("42");
      expect(fields.current_ts).toBe("2025-01-15T10:00:00Z");
      expect(fields.courier_name).toBe("TitleCourier");
      expect(fields.channel_id).toBe("CH-TITLE");
      expect(fields.awb).toBe("AWB-TITLE");
      expect(fields.shipment_id).toBe("SH-TITLE");
      expect(fields.customer_name).toBe("Title Case User");
      expect(fields.payment_status).toBe("Paid");
      expect(fields.payment_method).toBe("Prepaid");
      expect(fields.order_total).toBe("3000.00");
      expect(fields.tracking_url).toBe("https://track.example.com/TITLE");
      expect(fields.delivered_date).toBe("2025-01-15");
    });

    it("auto-sets delivered_date for delivered orders when missing", () => {
      const payload: ShiprocketWebhookPayload = {
        data: {
          "Sr Order Id": "SR-DEL-AUTO",
          "Shipment Status": "Delivered",
          "Current Status": "Delivered",
          "Current Timestamp": "2025-01-15T12:00:00Z",
        },
      };
      const fields = extractWebhookFields(payload);
      expect(fields.delivered_date).toBe("2025-01-15T12:00:00Z");
    });

    it("stringifies products when it is an object", () => {
      const payload: ShiprocketWebhookPayload = {
        data: {
          "Sr Order Id": "SR-PROD",
          products: [{ name: "Item 1", qty: 2 }],
        },
      };
      const fields = extractWebhookFields(payload);
      expect(fields.products).toContain("Item 1");
    });
  });

  describe("toOrderRow", () => {
    it("maps scan[0] to scans0_* and scan[1] to scans1_*", () => {
      const fields = extractWebhookFields(DATA_FORMAT_PAYLOAD);
      const row = toOrderRow(
        fields,
        DATA_FORMAT_PAYLOAD as Record<string, unknown>,
        "test-event-id"
      );
      expect(row.sr_order_id).toBe("SR-12345");
      expect(row.order_id).toBe("ORD-67890");
      // scans1_* = scan[1] (newer)
      expect(row.scans1_status).toBe("Delivered");
      expect(row.scans1_location).toBe("Mumbai");
      expect(row.scans1_activity).toBe("Delivered to consignee");
      // scans0_* = scan[0] (older)
      expect(row.scans0_status).toBe("In Transit");
      expect(row.scans0_location).toBe("Pune Hub");
      expect(row.scans0_activity).toBe("Arrived at hub");
      // Latest scan (scan[1] is newer)
      expect(row.scan_status).toBe("Delivered");
      expect(row.scan_location).toBe("Mumbai");
    });

    it("maps a live tracking webhook including order_id and RTO fields", () => {
      const payload = {
        awb: "77914492460",
        courier_name: "BlueDart Surface 2Kg_Spl",
        current_status: "RTO IN TRANSIT",
        current_status_id: 55,
        shipment_status: "RTO IN TRANSIT",
        shipment_status_id: 46,
        return_awb_code: "77151457062",
        current_timestamp: "29 08 2026 04:13:38",
        order_id: "62622899",
        sr_order_id: 1511237326,
        etd: "2026-08-23 00:00:00",
        undelivered_reason: "COD Not Ready",
        undelivered_reason_code: "SRNDR3",
        delivery_attempt_count: 2,
        awb_assigned_date: "2026-08-13 09:16:41",
        pickup_scheduled_date: "2026-08-13 09:16:47",
        pod_status: "OTP Based Delivery",
        pod: "Available",
        shipping_method: "SR",
        delivered_date: "",
        is_return: 0,
        date: "2026-08-29 04:04:00",
      };
      const fields = extractWebhookFields(payload);
      const row = toOrderRow(fields, payload, "evt-1");
      expect(row.sr_order_id).toBe("1511237326");
      expect(row.order_id).toBe("62622899");
      expect(row.awb).toBe("77914492460");
      expect(row.return_awb_code).toBe("77151457062");
      expect(row.undelivered_reason).toBe("COD Not Ready");
      expect(row.etd).toBe("2026-08-23 00:00:00");
      expect(row.shipping_method).toBe("SR");
      expect(row.pod_status).toBe("OTP Based Delivery");
      expect(row.current_ts).toBe("29 08 2026 04:13:38");
      expect(row.delivered_date).toBeNull();
    });

    it("defaults to UNKNOWN when sr_order_id is null", () => {
      const fields = extractWebhookFields(MISSING_SR_ORDER_ID_PAYLOAD);
      const row = toOrderRow(
        fields,
        MISSING_SR_ORDER_ID_PAYLOAD as Record<string, unknown>,
        "test-event-id"
      );
      expect(row.sr_order_id).toBe("UNKNOWN");
    });
  });
});

describe("Shopify order id extraction", () => {
  it("extracts the first 8-digit sequence", () => {
    expect(extractShopifyOrderId("62622018")).toBe("62622018");
    expect(extractShopifyOrderId("62622018-C")).toBe("62622018");
    expect(extractShopifyOrderId("abc62622018xyz")).toBe("62622018");
    expect(extractShopifyOrderId("6251749")).toBe("");
    expect(extractShopifyOrderId("")).toBe("");
    expect(extractShopifyOrderId(null)).toBe("");
  });
});

describe("Customer Name / Phone / Coach", () => {
  it("uses Shopify name and never falls back to Shiprocket", () => {
    const matched = resolveShiprocketShopifyEnrichment("62622018", {
      shopifyOrderId: "gid://shopify/Order/1",
      customerName: "Test Customer",
      shippingPhone: "+91 98765 43210",
      mainPhone: "9999999999",
    });
    expect(matched.customerName).toBe("Test Customer");
    expect(matched.customerPhone).toBe("919876543210");
    expect(matched.coach).toBe("Misba");
    expect(matched.orderIdShopifyFormat).toBe("62622018");
    expect(matched.matchedShopifyOrder).toBe(true);

    const unmatched = resolveShiprocketShopifyEnrichment("62622018", null);
    expect(unmatched.customerName).toBe("");
    expect(unmatched.customerPhone).toBe("");
    expect(unmatched.matchedShopifyOrder).toBe(false);
  });

  it("prefers shipping phone then main phone", () => {
    expect(
      resolveShiprocketShopifyEnrichment("12345678", {
        shopifyOrderId: "1",
        customerName: "Test Customer",
        shippingPhone: "",
        mainPhone: "9876543210",
      }).customerPhone
    ).toBe("919876543210");

    expect(
      resolveShiprocketShopifyEnrichment("12345678", {
        shopifyOrderId: "1",
        customerName: "Test Customer",
        shippingPhone: "",
        mainPhone: "",
      }).customerPhone
    ).toBe("");
  });

  it("normalizes punctuation without adding +", () => {
    expect(normalizeShopifyLegacyPhone("+91 98765 43210")).toBe("919876543210");
    expect(normalizeShopifyLegacyPhone("98765-43210")).toBe("919876543210");
  });

  it("sets Coach from Order Id presence only", () => {
    expect(deriveCoach("12345678")).toBe("Misba");
    expect(deriveCoach("")).toBe("");
  });
});

function sampleRow(overrides: Partial<ShiprocketOrderRow> = {}): ShiprocketOrderRow {
  return {
    sr_order_id: "1000000001",
    order_id: "12345678",
    shipment_status_id: "7",
    shipment_status: "DELIVERED",
    current_status_id: "7",
    current_status: "DELIVERED",
    current_ts: "2026-01-02T12:00:00Z",
    order_status: "DELIVERED",
    order_status_code: "7",
    payment_status: "PAID",
    payment_method: "COD",
    courier_name: "BlueDart",
    awb: "TESTAWB001",
    channel_id: "1",
    shipment_id: "SH1",
    tracking_url: "https://example.test/track",
    is_return: false,
    etd: "2026-01-03",
    order_date: "2026-01-01",
    created_at_sr: "2026-01-01T00:00:00Z",
    customer_name: "Shiprocket Name",
    customer_email: "test@example.com",
    customer_phone: "9999999999",
    pickup_location: "WH1",
    order_total: "1499",
    tax: "0",
    products: "[]",
    delivered_date: "2026-01-02",
    scan_status: null,
    scan_sr_status_label: null,
    scan_sr_status: null,
    scan_location: null,
    scan_date: null,
    scan_activity: null,
    scans1_status: "DELIVERED",
    scans1_sr_status_label: null,
    scans1_sr_status: null,
    scans1_location: null,
    scans1_date: null,
    scans1_activity: null,
    scans0_status: "IN TRANSIT",
    scans0_sr_status_label: null,
    scans0_sr_status: null,
    scans0_location: null,
    scans0_date: null,
    scans0_activity: null,
    ...overrides,
  };
}

describe("Sparse webhook merging", () => {
  it("keeps API-enriched fields when a tracking webhook omits them", () => {
    const existing = sampleRow();
    const incoming = sampleRow({
      customer_email: null,
      payment_method: null,
      order_total: null,
      current_status: "OUT FOR DELIVERY",
      current_status_id: "6",
      current_ts: "2026-01-02T15:00:00Z",
      scans1_status: "OUT FOR DELIVERY",
    });
    const merged = mergeShiprocketOrderRow(existing, incoming);
    expect(merged.customer_email).toBe("test@example.com");
    expect(merged.payment_method).toBe("COD");
    expect(merged.order_total).toBe("1499");
    expect(merged.current_status).toBe("OUT FOR DELIVERY");
    expect(merged.current_status_id).toBe("6");
    expect(merged.current_ts).toBe("2026-01-02T15:00:00Z");
    expect(merged.scans1_status).toBe("OUT FOR DELIVERY");
  });
});

describe("Stale webhook", () => {
  it("does not regress current status when incoming timestamp is older", () => {
    expect(isStaleWebhook("2026-01-01T10:00:00Z", "2026-01-02T12:00:00Z")).toBe(true);
    const existing = sampleRow({ current_status: "DELIVERED", current_ts: "2026-01-02T12:00:00Z" });
    const incoming = sampleRow({
      current_status: "IN TRANSIT",
      current_ts: "2026-01-01T10:00:00Z",
    });
    const merged = mergeShiprocketOrderRow(existing, incoming, { staleCurrentState: true });
    expect(merged.current_status).toBe("DELIVERED");
    expect(merged.current_ts).toBe("2026-01-02T12:00:00Z");
  });
});

describe("Pabbly payload contract", () => {
  it("uses exact legacy keys and Shopify-derived customer fields", () => {
    const payload = buildLegacyPabblyPayload({
      sr_order_id: "1000000001",
      unique_key: "shiprocket_order:1000000001",
      order_id: "12345678",
      customer_name_shopify: "Test Customer",
      customer_phone_shopify: "919876543210",
      coach: "Misba",
      order_id_shopify_format: "12345678",
    });
    expect(payload).toHaveProperty("Customer Name", "Test Customer");
    expect(payload).toHaveProperty("Customer Phone", "919876543210");
    expect(payload).toHaveProperty("Coach", "Misba");
    expect(payload).toHaveProperty("order id shopify format", "12345678");
    expect(payload).toHaveProperty("Column 47", "");
    expect(payload).toHaveProperty("Column 67", "");
    expect(payload).not.toHaveProperty("Raw Shiprocket JSON");
    expect(Object.keys(payload)).not.toContain("customer_name");
  });
});

describe("Apps Script fan-out", () => {
  it("reads the webhook secret from x-api-key", () => {
    const secret = extractShiprocketWebhookSecret({
      headers: {
        get: (name: string) => (name.toLowerCase() === "x-api-key" ? "test-webhook-secret" : null),
      },
    });
    expect(secret).toBe("test-webhook-secret");
  });

  it("reads a raw Authorization token from the Shiprocket dashboard", () => {
    const secret = extractShiprocketWebhookSecret({
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "authorization" ? "dashboard-token" : null,
      },
    });
    expect(secret).toBe("dashboard-token");
  });

  it("reads the webhook secret from query hook_key when headers are absent", () => {
    const url = new URL("https://example.test/api/webhooks/delivery-events?hook_key=test-webhook-secret");
    const secret = extractShiprocketWebhookSecret({
      headers: { get: () => null },
      url: url.toString(),
    });
    expect(secret).toBe("test-webhook-secret");
  });

  it("forwards the raw body to Apps Script and does not treat a 500 as success", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await forwardRawWebhookToAppsScript({
        url: "https://script.example.test/macros/s/fake/exec?hook_key=test",
        rawBody: '{"sr_order_id":"1000000001"}',
      });
      expect(result.ok).toBe(false);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://script.example.test/macros/s/fake/exec?hook_key=test",
        expect.objectContaining({
          method: "POST",
          body: '{"sr_order_id":"1000000001"}',
          redirect: "manual",
        })
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("treats Apps Script 302 as a successful forward", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 302 });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await forwardRawWebhookToAppsScript({
        url: "https://script.google.com/macros/s/fake/exec",
        rawBody: '{"sr_order_id":"1000000001"}',
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe(302);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("Parallel Pabbly mode", () => {
  it("keeps production send disabled by default", () => {
    expect(process.env.SHIPROCKET_PABBLY_ENABLED).toBe("false");
    expect(getEnv().SHIPROCKET_PABBLY_ENABLED).toBe(false);
  });
});

describe("Filter builder", () => {
  it("accepts safe AND filters and grouped OR", () => {
    const parsed = validateFilterRequest({
      filters: [
        { field: "shipment_status", operator: "contains", value: "DELIVERED" },
        { field: "current_status", operator: "in", value: ["OUT FOR DELIVERY", "DELIVERED"] },
        { field: "order_total", operator: "gte", value: 1499 },
        { field: "delivered_date", operator: "between", value: ["2026-01-01", "2026-01-31"] },
        { field: "customer_phone_shopify", operator: "not_empty" },
        { or: [{ field: "payment_method", operator: "eq", value: "COD" }, { field: "payment_method", operator: "eq", value: "Prepaid" }] },
      ],
      sort: [{ field: "delivered_date", direction: "desc" }],
      page: 1,
      pageSize: 25,
    });
    expect(parsed.filters).toHaveLength(6);
  });

  it("rejects unknown fields, operators, SQL, bad dates, and huge pages", () => {
    expect(() => validateFilterRequest({ filters: [{ field: "drop table", operator: "eq", value: "x" }] })).toThrow(ShiprocketFilterError);
    expect(() => validateFilterRequest({ filters: [{ field: "shipment_status", operator: "union select", value: "x" }] })).toThrow(ShiprocketFilterError);
    expect(() => validateFilterRequest({ filters: [{ field: "not_a_real_field", operator: "eq", value: "x" }] })).toThrow(ShiprocketFilterError);
    expect(() => validateFilterRequest({ filters: [{ field: "delivered_date", operator: "on", value: "not-a-date" }] })).toThrow(ShiprocketFilterError);
    expect(() => validateFilterRequest({ pageSize: 5000 })).toThrow();
  });
});

describe("Explorer query contract", () => {
  it("keeps filter/search columns inside shiprocket_order_explorer projection", () => {
    for (const field of SHIPROCKET_FILTER_FIELDS) {
      if (field.key === "raw_payload") continue;
      expect(SHIPROCKET_EXPLORER_COLUMN_SET.has(field.column)).toBe(true);
    }
    for (const column of GLOBAL_SEARCH_COLUMNS) {
      expect(SHIPROCKET_EXPLORER_COLUMN_SET.has(column)).toBe(true);
    }
    expect(SHIPROCKET_EXPLORER_COLUMNS).toContain("billing_name");
    expect(SHIPROCKET_EXPLORER_COLUMNS).toContain("billing_email");
    expect(SHIPROCKET_EXPLORER_COLUMNS).toContain("billing_phone");
  });
});

describe("Remittance parser", () => {
  it("reads both sheets, keeps Remmitance Type, and does not treat UTR as unique", () => {
    const parsed = parseRemittanceWorkbook(buildSyntheticRemittanceWorkbook());
    expect(parsed.crfRows).toHaveLength(1);
    expect(parsed.awbRows).toHaveLength(3);
    expect(parsed.crfRows[0].crf_id).toBe("CRF-TEST-001");
    expect(parsed.crfRows[0].utr).toBe("IN20000000000000");
    expect(parsed.awbRows.every((row) => row.utr === "IN20000000000000")).toBe(true);
    expect(parsed.awbRows.map((row) => row.awb)).toEqual(["TESTAWB001", "TESTAWB002", "TESTAWB003"]);
    expect(parsed.awbRows[0].remittance_type).toBe("Standard");
    expect(new Set(parsed.awbRows.map((row) => row.utr)).size).toBe(1);
    expect(hashRemittanceFile(buildSyntheticRemittanceWorkbook())).toBe(
      hashRemittanceFile(buildSyntheticRemittanceWorkbook())
    );
  });

  it("preserves numeric AWB identifiers without scientific notation", () => {
    expect(normalizeBusinessIdentifier("1.904076086893E+12")).toBe("1904076086893");
    expect(normalizeBusinessIdentifier("1904076086893")).toBe("1904076086893");

    const sheet: XLSX.WorkSheet = {
      B2: { t: "n", v: 1.904076086893e12, w: "1904076086893" },
    };
    expect(cellText(sheet, "B2")).toBe("1904076086893");

    const awbHeader = [...["CRF ID", "AWB", "Delivered Date", "Shipped Date", "Order Id", "Courier", "Order Value", "Channel Name", "Remmitance Type", "Remittance Date", "UTR", "total_adjusted_amt", "Linked CRF Ids"]];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        awbHeader,
        ["CRF-TEST-001", "1904076086893", "2026-08-01", "2026-07-28", "62622018", "Delhivery", 1499, "Shopify", "Standard", "2026-08-10", "IN20000000000000", 0, ""],
      ]),
      "AWB level report"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Date", "CRF ID", "COD Available", "Instant COD Available", "Standard COD Available", "Early COD Available", "Freight Charges from COD", "RTO Reversal Amount", "Remittance Amount", "Remittance Method", "UTR", "Adjusted Amount", "Status", "remarks", "Early COD Charges", "Instant COD Charges"],
        ["2026-08-10", "CRF-TEST-001", 100, 0, 100, 0, 0, 0, 100, "NEFT", "IN20000000000000", 0, "Remittance success", "", 0, 0],
      ]),
      "CRF level report"
    );
    const parsed = parseRemittanceWorkbook(Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })));
    expect(parsed.awbRows[0].awb).toBe("1904076086893");
    expect(parsed.awbRows[0].order_id).toBe("62622018");
  });
});

describe("Remittance matching", () => {
  const index = indexOrdersForRemittanceMatch([
    { sr_order_id: "SR-1", awb: "TESTAWB001", order_id: "12345678" },
    { sr_order_id: "SR-2", awb: "TESTAWB009", order_id: "99999999" },
    { sr_order_id: "SR-3", awb: "", order_id: "DUP-ORDER" },
    { sr_order_id: "SR-4", awb: "", order_id: "DUP-ORDER" },
  ]);

  it("matches exact AWB", () => {
    expect(matchRemittanceOrderRow({ awb: "TESTAWB001", order_id: "nope" }, index)).toEqual({
      status: "matched",
      matchedSrOrderId: "SR-1",
    });
  });

  it("matches numeric AWB strings normalized on both sides", () => {
    const numericIndex = indexOrdersForRemittanceMatch([
      { sr_order_id: "SR-N", awb: "1904076086893", order_id: "62622018" },
    ]);
    expect(matchRemittanceOrderRow({ awb: "1904076086893", order_id: "" }, numericIndex)).toEqual({
      status: "matched",
      matchedSrOrderId: "SR-N",
    });
    expect(matchRemittanceOrderRow({ awb: "1.904076086893E+12", order_id: "" }, numericIndex)).toEqual({
      status: "matched",
      matchedSrOrderId: "SR-N",
    });
  });

  it("matches exact order id when AWB is absent", () => {
    expect(matchRemittanceOrderRow({ awb: "", order_id: "12345678" }, index)).toEqual({
      status: "matched",
      matchedSrOrderId: "SR-1",
    });
  });

  it("does not pick an arbitrary row for an ambiguous order id", () => {
    expect(matchRemittanceOrderRow({ awb: "", order_id: "DUP-ORDER" }, index)).toEqual({
      status: "ambiguous",
      matchedSrOrderId: null,
    });
  });

  it("keeps unmatched settlement rows", () => {
    expect(matchRemittanceOrderRow({ awb: "MISSINGAWB", order_id: "MISSINGORDER" }, index)).toEqual({
      status: "unmatched",
      matchedSrOrderId: null,
    });
  });
});

describe("KPI and table consistency", () => {
  it("classifies RTO Delivered as rto, not delivered", () => {
    expect(classifyShiprocketStatus("RTO Delivered", "RTO Delivered")).toBe("rto");
    expect(classifyShiprocketStatus("Delivered", "")).toBe("delivered");
  });

  it("uses the same population for table count and KPIs", () => {
    const rows = [
      { sr_order_id: "1", status_bucket: "delivered", shipment_status: "Delivered", courier_name: "Delhivery", payment_method: "COD", order_total_num: 100, remittance_match_status: "unmatched" },
      { sr_order_id: "2", status_bucket: "delivered", shipment_status: "Delivered", courier_name: "Delhivery", payment_method: "Prepaid", order_total_num: 200, remittance_match_status: "matched", latest_crf_id: "CRF-TEST-001", latest_utr: "IN20000000000000", latest_order_settlement_value: 200 },
      { sr_order_id: "3", status_bucket: "delivered", shipment_status: "Delivered", courier_name: "BlueDart", payment_method: "COD", order_total_num: 300, remittance_match_status: "unmatched" },
      { sr_order_id: "4", status_bucket: "in_transit", shipment_status: "IN TRANSIT", courier_name: "Delhivery", payment_method: "COD", order_total_num: 400, remittance_match_status: "unmatched" },
      { sr_order_id: "5", status_bucket: "rto", shipment_status: "RTO Delivered", courier_name: "Delhivery", payment_method: "COD", order_total_num: 500, remittance_match_status: "unmatched" },
    ];
    const all = computeOverviewFromRows(rows);
    expect(all.totalOrders).toBe(5);
    expect(all.delivered).toBe(3);
    expect(all.inTransit).toBe(1);
    expect(all.rto).toBe(1);
    const delhivery = computeOverviewFromRows(rows.filter((row) => row.courier_name === "Delhivery"));
    expect(delhivery.totalOrders).toBe(4);
    expect(delhivery.delivered).toBe(2);
    expect(delhivery.inTransit).toBe(1);
    expect(delhivery.rto).toBe(1);
  });

  it("does not multiply one order when scans and remittance exist", () => {
    const overview = computeOverviewFromRows([
      {
        sr_order_id: "SR-1",
        status_bucket: "delivered",
        remittance_count: 2,
        remittance_match_status: "matched",
        latest_crf_id: "CRF-TEST-001",
      },
    ]);
    expect(overview.totalOrders).toBe(1);
    expect(overview.settledOrders).toBe(1);
  });
});

describe("Webhook billing fields", () => {
  it("extracts billing fields without using them as the Shopify customer fallback", () => {
    const fields = extractWebhookFields({
      billing_name: "Webhook Billing",
      billing_email: "billing@example.test",
      billing_phone: "9999999999",
      customer_name: "Webhook Customer",
      sr_order_id: "1000000001",
    });
    expect(fields.billing_name).toBe("Webhook Billing");
    expect(fields.billing_email).toBe("billing@example.test");
    expect(fields.customer_name).toBe("Webhook Customer");
  });
});

// ============================================================
// Hashing tests
// ============================================================

describe("Request Hashing", () => {
  it("produces deterministic SHA-256 hash", () => {
    const body = '{"test":"data"}';
    const hash1 = computeRequestHash(body);
    const hash2 = computeRequestHash(body);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = computeRequestHash('{"a":1}');
    const hash2 = computeRequestHash('{"b":2}');
    expect(hash1).not.toBe(hash2);
  });
});

// ============================================================
// Retry tests
// ============================================================

describe("Retry Logic", () => {
  it("calculates exponential backoff", () => {
    expect(calculateRetryDelay(1)).toBe(15000);
    expect(calculateRetryDelay(2)).toBe(30000);
    expect(calculateRetryDelay(3)).toBe(60000);
    expect(calculateRetryDelay(4)).toBe(120000);
  });

  it("caps at 15 minutes", () => {
    expect(calculateRetryDelay(20)).toBe(15 * 60 * 1000);
    expect(calculateRetryDelay(100)).toBe(15 * 60 * 1000);
  });

  it("detects dead letters", () => {
    expect(isDeadLetter(9)).toBe(false);
    expect(isDeadLetter(10)).toBe(true);
    expect(isDeadLetter(11)).toBe(true);
  });

  it("respects custom max attempts", () => {
    expect(isDeadLetter(5, 5)).toBe(true);
    expect(isDeadLetter(4, 5)).toBe(false);
  });
});

describe("Pabbly dispatch architecture", () => {
  it("defaults to Pabbly disabled", () => {
    expect(process.env.SHIPROCKET_PABBLY_ENABLED).toBe("false");
  });

  it("includes pabbly_status in explorer columns", () => {
    expect(SHIPROCKET_EXPLORER_COLUMN_SET.has("pabbly_status")).toBe(true);
    expect(SHIPROCKET_EXPLORER_COLUMN_SET.has("pabbly_attempt_count")).toBe(true);
    expect(SHIPROCKET_EXPLORER_COLUMN_SET.has("pabbly_sent_at")).toBe(true);
    expect(SHIPROCKET_EXPLORER_COLUMN_SET.has("pabbly_delivery_count")).toBe(true);
    expect(SHIPROCKET_EXPLORER_COLUMN_SET.has("pabbly_sent_count")).toBe(true);
    expect(SHIPROCKET_EXPLORER_COLUMN_SET.has("pabbly_failed_count")).toBe(true);
  });

  it("includes pabbly fields in filter metadata", () => {
    const pabblyFields = SHIPROCKET_FILTER_FIELDS.filter((f) => f.group === "Pabbly Delivery");
    expect(pabblyFields.length).toBeGreaterThanOrEqual(6);
    const pabblyStatus = pabblyFields.find((f) => f.key === "pabbly_status");
    expect(pabblyStatus).toBeDefined();
    expect(pabblyStatus!.type).toBe("enum");
  });

  it("computes Pabbly KPIs in overview", () => {
    const overview = computeOverviewFromRows([
      { sr_order_id: "SR-1", pabbly_status: "sent" },
      { sr_order_id: "SR-2", pabbly_status: "sent" },
      { sr_order_id: "SR-3", pabbly_status: "failed" },
      { sr_order_id: "SR-4", pabbly_status: "pending" },
      { sr_order_id: "SR-5", pabbly_status: "retrying" },
      { sr_order_id: "SR-6" },
    ]);
    expect(overview.pabblySent).toBe(2);
    expect(overview.pabblyFailed).toBe(1);
    expect(overview.pabblyPending).toBe(1);
    expect(overview.pabblyRetrying).toBe(1);
    expect(overview.pabblyTotalDeliveries).toBe(5);
  });

  it("handles null/empty Pabbly status in overview", () => {
    const overview = computeOverviewFromRows([
      { sr_order_id: "SR-1" },
      { sr_order_id: "SR-2", pabbly_status: "" },
      { sr_order_id: "SR-3", pabbly_status: null },
    ]);
    expect(overview.pabblySent).toBe(0);
    expect(overview.pabblyFailed).toBe(0);
    expect(overview.pabblyPending).toBe(0);
    expect(overview.pabblyRetrying).toBe(0);
    expect(overview.pabblyTotalDeliveries).toBe(0);
  });
});
