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

  it.each([
    "27 08 2026 16:10:00",
    "2026-08-27 16:10:00",
  ])("treats a non-empty delivered date as delivery evidence: %s", (deliveredDate) => {
    expect(resolveCanonicalDeliveryState({
      shipmentStatus: "UNDELIVERED",
      currentStatus: "UNDELIVERED",
      deliveredDate,
    })).toMatchObject({ outcome: "DELIVERED", isDelivered: true, source: "DELIVERED_DATE" });
  });

  it("falls back to NDR when delivered_date is empty", () => {
    expect(resolveCanonicalDeliveryState({
      shipmentStatus: "UNDELIVERED",
      currentStatus: "UNDELIVERED",
      deliveredDate: "",
    })).toMatchObject({ outcome: "NDR_OPEN", isDelivered: false, isNdr: true });
  });

  it("keeps RTO precedence over a populated delivered date", () => {
    expect(resolveCanonicalDeliveryState({
      shipmentStatus: "RTO",
      currentStatus: "RTO",
      deliveredDate: "27 08 2026 16:10:00",
    })).toMatchObject({ outcome: "RTO", isDelivered: false, isRto: true });
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

  it("normalizes the production delivered-date format in the parity migration", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/052_canonical_delivery_date_parity.sql"), "utf8");
    expect(migration).toContain("when nullif(btrim(p.shiprocket_delivered_date_raw), '') is not null then 'DELIVERED'");
    expect(migration).toContain("to_timestamp(p.shiprocket_delivered_date_raw, 'DD MM YYYY HH24:MI:SS')");
    expect(migration).toContain("substring(p.shiprocket_delivered_date_raw, 4, 2) between '01' and '12'");
    expect(migration).toContain("substring(p.shiprocket_delivered_date_raw, 12, 2) between '00' and '23'");
    expect(migration).toContain("p.shiprocket_delivered_date_raw ~ '^\\d{4}-\\d{2}-\\d{2}([ T]\\d{2}:\\d{2}:\\d{2}(Z|[+-]\\d{2}:\\d{2})?)?$'");
    expect(migration).toContain("when delivery_outcome = 'RTO' then 'RTO'");
  });
});
