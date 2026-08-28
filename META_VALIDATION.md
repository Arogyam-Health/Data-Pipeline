# Meta Sheet vs Supabase validation

Compare the live Google Sheet tab **Meta Report** with `analytics.meta_ads_sheet_parity`.

Do not edit the Sheet. Do not pause Apps Script.

---

## 1. Unique key

Sheet:

```
Campaign ID + Ad set ID + Ad ID + Date
```

Supabase:

```
campaign_id + ad_set_id + ad_id + date
```

(plus `ad_account_id` in the canonical table)

---

## 2. Fields to compare for a controlled date

| Sheet | `analytics.meta_ads_sheet_parity` |
|---|---|
| Campaign name | `campaign_name` |
| Ad set name | `ad_set_name` |
| Ad name | `ad_name` |
| Campaign ID | `campaign_id` |
| Ad set ID | `ad_set_id` |
| Ad ID | `ad_id` |
| Date | `date` |
| Objective | `objective` |
| Instant Experience view percentage | `instant_experience_view_percentage` |
| LPV rate | `lpv_rate` |
| CPM | `cpm` |
| CTR (all) | `ctr_all` |
| Frequency | `frequency` |
| Impressions | `impressions` |
| Reach | `reach` |
| Amount spent | `amount_spent` |
| Adds to cart | `adds_to_cart` |
| CPC (cost per link click) | `cpc_link_click` |
| CTR (link click-through rate) | `ctr_link_click` |
| Checkouts initiated | `checkouts_initiated` |
| Checkouts initiated conversion value | `checkouts_initiated_value` |
| Cost per purchase | `cost_per_purchase` |
| Landing page views | `landing_page_views` |
| Link clicks | `link_clicks` |
| Messaging conversations started | `messaging_conversations_started` |
| Purchase ROAS | `purchase_roas` |
| Purchases | `purchases` |
| Purchases conversion value | `purchases_conversion_value` |
| Registrations completed | `registrations_completed` |
| Video average play time | `video_avg_play_time` |
| Video plays at 25% | `video_plays_25` |
| Video plays at 95% | `video_plays_95` |
| Website purchase ROAS | `website_purchase_roas` |
| Website purchases | `website_purchases` |

Derived Sheet helpers:

- Month / Week → from `date`
- Impressions (int) → `impressions_int`
- Campaign Type → `Unclassified` (no current rule)

---

## 3. Acceptance

1. Same logical row count for the date.
2. Same IDs and dates.
3. Same source metrics (spend, impressions, reach, clicks, actions).
4. Derived LPV rate and CPA equal within ordinary decimal rounding.

If the two systems queried Meta at different times, attribution can differ on recent dates. Re-run both close together before treating a mismatch as a bug.

---

## 4. Parallel process (do not skip)

1. Schema/code deployed. `META_SYNC_ENABLED=false`.
2. Configure the existing token/account privately.
3. One-day test:

```bash
curl -X POST http://localhost:3000/api/internal/meta/sync/test \
  -H "Authorization: Bearer <META_INTERNAL_SYNC_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}'
```

4. Compare that date in the Sheet vs:

```sql
select *
from analytics.meta_ads_sheet_parity
where date = 'YYYY-MM-DD'
order by campaign_id, ad_set_id, ad_id;
```

5. Three-day recent repair:

```bash
curl -X POST http://localhost:3000/api/internal/meta/sync/recent \
  -H "Authorization: Bearer <META_INTERNAL_SYNC_SECRET>"
```

6. Compare again.
7. 90-day backfill (only if Apps Script is **not** also backfilling):

```bash
curl -X POST http://localhost:3000/api/internal/meta/sync/backfill \
  -H "Authorization: Bearer <META_INTERNAL_SYNC_SECRET>"

curl -X POST http://localhost:3000/api/internal/meta/sync/backfill/resume \
  -H "Authorization: Bearer <META_INTERNAL_SYNC_SECRET>"
```

8. Run Apps Script + this pipeline in parallel (`META_SYNC_ENABLED=true`).
9. Monitor several days.
10. Sheet retirement **only after explicit human approval**. Not in this task.

---

## 5. Known differences

1. This pipeline also stores every action type, not only Sheet columns.
2. Optional extended Insights / metadata / breakdowns are off by default.
3. Backfill upserts; it does not clear the table the way the Apps Script 90-day job clears the tab.
4. Currency is account currency, not hardcoded rupee formatting.
5. Campaign Type is Unclassified until a business rule exists.
