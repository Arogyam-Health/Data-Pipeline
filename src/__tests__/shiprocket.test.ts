import { extractWebhookFields, toOrderRow } from "../modules/shiprocket/parser";
import { computeRequestHash } from "../lib/integrations/hashing";
import { calculateRetryDelay, isDeadLetter } from "../lib/integrations/retry";
import type { ShiprocketWebhookPayload } from "../modules/shiprocket/types";

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
      expect(fields.is_return).toBe(false);
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
