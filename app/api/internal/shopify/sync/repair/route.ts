import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeInternalSync, runShopifySync } from "@/modules/shopify";
import { shopifyErrorResponse } from "@/modules/shopify/http";
import { ShopifyError } from "@/modules/shopify/errors";

const bodySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export async function POST(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ShopifyError("Repair requires ISO from/to timestamps", "VALIDATION_ERROR", false);
    }
    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    if (from >= to) {
      throw new ShopifyError("from must be before to", "VALIDATION_ERROR", false);
    }

    const result = await runShopifySync({
      mode: "repair",
      from,
      to,
      requireEnabled: false,
    });

    return NextResponse.json({
      success: result.success,
      runId: result.runId,
      mode: result.mode,
      status: result.status,
      from: result.actualFrom,
      to: result.actualTo,
      ordersFetched: result.ordersFetched,
      itemsUpserted: result.itemsUpserted,
      pagesFetched: result.pagesFetched,
      historyWarning: result.historyWarning,
    });
  } catch (err) {
    return shopifyErrorResponse(err);
  }
}
