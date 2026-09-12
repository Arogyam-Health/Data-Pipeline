import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Import = { id: string; status: string; is_active: boolean };
type Membership = { import_id: string; crf_id: string; awb: string; order_id: string };
type Canonical = { crf_id: string; awb: string; order_id: string };

function effectiveRows(canonical: Canonical[], imports: Import[], memberships: Membership[]) {
  return canonical.filter((row) => memberships.some((membership) =>
    membership.crf_id === row.crf_id && membership.awb === row.awb && membership.order_id === row.order_id
    && imports.some((item) => item.id === membership.import_id && item.status === "completed" && item.is_active)
  ));
}

describe("effective remittance membership contract", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/049_effective_remittance_membership.sql"), "utf8");

  it("requires completed active membership and preserves the canonical table", () => {
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("is_active = true");
    expect(sql).toContain("from data_pipeline.shiprocket_remittance_orders ro");
    expect(sql).toContain("where exists");
    expect(sql).not.toMatch(/delete\s+from\s+data_pipeline\.shiprocket_remittance_orders/i);
  });

  it.each([
    ["no imports", [], [], 0],
    ["active import", [{ id: "A", status: "completed", is_active: true }], [{ import_id: "A", crf_id: "C", awb: "W", order_id: "O" }], 1],
    ["one active duplicate supports evidence", [{ id: "A", status: "completed", is_active: false }, { id: "B", status: "completed", is_active: true }], [{ import_id: "A", crf_id: "C", awb: "W", order_id: "O" }, { import_id: "B", crf_id: "C", awb: "W", order_id: "O" }], 1],
    ["all duplicate imports inactive", [{ id: "A", status: "completed", is_active: false }, { id: "B", status: "completed", is_active: false }], [{ import_id: "A", crf_id: "C", awb: "W", order_id: "O" }, { import_id: "B", crf_id: "C", awb: "W", order_id: "O" }], 0],
  ])("%s", (_label, imports, memberships, expected) => {
    expect(effectiveRows([{ crf_id: "C", awb: "W", order_id: "O" }], imports, memberships)).toHaveLength(expected);
  });
});
