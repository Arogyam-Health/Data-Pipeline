import { AUTH_MODE, BASE_METRICS, ECOMMERCE_METRICS, FORBIDDEN_PRIVATE_KEY_ENV } from "../modules/ga4/constants";
import {
  buildExternalAccountConfig,
  buildWifAudience,
  forbiddenPrivateKeyEnvNames,
  ga4ReadsPrivateKeyEnvVars,
  getAuthMode,
  getDefaultSubjectToken,
} from "../modules/ga4/auth";
import { Ga4DataClient } from "../modules/ga4/client";
import {
  addCalendarDays,
  chunkDateRange,
  formatDateInTimeZone,
  ga4DateToIso,
  getRecentRange,
  inclusiveDayCount,
} from "../modules/ga4/dates";
import {
  getGa4Env,
  getGa4PropertyId,
  ga4EnvUsesPrivateKey,
  isGa4SyncEnabled,
  normalizePropertyId,
  resetGa4EnvCache,
} from "../modules/ga4/env";
import {
  classifyGa4Error,
  isRetryableGa4Failure,
  Ga4AuthError,
  sanitizeGa4Error,
} from "../modules/ga4/errors";
import { derivedBounceRate, derivedEngagementRate, parseDecimalMetric, parseIntegerMetric, parseRateMetric } from "../modules/ga4/metrics";
import { mergeReports } from "../modules/ga4/merge";
import { buildUtmKey, isAllNotSet, normalizeNotSet } from "../modules/ga4/normalizer";
import { normalizeDailyRows } from "../modules/ga4/daily";
import { normalizeChannelRows } from "../modules/ga4/channel";
import { normalizeUtmRows, shouldKeepUtmRow } from "../modules/ga4/utm";
import { nextOffset, shouldStopPaging } from "../modules/ga4/pagination";
import { retryDelayMs, parseRetryAfterMs } from "../modules/ga4/retry";
import { assertBackfillAllowed, assertNoActiveBackfillConflict, lockIdentity } from "../modules/ga4/locking";
import { planBackfillChunks, planUtmBackfillChunks } from "../modules/ga4/backfill";
import { assertAllowedRange, resolveSyncRange } from "../modules/ga4/sync";
import { clampPageSize } from "../modules/ga4/analytics";
import { authorizeInternalSync, shouldStartLocalGa4Scheduler } from "../modules/ga4";
import { Ga4SyncConflictError } from "../modules/ga4/errors";
import type { Ga4Env } from "../modules/ga4/env";
import type { Ga4ReportResponse } from "../modules/ga4/types";

const TEST_ENV: Record<string, string> = {
  GA4_PROPERTY_ID: "properties/TEST",
  GCP_PROJECT_ID: "test-project",
  GCP_PROJECT_NUMBER: "123456789",
  GCP_SERVICE_ACCOUNT_EMAIL: "ga4-pipeline@test-project.iam.gserviceaccount.com",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel-pool",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel-oidc",
  GA4_SYNC_ENABLED: "false",
  GA4_INTERNAL_SYNC_SECRET: "test-ga4-sync-secret",
  GA4_DAILY_BACKFILL_DAYS: "90",
  GA4_DAILY_BACKFILL_CHUNK_DAYS: "3",
  GA4_CHANNEL_BACKFILL_DAYS: "90",
  GA4_CHANNEL_BACKFILL_CHUNK_DAYS: "3",
  GA4_UTM_BACKFILL_START_DATE: "2025-10-14",
  GA4_UTM_BACKFILL_CHUNK_DAYS: "30",
  GA4_RECENT_DAYS_BACK: "2",
  GA4_API_PAGE_LIMIT: "2",
  GA4_MAX_RETRIES: "5",
  GA4_BASE_RETRY_MS: "3000",
  GA4_REPORTING_TIMEZONE: "Asia/Kolkata",
  GA4_CURRENCY: "INR",
};

function sampleEnv(overrides: Record<string, string> = {}): Ga4Env {
  resetGa4EnvCache();
  return getGa4Env({ ...TEST_ENV, ...overrides });
}

function report(dimensions: string[], metrics: string[], rows: Array<{ dims: string[]; mets: string[] }>): Ga4ReportResponse {
  return {
    dimensionHeaders: dimensions.map((name) => ({ name })),
    metricHeaders: metrics.map((name) => ({ name })),
    rows: rows.map((row) => ({
      dimensionValues: row.dims.map((value) => ({ value })),
      metricValues: row.mets.map((value) => ({ value })),
    })),
  };
}

describe("GA4 authentication", () => {
  beforeEach(() => {
    resetGa4EnvCache();
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "should-not-be-read";
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"private_key":"nope"}';
  });

  it("does not require a private key and does not read JSON key env vars", () => {
    const env = sampleEnv();
    expect(ga4EnvUsesPrivateKey()).toBe(false);
    expect(ga4ReadsPrivateKeyEnvVars()).toEqual([]);
    expect(Object.keys(env)).not.toContain("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
    expect(Object.keys(env)).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
    expect(forbiddenPrivateKeyEnvNames()).toEqual([...FORBIDDEN_PRIVATE_KEY_ENV]);
  });

  it("validates WIF identifiers and builds the audience + impersonation URL", () => {
    const env = sampleEnv();
    expect(() => getGa4Env({ ...TEST_ENV, GCP_PROJECT_NUMBER: "" })).toThrow(/GA4 environment validation failed/);
    const config = buildExternalAccountConfig(env, async () => "oidc-token");
    expect(config.type).toBe("external_account");
    expect(config.audience).toBe(buildWifAudience(env));
    expect(config.audience).toContain("projects/123456789/locations/global/workloadIdentityPools/vercel-pool/providers/vercel-oidc");
    expect(config.service_account_impersonation_url).toContain("ga4-pipeline@test-project.iam.gserviceaccount.com:generateAccessToken");
    expect(config).not.toHaveProperty("private_key");
    expect(getAuthMode()).toBe(AUTH_MODE);
  });

  it("returns a safe auth error when the Vercel OIDC token is missing", async () => {
    await expect(getDefaultSubjectToken()).rejects.toBeInstanceOf(Ga4AuthError);
    await expect(getDefaultSubjectToken()).rejects.toThrow(/Vercel OIDC token is unavailable/);
  });

  it("does not log tokens or access tokens", () => {
    const leaked = sanitizeGa4Error(
      "Authorization: Bearer abc.def.ghi VERCEL_OIDC_TOKEN=secret access_token=ya29.xxx"
    );
    expect(leaked).not.toContain("abc.def.ghi");
    expect(leaked).not.toContain("secret");
    expect(leaked).not.toContain("ya29");
    expect(leaked).toContain("[REDACTED]");
  });

  it("keeps the token supplier runtime-scoped", () => {
    let calls = 0;
    const config = buildExternalAccountConfig(sampleEnv(), async () => {
      calls += 1;
      return "runtime-token";
    });
    expect(calls).toBe(0);
    return config.subject_token_supplier.getSubjectToken().then((token) => {
      expect(token).toBe("runtime-token");
      expect(calls).toBe(1);
    });
  });

  it("lets unrelated modules run without GA4 configuration", () => {
    resetGa4EnvCache();
    const { getEnv } = require("../config/env");
    expect(getEnv().SUPABASE_URL).toContain("supabase.co");
    expect(() => getGa4Env({ SUPABASE_URL: "https://x.supabase.co" })).toThrow(/GA4 environment validation failed/);
  });
});

describe("GA4 daily / channel / UTM data", () => {
  it("transforms YYYYMMDD dates and merges base + ecommerce daily rows", () => {
    expect(ga4DateToIso("20260820")).toBe("2026-08-20");
    const base = report(
      ["date"],
      [...BASE_METRICS],
      [{ dims: ["20260820"], mets: ["10", "8", "0.8", "0.2", "7", "3", "40", "2", "99.5"] }]
    );
    const ecommerce = report(
      ["date"],
      [...ECOMMERCE_METRICS],
      [{ dims: ["20260820"], mets: ["4", "5", "1"] }]
    );
    const rows = normalizeDailyRows("TEST", base, ecommerce);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      property_id: "TEST",
      date: "2026-08-20",
      sessions: 10,
      engaged_sessions: 8,
      users: 7,
      views: 40,
      purchases: 2,
      revenue: 99.5,
      add_to_carts: 4,
      items_added_to_cart: 5,
      begin_checkout: 1,
    });
  });

  it("keeps a unique date grain and updates instead of duplicating on rematch", () => {
    const first = normalizeDailyRows(
      "TEST",
      report(["date"], ["sessions"], [{ dims: ["20260820"], mets: ["10"] }]),
      report(["date"], ["addToCarts"], [{ dims: ["20260820"], mets: ["1"] }])
    );
    const second = normalizeDailyRows(
      "TEST",
      report(["date"], ["sessions"], [{ dims: ["20260820"], mets: ["12"] }]),
      report(["date"], ["addToCarts"], [{ dims: ["20260820"], mets: ["2"] }])
    );
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].sessions).toBe(12);
    expect(second[0].add_to_carts).toBe(2);
  });

  it("persists base-only and ecommerce-only rows with zeros on the missing side", () => {
    const rows = normalizeDailyRows(
      "TEST",
      report(["date"], ["sessions"], [{ dims: ["20260820"], mets: ["9"] }]),
      report(["date"], ["addToCarts"], [{ dims: ["20260821"], mets: ["3"] }])
    );
    const byDate = Object.fromEntries(rows.map((row) => [row.date, row]));
    expect(byDate["2026-08-20"].add_to_carts).toBe(0);
    expect(byDate["2026-08-21"].sessions).toBe(0);
    expect(byDate["2026-08-21"].add_to_carts).toBe(3);
  });

  it("normalizes blank channels to (not set) and merges on date+channel", () => {
    const rows = normalizeChannelRows(
      "TEST",
      report(
        ["date", "sessionDefaultChannelGroup"],
        ["sessions"],
        [
          { dims: ["20260820", ""], mets: ["5"] },
          { dims: ["20260820", "Organic Search"], mets: ["8"] },
        ]
      ),
      report(
        ["date", "sessionDefaultChannelGroup"],
        ["addToCarts"],
        [{ dims: ["20260820", "Organic Search"], mets: ["2"] }]
      )
    );
    const blank = rows.find((row) => row.channel === "(not set)");
    const organic = rows.find((row) => row.channel === "Organic Search");
    expect(blank?.sessions).toBe(5);
    expect(organic?.add_to_carts).toBe(2);
  });

  it("builds UTM keys, excludes all-(not set), and keeps partial tags", () => {
    expect(normalizeNotSet("")).toBe("(not set)");
    expect(buildUtmKey("source_test", "campaign_test", "medium_test", "content_test")).toBe(
      "source_test||campaign_test||medium_test||content_test"
    );
    expect(shouldKeepUtmRow("(not set)", "(not set)", "(not set)", "(not set)")).toBe(false);
    expect(shouldKeepUtmRow("source_test", "(not set)", "(not set)", "(not set)")).toBe(true);
    expect(isAllNotSet(["", " ", "(not set)", "(not set)"])).toBe(true);

    const rows = normalizeUtmRows(
      "TEST",
      report(
        ["date", "sessionManualSource", "sessionManualCampaignName", "sessionManualMedium", "sessionManualAdContent"],
        ["sessions"],
        [
          { dims: ["20260820", "", "", "", ""], mets: ["9"] },
          { dims: ["20260820", "source_test", "campaign_test", "", "content_test"], mets: ["4"] },
        ]
      ),
      report(
        ["date", "sessionManualSource", "sessionManualCampaignName", "sessionManualMedium", "sessionManualAdContent"],
        ["addToCarts"],
        [{ dims: ["20260820", "source_test", "campaign_test", "", "content_test"], mets: ["1"] }]
      )
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].utm_key).toBe("source_test||campaign_test||(not set)||content_test");
    expect(rows[0].utm_medium).toBe("(not set)");
    expect(rows[0].add_to_carts).toBe(1);
  });

  it("parses rates as decimals and revenue as numeric, not formatted currency", () => {
    expect(parseRateMetric("0.993")).toBe(0.993);
    expect(parseIntegerMetric("12.9")).toBe(12);
    expect(parseDecimalMetric("₹5,800.00")).toBe(5800);
  });
});

describe("GA4 scheduling / backfill", () => {
  it("uses 90-day daily/channel windows and 3-day chunks", () => {
    const daily = planBackfillChunks(90, 3, "UTC", new Date("2026-08-26T00:00:00Z"));
    expect(inclusiveDayCount(daily[0].since, daily[daily.length - 1].until)).toBe(91);
    expect(daily.every((chunk) => inclusiveDayCount(chunk.since, chunk.until) <= 3)).toBe(true);
    const channel = planBackfillChunks(90, 3, "UTC", new Date("2026-08-26T00:00:00Z"));
    expect(channel).toHaveLength(daily.length);
  });

  it("reads the UTM start date from config and chunks by 30 days", () => {
    const env = sampleEnv();
    const chunks = planUtmBackfillChunks(env.GA4_UTM_BACKFILL_START_DATE, env.GA4_UTM_BACKFILL_CHUNK_DAYS, "UTC", new Date("2026-01-12T00:00:00Z"));
    expect(chunks[0].since).toBe("2025-10-14");
    expect(inclusiveDayCount(chunks[0].since, chunks[0].until)).toBe(30);
  });

  it("treats recent daysBack=2 as three inclusive calendar dates", () => {
    const range = getRecentRange(2, "UTC", new Date("2026-08-26T12:00:00Z"));
    expect(range.until).toBe("2026-08-26");
    expect(range.since).toBe("2026-08-24");
    expect(inclusiveDayCount(range.since, range.until)).toBe(3);
  });

  it("rejects a second active backfill and resumes only when a job exists", () => {
    expect(() =>
      assertBackfillAllowed(false, {
        id: "job-1",
        property_id: "TEST",
        dataset: "daily",
        requested_from: "2026-01-01",
        requested_to: "2026-01-31",
        chunk_days: 3,
        next_chunk_start: "2026-01-04",
        status: "paused",
      })
    ).toThrow(Ga4SyncConflictError);
    expect(() => assertBackfillAllowed(true, null)).toThrow(Ga4SyncConflictError);
    expect(() => assertNoActiveBackfillConflict("recent", {
      id: "job-1",
      property_id: "TEST",
      dataset: "daily",
      requested_from: "2026-01-01",
      requested_to: "2026-01-31",
      chunk_days: 3,
      next_chunk_start: "2026-01-04",
      status: "running",
    })).toThrow(Ga4SyncConflictError);
  });

  it("isolates locks by ga4 + property + dataset", () => {
    expect(lockIdentity("TEST", "daily")).toBe("ga4:TEST:daily");
    expect(lockIdentity("TEST", "channel")).not.toBe(lockIdentity("TEST", "utm"));
  });

  it("limits test range to 3 days and repair to 31", () => {
    expect(() => assertAllowedRange("test", { since: "2026-08-01", until: "2026-08-05" })).toThrow(/3 calendar days/);
    expect(() => assertAllowedRange("repair", { since: "2026-07-01", until: "2026-08-10" })).toThrow(/31 calendar days/);
    const recent = resolveSyncRange({
      mode: "recent",
      timeZone: "UTC",
      recentDays: 2,
      now: new Date("2026-08-26T00:00:00Z"),
    });
    expect(inclusiveDayCount(recent.since, recent.until)).toBe(3);
  });

  it("resumes backfill from the next stored chunk start", () => {
    const remaining = chunkDateRange("2026-01-04", "2026-01-10", 3);
    expect(remaining[0]).toEqual({ since: "2026-01-04", until: "2026-01-06" });
  });
});

describe("GA4 retry", () => {
  it("retries 429/500/503/quota/timeout and not 401/403/invalid fields", () => {
    expect(isRetryableGa4Failure({ status: 429 })).toBe(true);
    expect(isRetryableGa4Failure({ status: 500 })).toBe(true);
    expect(isRetryableGa4Failure({ status: 503 })).toBe(true);
    expect(isRetryableGa4Failure({ message: "resource exhausted / quota" })).toBe(true);
    expect(isRetryableGa4Failure({ message: "deadline exceeded timeout" })).toBe(true);
    expect(isRetryableGa4Failure({ status: 401 })).toBe(false);
    expect(isRetryableGa4Failure({ status: 403 })).toBe(false);
    expect(isRetryableGa4Failure({ message: "invalid dimension dateX" })).toBe(false);
    expect(isRetryableGa4Failure({ message: "invalid metric sessionsX" })).toBe(false);
    expect(classifyGa4Error({ status: 401 })).toBe("authentication");
  });

  it("uses exponential backoff with optional Retry-After and mocked jitter", () => {
    expect(retryDelayMs(0, null, 0)).toBe(3000);
    expect(retryDelayMs(1, null, 0)).toBe(6000);
    expect(retryDelayMs(2, null, 0)).toBe(12000);
    expect(retryDelayMs(3, null, 0)).toBe(24000);
    expect(retryDelayMs(4, null, 0)).toBe(48000);
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(retryDelayMs(0, 7000, 0)).toBe(7000);
  });
});

describe("GA4 pagination", () => {
  it("advances offset until a short page and guards infinite paging", () => {
    expect(nextOffset(0, 2, 2)).toBe(2);
    expect(nextOffset(2, 2, 1)).toBeNull();
    expect(shouldStopPaging(50)).toBe(true);
  });

  it("pages a mocked GA4 report", async () => {
    const env = sampleEnv({ GA4_API_PAGE_LIMIT: "2" });
    let calls = 0;
    const client = new Ga4DataClient({
      env,
      getAccessToken: async () => "test-access-token",
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        const rows =
          calls === 1
            ? [
                { dimensionValues: [{ value: "20260820" }], metricValues: [{ value: "1" }] },
                { dimensionValues: [{ value: "20260821" }], metricValues: [{ value: "2" }] },
              ]
            : [{ dimensionValues: [{ value: "20260822" }], metricValues: [{ value: "3" }] }];
        return new Response(JSON.stringify({ rows, dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions" }] }), {
          status: 200,
        });
      },
    });
    const page = await client.fetchReportPages({
      dimensions: ["date"],
      metrics: ["sessions"],
      range: { since: "2026-08-20", until: "2026-08-22" },
    });
    expect(page.rows).toHaveLength(3);
    expect(calls).toBe(2);
  });
});

describe("GA4 analytics math", () => {
  it("derives engagement from sums, not AVG of row rates", () => {
    expect(derivedEngagementRate(8, 10)).toBe(0.8);
    expect(derivedBounceRate(8, 10)).toBeCloseTo(0.2);
    expect(derivedEngagementRate(0, 0)).toBeNull();
    const day1 = 0.9;
    const day2 = 0.1;
    const wrongAvg = (day1 + day2) / 2;
    const correct = (90 + 1) / (100 + 10);
    expect(correct).not.toBe(wrongAvg);
    expect(clampPageSize(500)).toBe(100);
  });
});

describe("GA4 client retry against mocked HTTP", () => {
  it("retries 429 then succeeds", async () => {
    const env = sampleEnv();
    let calls = 0;
    const client = new Ga4DataClient({
      env,
      getAccessToken: async () => "test-access-token",
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ error: { message: "too many requests" } }), { status: 429 });
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      },
    });
    await client.runReport({ dateRanges: [] });
    expect(calls).toBe(2);
    expect(client.retryCount).toBe(1);
  });

  it("does not retry 403", async () => {
    const env = sampleEnv();
    let calls = 0;
    const client = new Ga4DataClient({
      env,
      getAccessToken: async () => "test-access-token",
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "permission denied" } }), { status: 403 });
      },
    });
    await expect(client.runReport({ dateRanges: [] })).rejects.toThrow(/permission/i);
    expect(calls).toBe(1);
  });
});

describe("GA4 internals", () => {
  it("authorizes internal sync with a timing-safe Bearer secret", () => {
    sampleEnv();
    expect(authorizeInternalSync("Bearer test-ga4-sync-secret")).toBe(true);
    expect(authorizeInternalSync("Bearer no")).toBe(false);
  });

  it("does not start the local scheduler in Jest or when disabled", () => {
    expect(shouldStartLocalGa4Scheduler({ syncEnabled: true, jestWorkerId: "1" })).toBe(false);
    expect(shouldStartLocalGa4Scheduler({ syncEnabled: false, runtime: "nodejs" })).toBe(false);
    expect(shouldStartLocalGa4Scheduler({ syncEnabled: true, runtime: "nodejs" })).toBe(true);
  });

  it("normalizes property IDs and uses the reporting timezone for today", () => {
    expect(normalizePropertyId("properties/TEST")).toBe("TEST");
    expect(getGa4PropertyId(sampleEnv())).toBe("TEST");
    expect(formatDateInTimeZone(new Date("2026-08-26T18:30:00Z"), "Asia/Kolkata")).toBe("2026-08-27");
    expect(addCalendarDays("2026-08-26", -2)).toBe("2026-08-24");
    expect(isGa4SyncEnabled(sampleEnv())).toBe(false);
  });

  it("merges reports on an arbitrary grain key", () => {
    const merged = mergeReports(
      [{ key: "a", metrics: { sessions: 2 } }],
      [{ key: "a", metrics: { add_to_carts: 1 } }, { key: "b", metrics: { add_to_carts: 4 } }]
    );
    expect(merged.get("a")?.sessions).toBe(2);
    expect(merged.get("a")?.add_to_carts).toBe(1);
    expect(merged.get("b")?.sessions).toBe(0);
    expect(merged.get("b")?.add_to_carts).toBe(4);
  });
});
