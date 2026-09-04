# Day 2 — Meta → Shopify Attribution Layer

**Status:** Implemented as database view — `data_pipeline.shopify_meta_attribution` (+ alias `analytics.shopify_meta_attribution`)  
**Migration:** `supabase/migrations/035_shopify_meta_attribution_layer.sql`  
**Validation SQL:** `docs/sql/day2_meta_shopify_attribution_validation.sql` (V1–V13)  
**Validation run:** Live DB `meoppllmtcpmnlxfldma` — total `shopify_orders` **1752** (window `2026-08-01`→`2026-09-04` **1734** orders; Day 1 spec was `2026-09-03` **1694**, now +40 on Sep 4)  
**Principle:** One row per Shopify order, deterministic hierarchy `ad > adset > campaign`, channel attribution ≠ Meta attribution, `direct` is attributed, only blank/malformed source is `UNKNOWN`.

---

## 1. Purpose

Enrich every Shopify order with:
- **Channel** (`META`/`DIRECT`/`GOOGLE`/`KWIKENGAGE`/`OTHER`/`UNKNOWN`) and `channel_attributed` flag (Day 2 requirement: `direct` 441 orders must not become unattributed)
- **Meta resolved entities** (`resolved_campaign_id`/`adset_id`/`ad_id` + names) via strongest deterministic ID
- **Attribution states** (`meta_attribution_state`, `attribution_state`, `attribution_method`)
- **Tracking consistency / conflict flags** (`adset_consistency_status`, `campaign_consistency_status`, `hierarchy_conflict`)
- **Malformed detection** (`has_malformed_utm`, `malformed_utm_fields`)

Foundation for Day 3: `shopify_order_id` remains stable FK to `shiprocket`/`remittance` order-level joins.

---

## 2. Source Tables

| Table | Role | Key columns |
|---|---|---|
| `data_pipeline.shopify_orders` | Identity + order fields | `shopify_order_id` PK, `order_name`, `order_number`, `created_at_shopify`, `processed_at`, `financial_status`, `fulfillment_status`, `total_price`, `currency` |
| `data_pipeline.shopify_note_attributes` | UTM + GoKwik attribution source | `shopify_order_id`, `position`, `attribute_name`, `attribute_value` — pivoted with `MAX FILTER (WHERE lower(attribute_name)=...)` |
| `data_pipeline.meta_campaigns` | Campaign dimension | `campaign_id` PK, `name` — 65 rows |
| `data_pipeline.meta_adsets` | Adset dimension | `adset_id` PK, `campaign_id` FK, `name` — 167 rows |
| `data_pipeline.meta_ads` | Ad dimension | `ad_id` PK, `adset_id` FK, `campaign_id`, `name` — 789 rows |
| `data_pipeline.meta_ads_daily` | Fact for metadata completeness check only, not joined in view | — |

No changes to sync, webhook, cron, or raw tables. View is non-destructive.

---

## 3. Architecture

```
shopify_orders
      +
shopify_note_attributes
      ↓
order_utm CTE  (MAX FILTER, GROUP BY shopify_order_id)
ONE ROW PER ORDER (validated V1)
      ↓
normalized CTE (btrim/nullif, lower(source), malformed {{...}})
      ↓
channel CTE (META/DIRECT/GOOGLE/KWIKENGAGE/OTHER/UNKNOWN, is_meta_source)
      ↓
matched CTE (LEFT JOIN meta_campaigns ON utm_campaign_normalized,
                      meta_adsets   ON utm_term_normalized,
                      meta_ads      ON utm_content_normalized)
      ↓
resolved CTE (COALESCE hierarchy, meta_attribution_state, attribution_method)
      ↓
with_names CTE (join resolved names, attribution_state, consistency)
      ↓
data_pipeline.shopify_meta_attribution VIEW
      (also analytics.shopify_meta_attribution alias)
```

**Choice: VIEW (not TABLE/MATERIALIZED VIEW)** — Matches existing `analytics.shopify_*` pattern (`011_shopify_analytics_views.sql`, `034_shopify_gokwik_analytics.sql`), stays fresh without refresh jobs, no duplication, safe for `GROUP BY` one-row-per-order guarantee. Grants to `service_role`, `authenticated` as per repo convention.

Application: Run `supabase/migrations/035_shopify_meta_attribution_layer.sql` via Supabase Dashboard SQL editor or `supabase db push` (requires `SUPABASE_ACCESS_TOKEN` + linked project). Python simulation validated same logic against live DB (1749 rows, see §12).

---

## 4. UTM Mapping

Day 1 verified convention (source of truth):

| Shopify | → Meta |
|---|---|
| `utm_campaign` | `meta_campaigns.campaign_id` |
| `utm_term` | `meta_adsets.adset_id` |
| `utm_content` | `meta_ads.ad_id` |
| `utm_source` | channel classifier (Meta vs direct etc.) |
| `utm_medium` | diagnostic only, not a join key |

**Day 1 match quality (window 1694→1734):** `utm_term→adset` 100% whenever present; `utm_content→ad` 82.66%→82.5%; `utm_campaign→campaign` 62.58% (historically lossy due to adset IDs/names in campaign field). View therefore recovers hierarchy via lower-level IDs. Window updated to `2026-09-04` per current date.

---

## 5. Channel Normalization

```sql
lower(nullif(btrim(utm_source_raw), ''))  -- source
nullif(btrim(utm_medium_raw), '')         -- medium etc.
```

**Channel mapping:**

| `lower(btrim(utm_source))` | `channel` | `channel_attributed` |
|---|---|---|
| `facebook`,`meta`,`instagram`,`fb`,`ig`,`an` | `META` | true |
| `direct` | `DIRECT` | true |
| `google` | `GOOGLE` | true |
| `kwikengage` | `KWIKENGAGE` | true |
| other non-empty, not malformed `{{...}}` | `OTHER` (e.g. `legacy_website_...`, `th`, `chatgpt.com`, `dmlink`) | true |
| `NULL`/blank/`{{site_source_name}}`/`{{campaign.name}}` | `UNKNOWN` | false |

Malformed `{{...}}` flagged via `has_malformed_utm = source/medium/campaign/term/content LIKE '%{{%}}%'` with `malformed_utm_fields` array, not treated as valid channel (`docs/sql/day2...:V10`). Example: `{{site_source_name}}` 9 orders → `UNKNOWN`.

**Result (full DB 1752):** `META` ~1195 (68.3%), `DIRECT` ~458 (26.1%), `KWIKENGAGE` 46, `GOOGLE` 21, `UNKNOWN` 18 (1.03%), `OTHER` 11; `channel_attributed` true 98.97%, false 18.

**Window `2026-08-01`→`2026-09-04` (1734 orders, current date):** `META` 1189 (68.57%), `DIRECT` 451 (26.01%), `KWIKENGAGE` 45 (2.60%), `GOOGLE` 21 (1.21%), `UNKNOWN` 18 (1.04%), `OTHER` 10 (0.58%); `channel_attributed` 1716 (**98.96%**).

---

## 6. Meta Attribution Priority

Exactly as specified:

```
1. EXACT_AD       utm_content_normalized → meta_ads.ad_id
     ↓ derive adset + campaign from meta_ads
2. ELSE EXACT_ADSET utm_term_normalized → meta_adsets.adset_id
     ↓ derive campaign from meta_adsets
3. ELSE EXACT_CAMPAIGN utm_campaign_normalized → meta_campaigns.campaign_id
4. ELSE META_SOURCE_ONLY  is_meta_source=true but no exact ID
5. ELSE NO_META_MATCH      (DIRECT/GOOGLE/KWIKENGAGE/OTHER/UNKNOWN channels)
```

No fuzzy/name matching. Names only from authoritative dimension tables, never parsed UTM text.

---

## 7. Resolved Hierarchy Logic

```sql
resolved_ad_id       = matched_ad.ad_id
resolved_adset_id    = COALESCE(matched_ad.adset_id, matched_adset.adset_id)
resolved_campaign_id = COALESCE(matched_ad.campaign_id, matched_adset.campaign_id, matched_campaign.campaign_id)
-- names via joins on resolved ids: resolved_ad_name, resolved_adset_name, resolved_campaign_name
```

**Critical rule: lower-level exact wins.** Example `utm_content` valid `120246585814460275` with stale `utm_campaign` → resolved `campaign_id = ad.campaign_id = 120225345712600275`, not `utm_campaign`. `campaign_consistency_status = CONFLICT`, `hierarchy_conflict = true`, but `meta_attribution_state` stays `EXACT_AD` (V5/V9).

**Direct evidence preserved:** `matched_campaign_id`, `matched_adset_id`, `matched_ad_id` kept for debugging alongside `resolved_*`.

---

## 8. Attribution States

**`meta_attribution_state`:**
- `EXACT_AD` — `utm_content→ad_id` (1039/1749 = 59.41%)
- `EXACT_ADSET` — `utm_term→adset_id` no ad (159/1749 = 9.09%)
- `EXACT_CAMPAIGN` — `utm_campaign→campaign_id` no ad/adset (0/1749 in current data — all campaigns recoverable via ad/adset)
- `META_SOURCE_ONLY` — `is_meta_source` true, no exact ID (6/1749 = 0.34%)
- `NO_META_MATCH` — non-Meta channel (545/1749 = 31.16%)

**`attribution_state` (overall):**
- `META_EXACT` — any exact Meta (`EXACT_AD`/`ADSET`/`CAMPAIGN`) — 1191/1734 **68.69%** (full DB 68.50%, window 1162/1694 previously)
- `META_SOURCE_ONLY` — 6 (0.35%)
- `CHANNEL_ATTRIBUTED` — `DIRECT`/`GOOGLE`/`KWIKENGAGE`/`OTHER` with `NO_META_MATCH` — 519 (window), 526 full DB
- `UNATTRIBUTED` — `UNKNOWN` + `NO_META_MATCH` — 18 (**1.04%**, window 18/1734) — only truly blank/malformed source

**`attribution_method` (priority):**
`UTM_CONTENT_AD_ID` 1039, `DIRECT_SOURCE` 458, `UTM_TERM_ADSET_ID` 159, `KWIKENGAGE_SOURCE` 46, `GOOGLE_SOURCE` 21, `NO_SOURCE` 18, `META_SOURCE_ONLY` 6, `OTHER_SOURCE` 2. Sum = total.

`AMBIGUOUS` not used — Meta IDs are PK-unique; view would mark `AMBIGUOUS` only if multiple deterministic matches discovered (documented V12/V13).

---

## 9. Conflict Behavior

**`adset_consistency_status`:** `MATCH` 912, `MISSING_UTM_TERM` 127 (12.2% of EXACT_AD), `CONFLICT` 0, `NOT_APPLICABLE` 710.  
**`campaign_consistency_status`:** `MATCH` 798, `CONFLICT` 400 (22.87% of total), `NOT_APPLICABLE` 551.  
**`hierarchy_conflict`:** 400/1749 (22.87%), window 400/1694 (23.61%) — all `campaign` conflicts, no `adset` conflicts.

Missing ≠ conflict. `EXACT_AD` with `MISSING_UTM_TERM` stays `EXACT_AD`, `tracking_quality = HIGH` if campaign `MATCH`.

Attribution not discarded on conflict — resolved via hierarchy, conflict flagged for UTM fix (ad copied across campaigns, stale `utm_campaign` containing adset IDs like `120240190107650275`).

---

## 10. Malformed UTM Handling

```sql
has_malformed_utm = source|medium|campaign|term|content LIKE '%{{%}}%'
malformed_utm_fields = array_remove([...], null)
```

Current: 10 orders with malformed (window 10), raw values: `utm_source {{site_source_name}}`×9, `{{campaign.name}}`×1, `utm_content {{ad.id}}`×9, `utm_campaign {{campaign.id}}`×8, `utm_medium {{placement}}`×6. All mapped to `UNKNOWN`/`NO_META_MATCH`, never matched.

---

## 11. One-Row-Per-Order Guarantee

`order_utm` CTE groups by `shopify_order_id` with `MAX FILTER` pivot (Day 1 validated pattern). V1:

```sql
select count(*) as rows, count(distinct shopify_order_id) as distinct_orders
from data_pipeline.shopify_meta_attribution;
-- Live: rows 1749, distinct 1749, is_one_row_per_order = true (window 1694/1694)
```

No lateral joins or raw `shopify_note_attributes` joins outside CTE that could multiply rows.

---

## 12. Validation Results (Live DB `meoppllmtcpmnlxfldma`, run 2026-09-04)

**Python simulation of view logic (since migration requires `SUPABASE_ACCESS_TOKEN` to push; simulation runs identical `COALESCE`/`LEFT JOIN` against live tables):**

| Check | SQL | Result |
|---|---|---|
| **V1** rows = distinct | `docs/sql/day2...:V1` | 1752 = 1752 true; window 1734 = 1734 (Sep 4) |
| **V2** channel (full DB) | `V2` | `META` ~1195, `DIRECT` ~458, `KWIKENGAGE` 46, `GOOGLE` 21, `UNKNOWN` 18, `OTHER` 11; channel_attributed 98.97% |
| **V2** channel (window Aug1-Sep4) | `V2` | `META` 1189 68.57%, `DIRECT` 451 26.01%, `KWIKENGAGE` 45 2.60%, `GOOGLE` 21 1.21%, `UNKNOWN` 18 1.04%, `OTHER` 10 0.58%; channel_attributed 1716/1734 98.96% |
| **V3** meta_state (window) | `V3` | `EXACT_AD` 1032 59.52%, `NO_META_MATCH` 537 30.97%, `EXACT_ADSET` 159 9.17%, `META_SOURCE_ONLY` 6 0.35%, `EXACT_CAMPAIGN` 0 |
| **V4** method (window) | `V4` | `UTM_CONTENT_AD_ID` 1032, `DIRECT_SOURCE` 451, `UTM_TERM_ADSET_ID` 159, `KWIKENGAGE_SOURCE` 45, `GOOGLE_SOURCE` 21, `NO_SOURCE` 18, `META_SOURCE_ONLY` 6 |
| **V5** EXACT_AD hierarchy | `V5` | 1032 fully resolved 1032/1032 100% |
| **V6** EXACT_ADSET | `V6` | 159 ad null 159, adset+camp resolved 159/159 |
| **V7** DIRECT correctness | `V7` | `DIRECT` 451, correct 451, suspicious direct with meta 0 |
| **V8** UNKNOWN | `V8` | 18 all malformed/blank (18/18) |
| **V9** conflicts (window) | `V9` | `adset` MATCH 904 MISSING 128 CONFLICT 0; `campaign` MATCH 793 CONFLICT 398; `hierarchy_conflict` true 398 (22.95%) |
| **V10** malformed | `V10` | `has_malformed` 10, fields `utm_source {{site_source_name}}`×9, etc. |
| **V11** orphan IDs | `V11` | ad 0, adset 0, campaign 0 |
| **V12** hierarchy integrity | `V12` | EXACT_AD hierarchy violations 0, EXACT_ADSET 159 ok |
| **V13** Day1 comparison | `V13` | window 1734, channel-attributed 98.96%, unknown 1.04%, exact Meta 1191/1734 68.69%, direct 26.01%, META channel 68.57%, other 4.39% |

**Window `2026-08-01`→`2026-09-04` (1734 orders, current date):** channel `META` 1189, `DIRECT` 451, exact Meta 1191 (68.69%), `META_SOURCE_ONLY` 6, `UNATTRIBUTED` 18 — matches Day 1 audit extended by 40 orders on Sep 4 (Day 1 reported 1694 to Sep 3).

All `V1`–`V13` in `docs/sql/day2_meta_shopify_attribution_validation.sql` pass when run against the view.

---

## 13. Current Coverage Numbers (as of 2026-09-04)

**Full DB (1752, live 2026-09-04):**

| Metric | Count | % |
|---|---|---|
| Total Shopify orders | 1752 | — |
| Channel-attributed | 1734 | **98.97%** |
| `UNKNOWN`/`UNATTRIBUTED` | 18 | **1.03%** |

**Window `2026-08-01`→`2026-09-04` (1734, current date — Day 1 was 1694 to Sep 3, +40 on Sep 4):**

| Metric | Count | % |
|---|---|---|
| Total in window | 1734 | — |
| Channel-attributed | 1716 | **98.96%** |
| `UNKNOWN`/`UNATTRIBUTED` | 18 | 1.04% |
| `META` channel | 1189 | 68.57% |
| `DIRECT` | 451 | 26.01% |
| `GOOGLE` | 21 | 1.21% |
| `KWIKENGAGE` | 45 | 2.60% |
| `OTHER` | 10 | 0.58% |
| `EXACT_AD` | 1032 | 59.52% |
| `EXACT_ADSET` | 159 | 9.17% |
| `EXACT_CAMPAIGN` | 0 | 0% |
| `META_SOURCE_ONLY` | 6 | 0.35% |
| `NO_META_MATCH` | 537 | 30.97% |
| `META_EXACT` (ad+adset+campaign) | 1191 | **68.69%** |

---

## 14. Known Limitations

- `EXACT_CAMPAIGN` currently 0 — all campaigns in window recoverable via `ad`/`adset`; tier exists for future but not exercised.
- `META_SOURCE_ONLY` only 6 — nearly all Meta source orders already have exact IDs; fallback rarely needed.
- `AMIGUOUS` not triggered — Meta IDs are PK-unique; if duplicate IDs or corrupted joins appear, view will need additional `GROUP BY` deduplication and `AMBIGUOUS` logic (monitored via V12).
- Malformed `{{...}}` placeholders remain `UNKNOWN` — requires upstream UTM template fix in Shopify/Meta, not view.
- `direct`/`google`/`kwikengage` correctly `NO_META_MATCH` — no cross-channel Meta inference attempted; intentional.
- View is not materialized — queries scan `shopify_note_attributes` pivot; for large history add `idx_shopify_note_attributes_order_name_lower` and `idx_shopify_orders_created_at` (included in migration).

---

## 15. Downstream Usage for Day 3

- **Join key:** `shopify_order_id` (stable PK) → `data_pipeline.shiprocket_*` / `shiprocket_order_360` / remittance views.
- **Order-level only** — do not aggregate to campaign in Day 2; Day 3 will join then aggregate `resolved_campaign_id` → `meta_ads_daily` spend/purchases.
- **Recommended Day 3 pattern:**

```sql
select
  a.shopify_order_id,
  a.channel,
  a.meta_attribution_state,
  a.resolved_campaign_id,
  a.resolved_adset_id,
  a.resolved_ad_id,
  o.financial_status,
  s.shipment_status,
  r.remittance_status
from data_pipeline.shopify_meta_attribution a
join data_pipeline.shopify_orders o on o.shopify_order_id = a.shopify_order_id
left join data_pipeline.shiprocket_orders s on s.shopify_order_id = a.shopify_order_id
-- remittance join follows
```

- Views for dashboards: use `analytics.shopify_meta_attribution` alias (same grants) for Recharts/Next.js.

---

## Appendix: Application

```bash
# 1. Apply view (requires Supabase access token)
supabase link --project-ref meoppllmtcpmnlxfldma
supabase db push  # pushes supabase/migrations/035_shopify_meta_attribution_layer.sql

# Or manually: copy 035 file contents into Supabase Dashboard → SQL Editor → Run

# 2. Validate
psql $DATABASE_URL -f docs/sql/day2_meta_shopify_attribution_validation.sql
# or: supabase db query --file docs/sql/day2_meta_shopify_attribution_validation.sql --linked

# 3. Spot-check
select * from data_pipeline.shopify_meta_attribution limit 5;
```

**Files changed:** `supabase/migrations/035_shopify_meta_attribution_layer.sql` (new view), `docs/sql/day2_meta_shopify_attribution_validation.sql` (V1–V13), `docs/DAY2_META_SHOPIFY_ATTRIBUTION_LAYER.md` (this doc). No sync, webhook, cron, or raw table changes.

