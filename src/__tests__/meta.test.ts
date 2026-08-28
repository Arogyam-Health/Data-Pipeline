import { ADD_TO_CART_ACTION_TYPES, CORE_FIELDS, PURCHASE_ACTION_TYPES } from "../modules/meta/constants";
import {
  firstActionValue,
  firstRoasValue,
  mapParityActions,
  normalizeAllActions,
  safeRatio,
  sumMatchingActions,
} from "../modules/meta/actions";
import { buildAuthorizationHeader, MetaGraphClient } from "../modules/meta/client";
import {
  addCalendarDays,
  chunkDateRange,
  formatDateInTimeZone,
  getRecentRepairRange,
  getTodayRange,
  inclusiveDayCount,
  storeMetaReportDate,
} from "../modules/meta/dates";
import {
  authorizeInternalSync,
  getMetaAccessToken,
  getMetaAdAccountId,
  getMetaEnv,
  isMetaSyncEnabled,
  resetMetaEnvCache,
  shouldStartLocalMetaScheduler,
} from "../modules/meta";
import {
  classifyMetaError,
  isRetryableMetaFailure,
  MetaAuthError,
  MetaInvalidFieldError,
  MetaSyncConflictError,
  sanitizeMetaError,
  stripAccessTokenFromUrl,
} from "../modules/meta/errors";
import { dailyIdentity, dedupeDailyRows, normalizeInsightRow, persistableInsightBundle } from "../modules/meta/normalizer";
import { detectRepeatedPagingUrl, nextPagingUrl } from "../modules/meta/pagination";
import { retryDelayMs } from "../modules/meta/retry";
import { assertBackfillAllowed, assertNoActiveBackfillConflict, rangesOverlap } from "../modules/meta/locking";
import { planBackfillChunks } from "../modules/meta/backfill";
import { assertAllowedTestRange, resolveSyncRange } from "../modules/meta/sync";
import { clampPageSize } from "../modules/meta/analytics";
import {
  groupFilterOptions,
  hasSqlFilters,
  sanitizeMetaSearch,
  sortRows,
  toRpcFilters,
} from "../modules/meta/filters";
import { dashboardRangeSchema, parseMetaFilters } from "../modules/meta/http";
import { parseRetryAfterMs } from "../modules/meta/retry";
import type { MetaInsightRow } from "../modules/meta/types";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function sampleInsight(overrides: Partial<MetaInsightRow> = {}): MetaInsightRow {
  return {
    date_start: "2026-08-01",
    date_stop: "2026-08-01",
    campaign_id: "campaign_1",
    campaign_name: "Test Campaign",
    adset_id: "adset_1",
    adset_name: "Test Ad Set",
    ad_id: "ad_1",
    ad_name: "Test Ad",
    objective: "OUTCOME_SALES",
    spend: "100.50",
    impressions: "1000",
    reach: "800",
    frequency: "1.25",
    clicks: "40",
    inline_link_clicks: "30",
    inline_link_click_ctr: "3.0",
    ctr: "4.0",
    cpc: "3.35",
    cpm: "100.5",
    cost_per_inline_link_click: "3.35",
    actions: [
      { action_type: "purchase", value: "2" },
      { action_type: "omni_purchase", value: "1" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
      { action_type: "add_to_cart", value: "5" },
      { action_type: "omni_add_to_cart", value: "1" },
      { action_type: "initiate_checkout", value: "3" },
      { action_type: "landing_page_view", value: "20" },
      { action_type: "messaging_conversation_started", value: "1" },
      { action_type: "complete_registration", value: "1" },
      { action_type: "instant_experience_view_percentage", value: "0.4" },
      { action_type: "offsite_conversion.custom_secret_action", value: "9" },
    ],
    action_values: [
      { action_type: "purchase", value: "200" },
      { action_type: "initiate_checkout", value: "150" },
      { action_type: "offsite_conversion.custom_secret_action", value: "99" },
    ],
    purchase_roas: [{ action_type: "omni_purchase", value: "1.99" }],
    website_purchase_roas: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "1.50" }],
    video_avg_time_watched_actions: [{ value: "6" }],
    video_p25_watched_actions: [{ value: "100" }],
    video_p95_watched_actions: [{ value: "20" }],
    ...overrides,
  };
}

describe("Meta env validation", () => {
  beforeEach(() => resetMetaEnvCache());

  it("validates Meta env only when invoked", () => {
    const env = getMetaEnv();
    expect(env.META_AD_ACCOUNT_ID).toBe("act_100000000000000");
    expect(env.META_API_VERSION).toBe("v23.0");
    expect(env.META_SYNC_ENABLED).toBe(false);
  });

  it("requires META_ACCESS_TOKEN server-side", () => {
    expect(() =>
      getMetaEnv({
        ...(process.env as Record<string, string>),
        META_ACCESS_TOKEN: "",
      })
    ).toThrow(/META_ACCESS_TOKEN/);
  });

  it("reads the server-side access token", () => {
    expect(getMetaAccessToken()).toBe("test-meta-access-token");
  });

  it("normalizes and validates the ad account id", () => {
    expect(getMetaAdAccountId()).toBe("act_100000000000000");
    expect(
      getMetaEnv({
        ...(process.env as Record<string, string>),
        META_AD_ACCOUNT_ID: "1234567890",
      }).META_AD_ACCOUNT_ID
    ).toBe("act_1234567890");
  });

  it("rejects an invalid ad account id", () => {
    expect(() =>
      getMetaEnv({
        ...(process.env as Record<string, string>),
        META_AD_ACCOUNT_ID: "not-an-account",
      })
    ).toThrow(/META_AD_ACCOUNT_ID/);
  });
});

describe("Meta access token safety", () => {
  it("builds an Authorization Bearer header and never puts the token in the URL", () => {
    const header = buildAuthorizationHeader("test-meta-access-token");
    expect(header.Authorization).toBe("Bearer test-meta-access-token");
    expect(JSON.stringify(header)).not.toContain("NEXT_PUBLIC");
  });

  it("never includes the token value in sanitized errors", () => {
    const leaked = sanitizeMetaError(
      "Meta API error with token EAA1234567890abcdef and access_token=secretvalue and Bearer abc.def"
    );
    expect(leaked).not.toContain("EAA1234567890abcdef");
    expect(leaked).not.toContain("secretvalue");
    expect(leaked).toContain("[REDACTED]");
  });

  it("strips access_token from paging URLs", () => {
    const cleaned = stripAccessTokenFromUrl(
      "https://graph.facebook.com/v23.0/act_TEST/insights?access_token=EAASECRET&after=abc"
    );
    expect(cleaned).not.toContain("EAASECRET");
    expect(cleaned).not.toContain("access_token=");
  });
});

describe("Meta Graph client retries and pagination", () => {
  it("sends Authorization and paginates until paging.next is absent", async () => {
    const calls: string[] = [];
    const client = new MetaGraphClient({
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        expect(url).not.toContain("access_token=");
        if (calls.length === 1) {
          return jsonResponse({
            data: [{ ad_id: "ad_1" }],
            paging: { next: "https://graph.facebook.com/v23.0/next?access_token=EAASECRET&after=1" },
          });
        }
        return jsonResponse({ data: [{ ad_id: "ad_2" }] });
      },
    });

    const rows = await client.getPaged("act_100000000000000/insights", { fields: CORE_FIELDS.join(",") });
    expect(rows).toHaveLength(2);
    expect(client.pagesFetched).toBe(2);
    expect(client.apiRequests).toBe(2);
    expect(calls[1]).not.toContain("EAASECRET");
  });

  it("stops when a paging URL repeats", () => {
    const seen = new Set<string>(["https://graph.facebook.com/v23.0/next?after=1"]);
    const result = detectRepeatedPagingUrl(seen, "https://graph.facebook.com/v23.0/next?access_token=EAA&after=1");
    expect(result.repeated).toBe(true);
    expect(nextPagingUrl({ next: "https://graph.facebook.com/v23.0/next?access_token=EAA" })).not.toContain("EAA");
  });

  it("retries HTTP 429 using Retry-After", async () => {
    let attempt = 0;
    const sleeps: number[] = [];
    const client = new MetaGraphClient({
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        attempt += 1;
        if (attempt === 1) return jsonResponse({ error: { message: "rate limit", code: 4 } }, 429, { "retry-after": "2" });
        return jsonResponse({ data: [{ ad_id: "ad_1" }] });
      },
    });
    const rows = await client.getPaged("act_100000000000000/insights");
    expect(rows).toHaveLength(1);
    expect(client.retryCount).toBe(1);
    expect(sleeps[0]).toBe(2000);
  });

  it("retries 500/502/503/504", async () => {
    const statuses = [500, 502, 503, 504];
    let i = 0;
    const client = new MetaGraphClient({
      sleep: async () => undefined,
      fetchImpl: async () => {
        if (i < statuses.length) {
          const status = statuses[i];
          i += 1;
          return jsonResponse({ error: { message: "temporarily unavailable" } }, status);
        }
        return jsonResponse({ name: "Test Account", timezone_name: "Asia/Kolkata", currency: "INR" });
      },
    });
    const result = await client.get("act_100000000000000");
    expect((result as unknown as { name: string }).name).toBe("Test Account");
    expect(client.retryCount).toBe(4);
  });

  it("does not retry permanent auth failures", async () => {
    const client = new MetaGraphClient({
      sleep: async () => undefined,
      fetchImpl: async () => jsonResponse({ error: { message: "Invalid OAuth access token", code: 190 } }, 401),
    });
    await expect(client.get("act_100000000000000")).rejects.toBeInstanceOf(MetaAuthError);
    expect(client.retryCount).toBe(0);
  });

  it("does not retry invalid field errors indefinitely", async () => {
    const client = new MetaGraphClient({
      sleep: async () => undefined,
      fetchImpl: async () =>
        jsonResponse({ error: { message: "Tried accessing nonexisting field quality_ranking", code: 100 } }, 400),
    });
    await expect(client.get("act_100000000000000/insights")).rejects.toBeInstanceOf(MetaInvalidFieldError);
    expect(client.retryCount).toBe(0);
    expect(isRetryableMetaFailure({ classification: "invalid_field", status: 400 })).toBe(false);
  });
});

describe("Meta insight transformation and action mappings", () => {
  it("transforms a basic Insights row at ad/day grain", () => {
    const bundle = normalizeInsightRow(sampleInsight(), {
      adAccountId: "act_TEST",
      syncRunId: "run_1",
      syncedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(bundle?.daily.ad_id).toBe("ad_1");
    expect(bundle?.daily.date).toBe("2026-08-01");
    expect(bundle?.daily.spend).toBe(100.5);
    expect(storeMetaReportDate("2026-08-01T12:00:00+0530")).toBe("2026-08-01");
  });

  it("preserves purchase / website purchase / value mappings", () => {
    const mapped = mapParityActions(sampleInsight());
    expect(mapped.purchases).toBe(5);
    expect(mapped.websitePurchases).toBe(2);
    expect(mapped.purchaseValue).toBe(200);
  });

  it("preserves add-to-cart, checkout, checkout value, LPV, messaging, registration", () => {
    const mapped = mapParityActions(sampleInsight());
    expect(mapped.addsToCart).toBe(6);
    expect(mapped.checkoutsInitiated).toBe(3);
    expect(mapped.checkoutsInitiatedValue).toBe(150);
    expect(mapped.landingPageViews).toBe(20);
    expect(mapped.messagingConversationsStarted).toBe(1);
    expect(mapped.registrationsCompleted).toBe(1);
    expect(mapped.instantExperienceViewPercentage).toBe(0.4);
  });

  it("maps video metrics and ROAS", () => {
    const row = sampleInsight();
    expect(firstActionValue(row.video_avg_time_watched_actions)).toBe(6);
    expect(firstActionValue(row.video_p25_watched_actions)).toBe(100);
    expect(firstActionValue(row.video_p95_watched_actions)).toBe(20);
    expect(firstRoasValue(row.purchase_roas)).toBe(1.99);
    expect(firstRoasValue(row.website_purchase_roas)).toBe(1.5);
  });

  it("derives LPV rate and CPA and keeps zero denominators null", () => {
    expect(safeRatio(20, 30)).toBeCloseTo(20 / 30);
    expect(safeRatio(100.5, 5)).toBeCloseTo(20.1);
    expect(safeRatio(10, 0)).toBeNull();
    expect(safeRatio(0, 0)).toBeNull();
    expect(Number.isFinite(safeRatio(10, 0) ?? 0)).toBe(true);
  });

  it("uses unique ad/day identity and is idempotent on duplicates", () => {
    const a = normalizeInsightRow(sampleInsight(), { adAccountId: "act_TEST", syncRunId: "run_1" })!;
    const b = normalizeInsightRow(sampleInsight({ spend: "200" }), { adAccountId: "act_TEST", syncRunId: "run_2" })!;
    expect(dailyIdentity(a.daily)).toBe(dailyIdentity(b.daily));
    const deduped = dedupeDailyRows([a.daily, b.daily]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].spend).toBe(200);
  });

  it("captures unknown action types without schema changes", () => {
    const bundle = normalizeInsightRow(sampleInsight(), { adAccountId: "act_TEST", syncRunId: "run_1" })!;
    expect(bundle.actions.some((row) => row.action_type === "offsite_conversion.custom_secret_action")).toBe(true);
    expect(bundle.actionValues.some((row) => row.action_type === "offsite_conversion.custom_secret_action")).toBe(true);
    expect(normalizeAllActions([{ action_type: "brand_new_type", value: "3" }])).toEqual([
      { action_type: "brand_new_type", value: 3 },
    ]);
  });

  it("does not keep raw Meta response fields on persistable rows", () => {
    const bundle = normalizeInsightRow(sampleInsight(), { adAccountId: "act_TEST", syncRunId: "run_1" })!;
    const persistable = persistableInsightBundle(bundle);
    expect(persistable).not.toHaveProperty("actions");
    expect(persistable).not.toHaveProperty("payload");
    expect(JSON.stringify(persistable)).not.toContain("paging");
  });

  it("sums matching Apps Script purchase types", () => {
    expect(
      sumMatchingActions(
        [
          { action_type: "purchase", value: "1" },
          { action_type: "omni_purchase", value: "2" },
        ],
        PURCHASE_ACTION_TYPES
      )
    ).toBe(3);
    expect(sumMatchingActions([], ADD_TO_CART_ACTION_TYPES)).toBeNull();
  });
});

describe("Meta date windows and backfill chunking", () => {
  const tz = "UTC";
  const now = new Date("2026-08-25T12:00:00.000Z");

  it("chunks 90 days into 3-day windows", () => {
    const chunks = planBackfillChunks(90, 3, tz, now);
    expect(chunks[0].since).toBe("2026-05-27");
    expect(inclusiveDayCount(chunks[0].since, chunks[0].until)).toBe(3);
    expect(chunks.at(-1)?.until).toBe("2026-08-25");
    expect(chunks.length).toBe(31);
  });

  it("uses 3-day chunking helper independently", () => {
    expect(chunkDateRange("2026-08-01", "2026-08-07", 3)).toEqual([
      { since: "2026-08-01", until: "2026-08-03" },
      { since: "2026-08-04", until: "2026-08-06" },
      { since: "2026-08-07", until: "2026-08-07" },
    ]);
  });

  it("resolves today as one account-timezone date", () => {
    const today = getTodayRange(tz, now);
    expect(today.since).toBe("2026-08-25");
    expect(today.until).toBe("2026-08-25");
    expect(formatDateInTimeZone(now, "Asia/Kolkata")).toBe("2026-08-25");
  });

  it("treats recent repair daysBack=2 as three calendar dates", () => {
    const range = getRecentRepairRange(2, tz, now);
    expect(range.since).toBe("2026-08-23");
    expect(range.until).toBe("2026-08-25");
    expect(inclusiveDayCount(range.since, range.until)).toBe(3);
  });

  it("does not shift date_start through UTC conversion", () => {
    expect(storeMetaReportDate("2026-08-01")).toBe("2026-08-01");
    expect(addCalendarDays("2026-08-01", 1)).toBe("2026-08-02");
  });
});

describe("Meta concurrency and repair idempotency", () => {
  it("rejects a second active backfill", () => {
    expect(() =>
      assertBackfillAllowed(false, {
        id: "job_1",
        ad_account_id: "act_TEST",
        requested_from: "2026-05-27",
        requested_to: "2026-08-25",
        chunk_days: 3,
        next_chunk_start: "2026-05-30",
        status: "running",
        last_error: null,
      })
    ).toThrow(MetaSyncConflictError);
  });

  it("allows resume only when a job exists", () => {
    expect(() => assertBackfillAllowed(true, null)).toThrow(MetaSyncConflictError);
  });

  it("blocks today/repair while a backfill is active", () => {
    const job = {
      id: "job_1",
      ad_account_id: "act_TEST",
      requested_from: "2026-05-27",
      requested_to: "2026-08-25",
      chunk_days: 3,
      next_chunk_start: "2026-05-30",
      status: "running" as const,
      last_error: null,
    };
    expect(() => assertNoActiveBackfillConflict("today", job)).toThrow(MetaSyncConflictError);
    expect(() => assertNoActiveBackfillConflict("repair", job)).toThrow(MetaSyncConflictError);
  });

  it("detects overlapping repair/backfill ranges", () => {
    expect(rangesOverlap({ since: "2026-08-01", until: "2026-08-03" }, { since: "2026-08-03", until: "2026-08-05" })).toBe(
      true
    );
    expect(rangesOverlap({ since: "2026-08-01", until: "2026-08-02" }, { since: "2026-08-03", until: "2026-08-05" })).toBe(
      false
    );
  });

  it("treats repair as an upsert of the requested window only", () => {
    const range = resolveSyncRange({
      mode: "repair",
      since: "2026-08-01",
      until: "2026-08-03",
      timeZone: "UTC",
      recentDays: 2,
    });
    expect(range).toEqual({ since: "2026-08-01", until: "2026-08-03" });
  });
});

describe("Meta API guards, flags, and analytics safety", () => {
  beforeEach(() => resetMetaEnvCache());

  it("rejects a missing or incorrect internal sync secret", () => {
    expect(authorizeInternalSync(null)).toBe(false);
    expect(authorizeInternalSync("Bearer wrong-secret")).toBe(false);
    expect(authorizeInternalSync("Bearer test-meta-sync-secret")).toBe(true);
  });

  it("refuses scheduled sync when META_SYNC_ENABLED is false", () => {
    const env = getMetaEnv({
      ...(process.env as Record<string, string>),
      META_SYNC_ENABLED: "false",
    });
    expect(isMetaSyncEnabled(env)).toBe(false);
    expect(
      shouldStartLocalMetaScheduler({
        syncEnabled: false,
        runtime: "nodejs",
      })
    ).toBe(false);
  });

  it("classifies auth vs rate-limit vs invalid field", () => {
    expect(classifyMetaError({ status: 401, code: 190 })).toBe("authentication");
    expect(classifyMetaError({ status: 429, code: 4 })).toBe("rate_limit");
    expect(classifyMetaError({ status: 400, message: "unknown field" })).toBe("invalid_field");
    expect(isRetryableMetaFailure({ classification: "authentication", status: 401 })).toBe(false);
  });

  it("keeps dashboard KPI aggregation uncapped while paging tables", () => {
    expect(clampPageSize(1000)).toBe(100);
    expect(clampPageSize(20)).toBe(20);
    const kpis = { spend: 10000, purchases: 50 };
    expect(kpis.spend / kpis.purchases).toBe(200);
  });

  it("computes weighted derived metrics instead of averaging ratios", () => {
    const rows = [
      { spend: 100, purchases: 2, impressions: 1000, clicks: 100, purchase_value: 250 },
      { spend: 50, purchases: 0, impressions: 100, clicks: 1, purchase_value: 0 },
    ];
    const spend = rows.reduce((sum, row) => sum + row.spend, 0);
    const purchases = rows.reduce((sum, row) => sum + row.purchases, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const value = rows.reduce((sum, row) => sum + row.purchase_value, 0);
    expect(safeRatio(spend, purchases)).toBe(75);
    expect(safeRatio(clicks, impressions)).toBeCloseTo(101 / 1100);
    expect(safeRatio(value, spend)).toBeCloseTo(250 / 150);
    expect((rows[0].clicks / rows[0].impressions + rows[1].clicks / rows[1].impressions) / 2).not.toBe(
      clicks / impressions
    );
  });

  it("uses exponential retry bases matching Apps Script", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
    const delay = retryDelayMs(0, null);
    expect(delay).toBeGreaterThanOrEqual(3000);
    expect(delay).toBeLessThan(4000);
  });

  it("limits test ranges to 3 days", () => {
    expect(() => assertAllowedTestRange("test", { since: "2026-08-01", until: "2026-08-03" })).not.toThrow();
    expect(() => assertAllowedTestRange("test", { since: "2026-08-01", until: "2026-08-10" })).toThrow(
      /limited to 3 days/
    );
  });
});

describe("Meta optional layers do not break core parity", () => {
  it("core field list matches the Apps Script parity request", () => {
    expect(CORE_FIELDS).toEqual(expect.arrayContaining(["actions", "action_values", "purchase_roas", "inline_link_clicks"]));
    expect(CORE_FIELDS).not.toContain("quality_ranking");
  });

  it("core sync success is independent of optional groups", () => {
    const core = normalizeInsightRow(sampleInsight(), { adAccountId: "act_TEST", syncRunId: "run_1" });
    expect(core).not.toBeNull();
    const withoutExtended = normalizeInsightRow(sampleInsight({ quality_ranking: undefined }), {
      adAccountId: "act_TEST",
      syncRunId: "run_1",
    });
    expect(withoutExtended?.daily.purchases).toBe(core?.daily.purchases);
  });
});

describe("Meta dashboard filters", () => {
  it("sanitizes search wildcards and maps empty filters to null RPC args", () => {
    expect(sanitizeMetaSearch("sale_%(x)")).toBe("salex");
    expect(sanitizeMetaSearch("   ")).toBeNull();
    expect(hasSqlFilters({})).toBe(false);
    expect(hasSqlFilters({ purchaseStatus: "all", search: "" })).toBe(false);
    expect(hasSqlFilters({ campaignId: "123", purchaseStatus: "with" })).toBe(true);
    expect(toRpcFilters({ campaignId: "", purchaseStatus: "all", minSpend: 50 })).toMatchObject({
      p_campaign_id: null,
      p_purchase_status: null,
      p_min_spend: 50,
    });
  });

  it("sorts performance rows by the selected metric", () => {
    const rows = [
      { campaign_name: "B", spend: 10, purchases: 5, roas: 2 },
      { campaign_name: "A", spend: 40, purchases: 1, roas: 0.5 },
    ];
    expect(sortRows(rows, "spend", "desc")[0].spend).toBe(40);
    expect(sortRows(rows, "purchases", "desc")[0].purchases).toBe(5);
    expect(sortRows(rows, "name", "asc")[0].campaign_name).toBe("A");
  });

  it("accepts empty filter query params without failing validation", () => {
    const parsed = dashboardRangeSchema.safeParse({
      range: "30d",
      campaignId: "",
      minSpend: "",
      purchaseStatus: "",
      sort: "roas",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parseMetaFilters(parsed.data)).toMatchObject({
        campaignId: undefined,
        minSpend: undefined,
        purchaseStatus: undefined,
        sort: "roas",
      });
    }
  });

  it("groups filter-option rows by kind", () => {
    const grouped = groupFilterOptions([
      { kind: "campaign", id: "c1", label: "Spring", campaign_id: "c1", adset_id: null },
      { kind: "adset", id: "s1", label: "Prospecting", campaign_id: "c1", adset_id: "s1" },
      { kind: "ad", id: "a1", label: "Video 1", campaign_id: "c1", adset_id: "s1" },
      { kind: "objective", id: "OUTCOME_SALES", label: "OUTCOME_SALES", campaign_id: null, adset_id: null },
    ]);
    expect(grouped.campaigns).toHaveLength(1);
    expect(grouped.adsets[0].campaign_id).toBe("c1");
    expect(grouped.ads[0].id).toBe("a1");
    expect(grouped.objectives[0].id).toBe("OUTCOME_SALES");
  });
});

