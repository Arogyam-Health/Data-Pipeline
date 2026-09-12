import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveCanonicalDeliveryState } from "../modules/shiprocket/status";

describe("canonical delivery outcome regressions", () => {
  it("does not treat UNDELIVERED as DELIVERED", () => {
    expect(resolveCanonicalDeliveryState({
      shipmentStatus: "UNDELIVERED",
      currentStatus: "UNDELIVERED",
      shipmentStatusId: "21",
      currentStatusId: "36",
      awb: "77942286785",
    })).toMatchObject({ outcome: "NDR_OPEN", isDelivered: false, isNdr: true });
  });

  it("keeps an exact DELIVERED status delivered", () => {
    expect(resolveCanonicalDeliveryState({
      shipmentStatus: "Delivered",
      currentStatus: "Delivered",
      shipmentStatusId: "7",
      currentStatusId: "7",
    })).toMatchObject({ outcome: "DELIVERED", isDelivered: true });
  });

  it("gives order_status=new cancellation precedence", () => {
    expect(resolveCanonicalDeliveryState({
      shipmentStatus: "Delivered",
      currentStatus: "Delivered",
      orderStatus: "new",
    })).toMatchObject({ outcome: "CANCELLED", isDelivered: false, isRto: false });
  });

  it("preserves a legitimate scan-resolved delivery conflict", () => {
    expect(resolveCanonicalDeliveryState({
      shipmentStatus: "UNDELIVERED",
      currentStatus: "UNDELIVERED",
      deliveredDate: null,
      scans: [{
        scan_date: "2026-09-02 15:07:00",
        status: "000-T-DL",
        sr_status: "7",
        sr_status_label: "DELIVERED",
        activity: "SHIPMENT DELIVERED",
      }],
    })).toMatchObject({ outcome: "DELIVERED", isDelivered: true, source: "SCAN_TIMELINE" });
  });

  it("keeps RTO and genuine transit outcomes unchanged", () => {
    expect(resolveCanonicalDeliveryState({
      shipmentStatus: "RTO DELIVERED",
      currentStatus: "RTO DELIVERED",
    }).outcome).toBe("RTO");
    expect(resolveCanonicalDeliveryState({
      shipmentStatus: "IN TRANSIT",
      currentStatus: "IN TRANSIT",
      awb: "77100000000",
    }).outcome).toBe("IN_TRANSIT");
  });

  it("uses exact raw-status checks in the corrective migration", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/051_fix_delivered_substring_classification.sql"), "utf8");
    expect(migration).toContain("upper(trim(coalesce(o.shipment_status, ''))) = 'DELIVERED'");
    expect(migration).toContain("upper(trim(coalesce(o.current_status, ''))) = 'DELIVERED'");
    expect(migration).not.toContain("coalesce(o.shipment_status, '') ilike '%delivered%'");
    expect(migration).not.toContain("coalesce(o.current_status, '') ilike '%delivered%'");
    expect(migration).toContain("when delivery_outcome = 'DELIVERED' then");
    expect(migration).toContain("when delivery_outcome = 'CANCELLED' then 'CANCELLED'");
  });
});
