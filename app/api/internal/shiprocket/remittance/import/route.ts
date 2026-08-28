import { NextRequest, NextResponse } from "next/server";
import { authorizeShiprocketInternal, importRemittanceWorkbook } from "@/modules/shiprocket";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!authorizeShiprocketInternal(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing remittance file" }, { status: 400 });
    }
    const name = file.name || "remittance.xls";
    if (!/\.xlsx?$/i.test(name)) {
      return NextResponse.json({ error: "Upload a .xls or .xlsx remittance report" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importRemittanceWorkbook({ fileName: name, buffer });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 400 }
    );
  }
}
