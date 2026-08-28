import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternalSync, ga4ErrorResponse, runCompatibilityCheck } from "@/modules/ga4";

const bodySchema = z.object({
  dataset: z.enum(["daily", "channel", "utm"]),
});

export async function POST(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "dataset is required" }, { status: 400 });
    }
    const result = await runCompatibilityCheck({ dataset: parsed.data.dataset });
    return NextResponse.json({
      success: true,
      dataset: parsed.data.dataset,
      dimensions: (result.dimensionCompatibilities ?? []).map((row) => ({
        name: row.dimensionMetadata?.apiName ?? null,
        compatibility: row.compatibility ?? null,
      })),
      metrics: (result.metricCompatibilities ?? []).map((row) => ({
        name: row.metricMetadata?.apiName ?? null,
        compatibility: row.compatibility ?? null,
      })),
    });
  } catch (err) {
    return ga4ErrorResponse(err);
  }
}
