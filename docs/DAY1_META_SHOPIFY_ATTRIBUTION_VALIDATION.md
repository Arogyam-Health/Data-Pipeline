# Day 1 — Meta → Shopify Attribution Validation

**Window:** `2026-08-01` to `2026-09-03 23:59:59+00` (`data_pipeline.shopify_orders.created_at_shopify`)
**Run date:** 2026-09-03 (data from datapipeline server, Supabase `meoppllmtcpmnlxfldma`)
**Scope:** Audit only — no migrations, no sync changes, no attribution logic changes.
**SQL:** `docs/sql/day1_meta_shopify_attribution_validation.sql` (Q1–Q13, one row per Shopify order CTE)

---

## 1. Confirmed Tracking Convention

| Shopify UTM | Expected Meta column | Verified? |
|---|---|---|
| `utm_campaign` | `data_pipeline.meta_campaigns.campaign_id` | **Confirmed** — 766/1220 (62.8% of orders with campaign) are exact numeric matches; mismatches are largely stale/misaligned IDs, not a different convention. |
| `utm_term` | `data_pipeline.meta_adsets.adset_id` | **Confirmed strongly** — 1017/1017 (100% of orders with term) are exact matches. No unmatched term in window. |
| `utm_content` | `data_pipeline.meta_ads.ad_id` | **Confirmed** — 992/1200 (82.7% of orders with content) are exact numeric matches; remaining 208 are `NAME_OR_TEXT` / `OTHER` / `{{ad.id}}` placeholders, not numeric Meta IDs. |
| `utm_source` | Facebook/Meta traffic identifier | **Partial** — Strict list (`facebook`/`meta`/`instagram`) only 34 orders (2.05%). Broad Meta (including `fb`/`ig`/`an`) covers 1141 orders (68.65%) and aligns with recoverable attribution. Historical tracking uses `fb`/`ig`/`an` shorthand; strict filter under-counts Meta. |
| `utm_medium` | not part of Meta join, 66.97% populated | Confirmed existence, not used for joins. |

Schema verified (`src/lib/supabase` + `supabase/migrations/009_shopify_schema.sql` + `013_meta_ads_schema.sql`):
- `shopify_orders.shopify_order_id` PK, `created_at_shopify timestamptz`
- `shopify_note_attributes(shopify_order_id, position, attribute_name, attribute_value)` — pivoted with `MAX FILTER (WHERE lower(attribute_name)=...)` per spec.
- `meta_campaigns(campaign_id PK, name, ...)` — 65 rows
- `meta_adsets(adset_id PK, campaign_id FK, name, ...)` — 166 rows
- `meta_ads(ad_id PK, adset_id FK, campaign_id, name, creative_id FK)` — 777 rows
- `meta_ads_daily` fact table — 4410 rows, 8 distinct campaigns / 24 adsets / 212 ads

> All queries enforced **ONE ROW PER SHOPIFY ORDER** and `btrim()` + `lower()` handling.

---

## 2. Dataset Size

| Metric | Count |
|---|---|
| Total `shopify_orders` in DB | 1680 |
| **Total in window Aug 1–Sep 3** | **1662** |
| Total `shopify_note_attributes` rows in window | 20,929 (≈12.6 per order) |
| Total `meta_campaigns` (global) | 65 |
| Total `meta_adsets` (global) | 166 |
| Total `meta_ads` (global) | 777 |
| Total `meta_ads_daily` rows (global) | 4410 |

Window excludes 18 orders before Aug 1 (earliest in DB is `2026-07-19`). No `test` filtering applied per spec; all orders counted.

---

## 3. Raw UTM Coverage (Q1)

| Field | Orders with value | % of all 1662 | % of with field |
|---|---|---|---|
| `utm_source` | 1654 | **99.52%** | — |
| `utm_medium` | 1113 | 66.97% | — |
| `utm_campaign` | 1220 | **73.41%** | — |
| `utm_term` | 1017 | 61.19% | — |
| `utm_content` | 1200 | 72.20% | — |
| `utm_source` strict Meta (`facebook`/`meta`/`instagram`) | 34 | 2.05% | — |
| `utm_source` broad Meta (`facebook`/`meta`/`instagram`/`fb`/`ig`/`an`) | 1141 | **68.65%** | — |

**Source distribution (top, raw):**

| `utm_source` (raw) | count | pct |
|---|---|---|
| `ig` | 599 | 36.2% |
| `fb` | 481 | 29.1% |
| `direct` | 431 | 26.1% |
| `kwikengage` | 44 | 2.7% |
| `facebook` | 34 | 2.1% |
| `an` | 27 | 1.6% |
| `google` | 18 | 1.1% |
| `{{site_source_name}}` | 9 | 0.5% |
| others (`Legacy_Website_*`, `th`, `chatgpt.com`, `{{campaign.name}}`, `DMLink`) | 11 | 0.7% |

> `direct` = 26% unattributed baseline. `fb`/`ig`/`an` are Audience Network / Facebook / Instagram shorthand — historically Meta but not in the strict allow-list. Report preserves strict vs broad distinction.

---

## 4. Direct Exact ID Matching (Q2)

| Join | Matches | % of all 1662 | % of orders with that UTM |
|---|---|---|---|
| `utm_campaign = meta_campaigns.campaign_id` | **766** | **46.09%** | **62.79%** of 1220 with campaign |
| `utm_term = meta_adsets.adset_id` | **1017** | **61.19%** | **100.00%** of 1017 with term |
| `utm_content = meta_ads.ad_id` | **992** | **59.69%** | **82.67%** of 1200 with content |

Observations:
- `adset` > `campaign` and `ad` > `campaign` suggests campaign dimension is the lossy layer.
- `1017/1017` term match = perfect — every numeric `utm_term` supplied is a real `adset_id`.
- `992/1200` content match = 208 content values are not numeric ad IDs (see §8).

For comparison, historical full-DB numbers (spec's manual query) were `739/1615` campaign, `981/1615` adset, `959/1615` ad — window-specific recalculation is higher because Aug–Sep has cleaner tracking.

---

## 5. Exact Ad Hierarchy Consistency (Q3–Q4)

**Cohort:** 992 orders with exact `utm_content = meta_ads.ad_id`

| Check | Count | % of 992 |
|---|---|---|
| **Adset consistent** (`utm_term = meta_ads.adset_id`) | **866** | **87.30%** |
| Adset `MISSING_UTM_TERM` | 126 | 12.70% |
| Adset `CONFLICT` | 0 | 0.00% |
| **Campaign consistent** (`utm_campaign = meta_ads.campaign_id`) | **765** | **77.12%** |
| Campaign `MISSING_UTM_CAMPAIGN` | 0 | 0.00% |
| Campaign `CONFLICT` | **227** | **22.88%** |

Distinguish missing vs conflict per spec — missing ≠ conflict.

**Interpretation:**
- **Ad → Adset** hierarchy is reliable; no conflicts.
- **Ad → Campaign** hierarchy has 22.9% conflicts. Every ad-matched order had a `utm_campaign` value, but 227 disagreed with `meta_ads.campaign_id`.
- Sample conflicts: `utm_campaign=120240190107650275` (actually an adset ID) vs `meta_campaign_id=120225345712600275`; `120247010793070275` vs `120242340956840275` — pattern suggests stale/copied UTM where `utm_campaign` carries an **adset ID** or previous campaign ID, while `utm_content` (ad) is current and stronger.

> The ad ID is the strongest identifier. Meta itself derives `ad → adset → campaign`, so a campaign conflict does not invalidate ad attribution — it indicates **tracking inconsistency**, not failure.

---

## 6. Recoverable Attribution Coverage (Q5, Q10)

Direct campaign attribution under-counts true Meta campaign reach.

| Metric | Count | % of all 1662 |
|---|---|---|
| **Direct campaign matches** (`utm_campaign → campaign_id`) | 766 | 46.09% |
| **Recoverable exact campaign** (`ad.campaign_id` COALESCE `adset.campaign_id` COALESCE `campaign_id`) | **1143** | **68.77%** |
| **Recoverable exact adset** (`ad.adset_id` COALESCE `adset.adset_id`) | **1143** | **68.77%** |
| **Exact ad** (`ad_id`) | 992 | 59.69% |

**Breakdown of recoverable set (union):**

| Source of recovery | Orders |
|---|---|
| Exact ad (`ad_id`) | 992 |
| Exact adset only (`adset_id` minus ad) | 151 |
| Exact campaign only (`campaign_id` minus ad/adset) | 0 |
| **Union (distinct orders with any exact campaign derivable)** | **1143** |

> **+377 orders** (22.68 pct points) gain exact campaign attribution when recovering through ad/adset hierarchy vs direct campaign join. This is the Day 2 priority.

---

## 7. Attribution Tier Distribution (Q6)

Mutually exclusive tiers, priority `CONFLICT > EXACT_AD > EXACT_ADSET > EXACT_CAMPAIGN > META_SOURCE_ONLY > UNATTRIBUTED`, must sum to 1662.

### 7a. Strict CONFLICT definition (ad campaign mismatch only)

| Tier | Count | % |
|---|---|---|
| `CONFLICT` (ad matched but `utm_campaign ≠ ad.campaign_id`) | 227 | 13.66% |
| `EXACT_AD` (ad matched, hierarchy consistent) | 765 | 46.03% |
| `EXACT_ADSET` (adset matched, no ad) | 151 | 9.08% |
| `EXACT_CAMPAIGN` (campaign only) | 0 | 0.00% |
| `META_SOURCE_ONLY` (strict `facebook`/`meta`/`instagram` only, no exact IDs) | 0 | 0.00% |
| `UNATTRIBUTED` | 519 | 31.23% |
| **Total** | **1662** | **100%** |

### 7b. Broad CONFLICT definition (any lower-level hierarchy contradiction) — recommended audit view

| Tier | Count | % |
|---|---|---|
| `CONFLICT` (ad **or** adset matched but supplied higher-level UTM contradicts Meta hierarchy) | **377** | **22.68%** |
| `EXACT_AD` | 765 | 46.03% |
| `EXACT_ADSET` | 1 | 0.06% |
| `EXACT_CAMPAIGN` | 0 | 0.00% |
| `META_SOURCE_ONLY` (strict) | 0 | 0.00% |
| `UNATTRIBUTED` | 519 | 31.23% |
| **Total** | **1662** | **100%** |

Note: Broad conflict adds the 150 orders where `utm_term` (adset) is exact but `utm_campaign` conflicts with that adset's true campaign — these are the same numeric IDs mis-placed in campaign (e.g., `120240190107650275`, `120247010793070275` appearing as campaign).

### With broad Meta source (`fb`/`ig`/`an` counted as Meta)

| Tier (broad conflict + broad meta) | Count | % |
|---|---|---|
| `CONFLICT` | 377 | 22.68% |
| `EXACT_AD` | 765 | 46.03% |
| `EXACT_ADSET` | 1 | 0.06% |
| `META_SOURCE_ONLY` (broad) | 6 | 0.36% |
| `UNATTRIBUTED` | 513 | 30.86% |

> Only 6 orders are Meta-source-only under broad definition; the rest of `fb`/`ig` traffic already has exact IDs. Under strict definition, meta-source-only is 0 because all 34 `facebook` orders already have exact ad/adset.

**Takeaway:** 31% unattributed is the true gap; Meta source alone without IDs adds almost nothing in this window.

---

## 8. Unmatched Pattern Analysis (Q7–Q9)

### 8a. Unmatched `utm_campaign` — 454 orders, 19 distinct values

| `utm_campaign` | count | Pattern |
|---|---|---|
| `120240190107650275` | 105 | `NUMERIC_ID_LIKE` |
| `120247010793070275` | 95 | `NUMERIC_ID_LIKE` |
| `Andromeda Campaign` | 69 | `NAME_OR_TEXT` |
| `120241324971580275` | 55 | `NUMERIC_ID_LIKE` |
| `120243760036160275` | 24 | `NUMERIC_ID_LIKE` |
| `23682867331` | 18 | `NUMERIC_ID_LIKE` |
| `abc_8june` | 15 | `NAME_OR_TEXT` |
| `website_visitor_clm` | 14 | `NAME_OR_TEXT` |
| `websitevisitor_19aug2026` | 14 | `NAME_OR_TEXT` |
| `120250542377380275` | 14 | `NUMERIC_ID_LIKE` |
| `{{campaign.id}}` | 8 | `MALFORMED` |
| `120243830294720275` | 7 | `NUMERIC_ID_LIKE` |
| `120250727377500275` | 6 | `NUMERIC_ID_LIKE` |
| `Legacy_Website_AnandK+Sarmukh` | 5 | `OTHER` |
| ... | ... | ... |

**Pattern summary:** `NUMERIC_ID_LIKE` 324 (71.4%), `NAME_OR_TEXT` 115 (25.3%), `MALFORMED` 10 (2.2%), `OTHER` 5 (1.1%)

**Evidence for numeric unmatched:**
- None appear in `meta_campaigns` (65), nor in `meta_ads.campaign_id`, nor in `meta_adsets.campaign_id`, nor in `meta_ads_daily.campaign_id` (8 distinct). So not a metadata backfill gap — these are not known campaigns in any table.
- 6 of 8 numeric values **do exist as `adset_id`** in `meta_adsets` (e.g., `120240190107650275`, `120247010793070275` are valid adsets). Root cause: **adset ID placed in `utm_campaign` field** — tracking setup error or ad copied across campaigns with stale UTM.
- `23682867331` is a short 11-digit ID unlike the 18-digit `1202…` pattern — likely a different Meta account or historical campaign outside current metadata coverage, but no evidence in facts table.

### 8b. Unmatched `utm_term` — 0 orders

All 1017 supplied `utm_term` values match `meta_adsets.adset_id`. No unmatched term to investigate. Even numeric checks show no term is referenced only via `meta_ads.adset_id` without dimension row — metadata is complete for adsets in this window.

### 8c. Unmatched `utm_content` — 208 orders, 17 distinct values

| `utm_content` | count | Pattern |
|---|---|---|
| `Warren - Andromeda` | 55 | `NAME_OR_TEXT` |
| `TOF - How Does It Work? - Problem Aware` | 36 | `NAME_OR_TEXT` |
| `Test - *MayurH2__Testing__Solution Aware__Desired Outcome__Emotion-Intro-Result` | 15 | `OTHER` |
| `AI_6a26482d04c939fb27230c90` | 15 | `OTHER` |
| `Andromeda_ Amodh_Gaur` | 15 | `NAME_OR_TEXT` |
| `TOF - Side Effects - Problem Aware` | 14 | `NAME_OR_TEXT` |
| `AI_6a85a362e3906ac2e32ca82e` | 14 | `OTHER` |
| `AI_6a58bb721b5c7b03b93dbd0e` | 10 | `OTHER` |
| `{{ad.id}}` | 9 | `MALFORMED` |
| `*RoopaH1__Testing__Solution Aware__Desired Outcome__Result-Intro-Emotion` | 9 | `OTHER` |
| `HK Bohra_SideEffects` | 6 | `NAME_OR_TEXT` |
| `Andromeda_3 Layers_W/O_B-Roll` | 4 | `NAME_OR_TEXT` |
| ... | ... | ... |

**Pattern summary:** `NAME_OR_TEXT` 134 (64.4%), `OTHER` 64 (30.8%), `MALFORMED` 10 (4.8%), `NUMERIC_ID_LIKE` **0**

**Evidence:**
- No numeric unmatched content exists, so `META_FACT_ID_FOUND_METADATA_MISSING` category = 0 in window. All numeric content values are already matched (992/992 numeric content found in metadata).
- For the text/ad-name-like values, checking `meta_ads_daily.ad_id` (212 distinct) shows none correspond — these are creative labels or template placeholders (`{{ad.id}}`, `AI_*` hashes), not Meta ad IDs.
- These likely represent GoKwik / manual UTM or legacy website tracking (`Legacy_Website_*`), not Meta.

---

## 9. Meta Metadata Completeness (Q10)

| Entity | Distinct in `meta_ads_daily` (facts) | Distinct in metadata table | Missing in metadata (fact IDs not in dim) | Metadata not in facts |
|---|---|---|---|---|
| Campaign | 8 | 65 | **0** | 57 |
| Adset | 24 | 166 | **0** | 142 |
| Ad | 212 | 777 | **0** | 565 |

> **No missing dimension metadata** in window. Every `campaign_id`/`adset_id`/`ad_id` appearing in facts has a corresponding dimension row. The opposite is true: metadata contains many IDs not yet seen in daily facts (57 campaigns, 142 adsets, 565 ads not in facts) — expected because metadata sync may cover broader account history than the 30-day fact backfill.

**Conclusion for unmatched Shopify failures:** Failures are **Shopify tracking** issues (wrong field, placeholder, text label), not Meta metadata backfill failures. No evidence that an unmatched Shopify UTM value exists in facts but not in metadata.

---

## 10. Historical Pattern — Attribution Quality Over Time (Q11)

Weekly buckets (Monday start):

| Week start | Total | Exact Ad % | Exact Adset % | Exact Campaign % |
|---|---|---|---|---|
| 2026-07-27* | 11 | 54.5% | 54.5% | 18.2% |
| 2026-08-03 | 114 | 57.0% | 68.4% | 46.5% |
| 2026-08-10 | 330 | 62.1% | 61.8% | 45.8% |
| 2026-08-17 | 446 | 56.1% | 56.7% | 43.7% |
| 2026-08-24 | 489 | 60.9% | 63.4% | 47.2% |
| 2026-08-31 | 272 | 61.8% | 61.0% | 49.3% |

\* partial week (Aug 1–2 only)

Daily granularity confirms same pattern (see Q11 daily variant): no sharp break; exact ad stays 45–83% daily with no monotonic improvement or degradation. Campaign % consistently trails ad/adset by ~15 points, reflecting the persistent `utm_campaign` misalignment.

**Did tracking format change?** No evidence of a format cutover within Aug 1–Sep 3. The mix of `NUMERIC_ID_LIKE` vs `NAME_OR_TEXT` vs `MALFORMED` is stable week-to-week. The dominant error (adset ID in campaign field) appears in every week, not isolated to old or new data. `direct` source share (26%) also stable.

> If older tracking conventions existed before July 19 or after Sep 3, they are outside this window.

---

## 11. Recommended Day 2 Attribution Priority

Confirmed by Day 1 evidence:

```
1. utm_content → meta_ads.ad_id  (strongest, 59.69% exact)
       ↓ derive adset_id + campaign_id from meta_ads
2. ELSE utm_term → meta_adsets.adset_id  (100% of supplied term are valid; 61.19% overall)
       ↓ derive campaign_id from meta_adsets
3. ELSE utm_campaign → meta_campaigns.campaign_id  (46.09% direct, but extends to 68.77% via above)
4. ELSE Meta-like utm_source → META_SOURCE_ONLY
       (strict: facebook/meta/instagram = 2.05%; broad fb/ig/an = 68.65% — use broad for reporting but strict for audit)
5. ELSE UNATTRIBUTED
```

**Additional rules:**
- **Do not discard exact ad on hierarchy conflict.** Resolved attribution = exact ad; set `hierarchy_conflict=true` and log `adset_consistency_status` / `campaign_consistency_status` (`MATCH`/`MISSING_*`/`CONFLICT`) per Q3. Conflicts (227 strict ad-campaign, 377 broad) need UTM fix, not attribution discard.
- **Separate attribution resolution from tracking consistency.** Attribution uses priority above; consistency flags are diagnostic.
- **Handle missing UTM as not a conflict** — e.g., 126 ad matches have `MISSING_UTM_TERM` (12.7%) but are still `EXACT_AD` via hierarchy recovery.
- **Normalize UTM values:** `btrim()` + case-insensitive `lower(utm_source)`; store raw and normalized forms. Treat `{{campaign.id}}` / `{{ad.id}}` / `{{site_source_name}}` as `MALFORMED` → unattributed, not Meta.
- **Preserve adset→campaign derivation** for the 151 orders where ad is missing but adset is exact — they still yield exact campaign.

---

## 12. Final Answers (A–P)

**A. Is `utm_campaign → campaign_id` confirmed?** Yes, 62.79% of orders with `utm_campaign` match exactly; mismatches are systematic (adset ID in campaign field, text labels, placeholders), not a different convention.

**B. Is `utm_term → adset_id` confirmed?** **Yes, strongly** — 100% match rate. Every supplied `utm_term` is a valid `adset_id`.

**C. Is `utm_content → ad_id` confirmed?** Yes, 82.67% of orders with `utm_content` match exactly; remainder are non-numeric ad names/placeholders/hashes, not numeric IDs.

**D. How many Shopify orders have an exact Meta ad match?** **992**

**E. What percentage of all Shopify orders is that?** **59.69%** of 1662 (82.67% of orders with `utm_content`)

**F. Of exact ad matches, what percentage have a consistent adset UTM?** **87.30%** (866/992) MATCH; 12.70% missing term, 0% conflict.

**G. Of exact ad matches, what percentage have a consistent campaign UTM?** **77.12%** (765/992) MATCH; 0% missing, 22.88% conflict (227).

**H. How many orders can have exact campaign attribution RECOVERED through `ad_id` OR `adset_id` OR direct `campaign_id`?** **1143**

**I. What is that true recoverable campaign percentage?** **68.77%** of all orders (vs 46.09% direct campaign only; +22.68 points via hierarchy).

**J. How many orders are Meta source only?** Strict (`facebook`/`meta`/`instagram`) = **0** (or 6 under broad `fb`/`ig`/`an` + broad conflict definition). All strict Meta-source orders already have exact IDs.

**K. How many are completely unattributed?** **519** (31.23%) under strict tiers; **513** (30.86%) under broad Meta source.

**L. How many contain hierarchy conflicts?** **227** strict (ad campaign mismatch) = 13.66%; **377** broad (any lower-level mismatch) = 22.68% of all orders; 22.88% of ad-matched orders.

**M. What are the top reasons for unmatched IDs?**
1. `NUMERIC_ID_LIKE` adset ID in `utm_campaign` field (324/454 campaign unmatched = 71.4%; e.g., `120240190107650275`, `120247010793070275`).
2. `NAME_OR_TEXT` campaign/ad names instead of IDs (115 campaign unmatched, 134 content unmatched; e.g., `Andromeda Campaign`, `Warren - Andromeda`, `TOF - …`).
3. `MALFORMED` template placeholders (`{{campaign.id}}` ×8, `{{ad.id}}` ×9, `{{site_source_name}}` ×9).
4. `OTHER` hashes/legacy labels (`AI_6a2…` hashes, `Legacy_Website_AnandK+Sarmukh`, `abc_8june`, `website_visitor_clm`).
5. No numeric content unmatched — text content failures are creative names, not ID typos.

**N. Is Meta metadata completeness causing apparent failures?** **No.** 0 fact IDs missing in dimensions in window; failures are Shopify-side UTM content. Metadata has surplus coverage (57 campaigns, 142 adsets, 565 ads not in facts), not a gap.

**O. Did the tracking format change over time?** No detectable change within Aug 1–Sep 3. Weekly exact ad 56–62%, exact campaign 43–49%, stable; same unmatched patterns every week. No break or improvement trend.

**P. What exact attribution rule should Day 2 implement?**
```sql
resolved_ad_id      = matched_ad.ad_id
resolved_adset_id   = COALESCE(matched_ad.adset_id, matched_adset.adset_id)
resolved_campaign_id= COALESCE(matched_ad.campaign_id, matched_adset.campaign_id, matched_campaign.campaign_id)
-- priority: ad > adset > campaign > meta_source > unattributed
-- on conflict: keep resolved ad/adset but flag hierarchy_conflict=true
```
See §11 for full priority ladder and normalization rules.

---

## Success Criteria Check

> "For **59.69%** of Shopify orders we can identify the exact Meta ad (992/1662)."

> "For **68.77%** of Shopify orders we can identify an exact Meta campaign, including campaigns recovered through exact ad/adset hierarchy (1143/1662) — vs 46.09% direct campaign."

> "**0.36%** (broad) / **0%** (strict) are Meta source only."

> "**30.86%** (broad) / **31.23%** (strict) remain unattributed."

And we know WHY the remaining records do not match (see §8) and that metadata completeness is not the cause (see §9).

Do not start Day 2 implementation until this audit is reviewed.

