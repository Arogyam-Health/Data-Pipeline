import { NextRequest, NextResponse } from "next/server";
import { authorizeInternalSync, getSyncStatus } from "@/modules/shopify";
import { shopifyErrorResponse } from "@/modules/shopify/http";

export async function GET(request: NextRequest) {
  if (!authorizeInternalSync(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getSyncStatus();
    return NextResponse.json({
      success: true,
      state: status.state
        ? {
            shopDomain: status.state.shop_domain,
            lastSuccessfulSyncAt: status.state.last_successful_sync_at,
            lastAttemptedSyncAt: status.state.last_attempted_sync_at,
            lastBackfillCompletedAt: status.state.last_backfill_completed_at,
            grantedScopes: status.state.granted_scopes,
            apiVersion: status.state.api_version,
            accessibleHistoryDays: status.state.accessible_history_days,
            historyWarning: status.state.history_warning,
          }
        : null,
      latestRun: status.latest
        ? {
            id: status.latest.id,
            mode: status.latest.mode,
            status: status.latest.status,
            startedAt: status.latest.started_at,
            finishedAt: status.latest.finished_at,
            ordersFetched: status.latest.orders_fetched,
            retryCount: status.latest.retry_count,
            lastErrorCode: status.latest.last_error_code,
          }
        : null,
      backfill: status.backfill
        ? {
            id: status.backfill.id,
            status: status.backfill.status,
            nextChunkStart: status.backfill.next_chunk_start,
            endAt: status.backfill.end_at,
          }
        : null,
    });
  } catch (err) {
    return shopifyErrorResponse(err);
  }
}
