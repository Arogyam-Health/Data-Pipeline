# Meta dashboard parity notes

## Date contract

The dashboard API is the source of truth for the reporting window. `today`,
`7d`, and `30d` are sent as named presets; all other presets send their exact
calendar dates. Named presets never include the previous custom dates. The API
resolves `today` using the timezone stored for the Meta ad account and returns
the resolved `from`/`to` pair in every response.

The client fallback is Asia/Kolkata only until the first response is received;
the displayed label then uses the account timezone returned by the API. Meta
reporting `DATE` values are not timezone-shifted.

## Metric grain

Spend, impressions, clicks, actions and purchase values are additive at the
stored ad/day grain. Reach is a unique-user metric and must not be described as
Ads Manager campaign reach when calculated by summing ad/day rows. Campaign
parity for reach requires a campaign-level Insights request (or a persisted
campaign-level fact); the current ad/day schema does not contain that grain.
The dashboard therefore exposes the stored value without inventing a
cross-grain correction.

## Metadata and freshness

When `META_METADATA_SYNC_ENABLED=true`, the scheduled today sync also runs a
metadata refresh, so status/effective status, budget, schedule and attribution
settings are refreshed without a manual POST. Fields absent from the Meta API
are displayed as `Not available`; they are not treated as zero.

## Validation

The deterministic timezone boundary (2026-09-06 18:40 UTC → 2026-09-07 in
Asia/Kolkata) and range precedence are covered by `src/__tests__/meta.test.ts`.
Fresh API-vs-stored metric parity still requires valid Meta credentials and a
live sync; no screenshot values are hardcoded.
