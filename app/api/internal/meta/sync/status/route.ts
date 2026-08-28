import { NextRequest, NextResponse } from "next/server";
import { authorizeInternalSync, getSyncStatus } from "@/modules/meta";
import { metaErrorResponse } from "@/modules/meta/http";

export async function GET(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getSyncStatus();
    return NextResponse.json({
      success: true,
      state: status.state,
      latestRun: status.latest,
      backfill: status.backfill,
      account: status.account
        ? {
            adAccountId: status.account.ad_account_id,
            accountName: status.account.account_name,
            currency: status.account.currency,
            timezoneName: status.account.timezone_name,
            accountStatus: status.account.account_status,
          }
        : null,
    });
  } catch (err) {
    return metaErrorResponse(err);
  }
}
