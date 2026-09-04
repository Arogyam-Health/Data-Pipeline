-- docs/sql/day1_meta_shopify_attribution_validation.sql
-- Day 1 — Meta → Shopify Attribution Validation
-- Window: 2026-08-01 to 2026-09-03 inclusive (Asia/Kolkata reporting, stored as UTC)
-- Source: data_pipeline.shopify_orders.created_at_shopify
-- One row per Shopify order CTE reused throughout
-- IMPORTANT: Do not hardcode coverage numbers — recalculate from DB.

-- ============================================================
-- 0. Schema inspection helper (run once)
-- ============================================================
-- Verify columns exist before running audit
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='data_pipeline' AND table_name='shopify_orders' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='data_pipeline' AND table_name='shopify_note_attributes' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='data_pipeline' AND table_name='meta_campaigns' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='data_pipeline' AND table_name='meta_adsets' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='data_pipeline' AND table_name='meta_ads' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='data_pipeline' AND table_name='meta_ads_daily' ORDER BY ordinal_position;

-- ============================================================
-- Reusable CTE: order_tracking (ONE ROW PER SHOPIFY ORDER)
-- ============================================================
-- Use this CTE as base for all Q1..Q10. Filter on created_at_shopify.
-- Adjust date bounds if you need a different window.

-- Example:
-- WITH order_tracking AS (
--     SELECT
--         o.shopify_order_id,
--         o.created_at_shopify,
--         MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_source')  AS utm_source,
--         MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_medium')  AS utm_medium,
--         MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign,
--         MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term')     AS utm_term,
--         MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content')  AS utm_content
--     FROM data_pipeline.shopify_orders o
--     LEFT JOIN data_pipeline.shopify_note_attributes na
--         ON na.shopify_order_id = o.shopify_order_id
--     WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
--       AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
--     GROUP BY o.shopify_order_id, o.created_at_shopify
-- )

-- ============================================================
-- Q1 — Raw UTM Coverage
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_source')  AS utm_source,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_medium')  AS utm_medium,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term')     AS utm_term,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content')  AS utm_content
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na
        ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
)
SELECT
    COUNT(*) AS total_shopify_orders,
    COUNT(*) FILTER (WHERE utm_source  IS NOT NULL AND btrim(utm_source)  <> '') AS orders_with_utm_source,
    COUNT(*) FILTER (WHERE utm_medium  IS NOT NULL AND btrim(utm_medium)  <> '') AS orders_with_utm_medium,
    COUNT(*) FILTER (WHERE utm_campaign IS NOT NULL AND btrim(utm_campaign) <> '') AS orders_with_utm_campaign,
    COUNT(*) FILTER (WHERE utm_term    IS NOT NULL AND btrim(utm_term)    <> '') AS orders_with_utm_term,
    COUNT(*) FILTER (WHERE utm_content IS NOT NULL AND btrim(utm_content) <> '') AS orders_with_utm_content,
    ROUND(100.0 * COUNT(*) FILTER (WHERE utm_source  IS NOT NULL AND btrim(utm_source)  <> '') / NULLIF(COUNT(*),0), 2) AS utm_source_coverage_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE utm_medium  IS NOT NULL AND btrim(utm_medium)  <> '') / NULLIF(COUNT(*),0), 2) AS utm_medium_coverage_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE utm_campaign IS NOT NULL AND btrim(utm_campaign) <> '') / NULLIF(COUNT(*),0), 2) AS utm_campaign_coverage_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE utm_term    IS NOT NULL AND btrim(utm_term)    <> '') / NULLIF(COUNT(*),0), 2) AS utm_term_coverage_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE utm_content IS NOT NULL AND btrim(utm_content) <> '') / NULLIF(COUNT(*),0), 2) AS utm_content_coverage_pct,
    COUNT(*) FILTER (WHERE lower(btrim(utm_source)) IN ('facebook','meta','instagram')) AS orders_where_utm_source_looks_meta_strict,
    ROUND(100.0 * COUNT(*) FILTER (WHERE lower(btrim(utm_source)) IN ('facebook','meta','instagram')) / NULLIF(COUNT(*),0), 2) AS meta_source_strict_pct,
    -- Broad (fb/ig/an) shown for context — ig=instagram, fb=facebook, an=audience network (all Meta)
    COUNT(*) FILTER (WHERE lower(btrim(utm_source)) IN ('facebook','meta','instagram','fb','ig','an')) AS orders_where_utm_source_looks_meta_broad,
    ROUND(100.0 * COUNT(*) FILTER (WHERE lower(btrim(utm_source)) IN ('facebook','meta','instagram','fb','ig','an')) / NULLIF(COUNT(*),0), 2) AS meta_source_broad_pct
FROM order_tracking;

-- ============================================================
-- Q2 — Direct Exact ID Matches
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_source')  AS utm_source,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term')     AS utm_term,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content')  AS utm_content
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
)
SELECT
    COUNT(*) AS total_orders,
    COUNT(*) FILTER (WHERE btrim(utm_campaign) <> '' AND utm_campaign IS NOT NULL) AS orders_with_utm_campaign,
    COUNT(*) FILTER (WHERE btrim(utm_term) <> '' AND utm_term IS NOT NULL) AS orders_with_utm_term,
    COUNT(*) FILTER (WHERE btrim(utm_content) <> '' AND utm_content IS NOT NULL) AS orders_with_utm_content,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_campaigns c WHERE c.campaign_id = btrim(utm_campaign))) AS direct_campaign_matches,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_adsets a WHERE a.adset_id = btrim(utm_term))) AS direct_adset_matches,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_ads ad WHERE ad.ad_id = btrim(utm_content))) AS direct_ad_matches,
    ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_campaigns c WHERE c.campaign_id = btrim(utm_campaign))) / NULLIF(COUNT(*),0),2) AS direct_campaign_pct_of_all,
    ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_campaigns c WHERE c.campaign_id = btrim(utm_campaign))) / NULLIF(COUNT(*) FILTER (WHERE btrim(utm_campaign) <> '' AND utm_campaign IS NOT NULL),0),2) AS direct_campaign_pct_of_with_campaign,
    ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_adsets a WHERE a.adset_id = btrim(utm_term))) / NULLIF(COUNT(*),0),2) AS direct_adset_pct_of_all,
    ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_adsets a WHERE a.adset_id = btrim(utm_term))) / NULLIF(COUNT(*) FILTER (WHERE btrim(utm_term) <> '' AND utm_term IS NOT NULL),0),2) AS direct_adset_pct_of_with_term,
    ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_ads ad WHERE ad.ad_id = btrim(utm_content))) / NULLIF(COUNT(*),0),2) AS direct_ad_pct_of_all,
    ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_ads ad WHERE ad.ad_id = btrim(utm_content))) / NULLIF(COUNT(*) FILTER (WHERE btrim(utm_content) <> '' AND utm_content IS NOT NULL),0),2) AS direct_ad_pct_of_with_content
FROM order_tracking;

-- ============================================================
-- Q3 — Hierarchy Consistency (one row per exact ad match)
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term')     AS utm_term,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content')  AS utm_content
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
)
SELECT
    t.shopify_order_id,
    btrim(t.utm_campaign) AS utm_campaign,
    btrim(t.utm_term)     AS utm_term,
    btrim(t.utm_content)  AS utm_content,
    ad.ad_id,
    ad.adset_id AS meta_adset_id,
    ad.campaign_id AS meta_campaign_id,
    ads.name AS adset_name,
    c.name AS campaign_name,
    ad.name AS ad_name,
    (btrim(t.utm_content) = ad.ad_id) AS ad_matches,
    CASE
        WHEN t.utm_term IS NULL OR btrim(t.utm_term) = '' THEN 'MISSING_UTM_TERM'
        WHEN btrim(t.utm_term) = ad.adset_id THEN 'MATCH'
        ELSE 'CONFLICT'
    END AS adset_consistency_status,
    CASE
        WHEN t.utm_campaign IS NULL OR btrim(t.utm_campaign) = '' THEN 'MISSING_UTM_CAMPAIGN'
        WHEN btrim(t.utm_campaign) = ad.campaign_id THEN 'MATCH'
        ELSE 'CONFLICT'
    END AS campaign_consistency_status
FROM order_tracking t
JOIN data_pipeline.meta_ads ad
    ON btrim(t.utm_content) = ad.ad_id
LEFT JOIN data_pipeline.meta_adsets ads
    ON ad.adset_id = ads.adset_id
LEFT JOIN data_pipeline.meta_campaigns c
    ON ad.campaign_id = c.campaign_id
ORDER BY t.shopify_order_id;

-- ============================================================
-- Q4 — Hierarchy Consistency Percentages (aggregate)
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term')     AS utm_term,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content')  AS utm_content
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
),
ad_matches AS (
    SELECT t.*, ad.adset_id AS meta_adset_id, ad.campaign_id AS meta_campaign_id
    FROM order_tracking t
    JOIN data_pipeline.meta_ads ad ON btrim(t.utm_content) = ad.ad_id
)
SELECT
    COUNT(*) AS total_exact_ad_matches,
    COUNT(*) FILTER (WHERE btrim(utm_term) = meta_adset_id) AS adset_matches_ad_hierarchy,
    COUNT(*) FILTER (WHERE utm_term IS NULL OR btrim(utm_term)='') AS adset_missing,
    COUNT(*) FILTER (WHERE utm_term IS NOT NULL AND btrim(utm_term)<>'' AND btrim(utm_term) <> meta_adset_id) AS adset_conflicts,
    COUNT(*) FILTER (WHERE btrim(utm_campaign) = meta_campaign_id) AS campaign_matches_ad_hierarchy,
    COUNT(*) FILTER (WHERE utm_campaign IS NULL OR btrim(utm_campaign)='') AS campaign_missing,
    COUNT(*) FILTER (WHERE utm_campaign IS NOT NULL AND btrim(utm_campaign)<>'' AND btrim(utm_campaign) <> meta_campaign_id) AS campaign_conflicts,
    ROUND(100.0*COUNT(*) FILTER (WHERE btrim(utm_term)=meta_adset_id)/NULLIF(COUNT(*),0),2) AS adset_match_pct,
    ROUND(100.0*COUNT(*) FILTER (WHERE btrim(utm_campaign)=meta_campaign_id)/NULLIF(COUNT(*),0),2) AS campaign_match_pct
FROM ad_matches;

-- ============================================================
-- Q5 — Recoverable Campaign Attribution (priority: ad > adset > campaign)
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term')     AS utm_term,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content')  AS utm_content
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
)
SELECT
    COUNT(*) AS total_orders,
    COUNT(*) FILTER (WHERE ad.ad_id IS NOT NULL) AS exact_ad_orders,
    COUNT(*) FILTER (WHERE ad.ad_id IS NULL AND ads.adset_id IS NOT NULL) AS exact_adset_only_orders,
    COUNT(*) FILTER (WHERE ad.ad_id IS NULL AND ads.adset_id IS NULL AND c.campaign_id IS NOT NULL) AS exact_campaign_only_orders,
    COUNT(*) FILTER (WHERE COALESCE(ad.campaign_id, ads.campaign_id, c.campaign_id) IS NOT NULL) AS recoverable_exact_campaign_orders,
    ROUND(100.0*COUNT(*) FILTER (WHERE COALESCE(ad.campaign_id, ads.campaign_id, c.campaign_id) IS NOT NULL)/NULLIF(COUNT(*),0),2) AS recoverable_campaign_pct,
    COUNT(*) FILTER (WHERE COALESCE(ad.adset_id, ads.adset_id) IS NOT NULL) AS recoverable_exact_adset_orders,
    ROUND(100.0*COUNT(*) FILTER (WHERE COALESCE(ad.adset_id, ads.adset_id) IS NOT NULL)/NULLIF(COUNT(*),0),2) AS recoverable_adset_pct,
    ROUND(100.0*COUNT(*) FILTER (WHERE ad.ad_id IS NOT NULL)/NULLIF(COUNT(*),0),2) AS exact_ad_pct
FROM order_tracking t
LEFT JOIN data_pipeline.meta_ads ad ON btrim(t.utm_content) = ad.ad_id
LEFT JOIN data_pipeline.meta_adsets ads ON btrim(t.utm_term) = ads.adset_id
LEFT JOIN data_pipeline.meta_campaigns c ON btrim(t.utm_campaign) = c.campaign_id;

-- ============================================================
-- Q6 — Mutually Exclusive Attribution Tiers (CONFLICT > EXACT_AD > EXACT_ADSET > EXACT_CAMPAIGN > META_SOURCE_ONLY > UNATTRIBUTED)
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_source')  AS utm_source,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term')     AS utm_term,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content')  AS utm_content
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
),
resolved AS (
    SELECT
        t.shopify_order_id,
        t.utm_source, t.utm_campaign, t.utm_term, t.utm_content,
        ad.ad_id AS matched_ad_id, ad.adset_id AS matched_ad_adset_id, ad.campaign_id AS matched_ad_campaign_id,
        ads.adset_id AS matched_adset_id, ads.campaign_id AS matched_adset_campaign_id,
        c.campaign_id AS matched_campaign_id
    FROM order_tracking t
    LEFT JOIN data_pipeline.meta_ads ad ON btrim(t.utm_content) = ad.ad_id
    LEFT JOIN data_pipeline.meta_adsets ads ON btrim(t.utm_term) = ads.adset_id
    LEFT JOIN data_pipeline.meta_campaigns c ON btrim(t.utm_campaign) = c.campaign_id
),
flagged AS (
    SELECT *,
        -- hierarchy conflict flags
        CASE WHEN matched_ad_id IS NOT NULL AND btrim(utm_term) IS NOT NULL AND btrim(utm_term) <> '' AND btrim(utm_term) <> matched_ad_adset_id THEN true ELSE false END AS ad_adset_conflict,
        CASE WHEN matched_ad_id IS NOT NULL AND btrim(utm_campaign) IS NOT NULL AND btrim(utm_campaign) <> '' AND btrim(utm_campaign) <> matched_ad_campaign_id THEN true ELSE false END AS ad_campaign_conflict,
        CASE WHEN matched_ad_id IS NULL AND matched_adset_id IS NOT NULL AND btrim(utm_campaign) IS NOT NULL AND btrim(utm_campaign) <> '' AND btrim(utm_campaign) <> matched_adset_campaign_id THEN true ELSE false END AS adset_campaign_conflict
    FROM resolved
),
tiered AS (
    SELECT *,
        CASE
            WHEN (matched_ad_id IS NOT NULL AND (ad_adset_conflict OR ad_campaign_conflict))
              OR (matched_ad_id IS NULL AND matched_adset_id IS NOT NULL AND adset_campaign_conflict)
            THEN 'CONFLICT'
            WHEN matched_ad_id IS NOT NULL THEN 'EXACT_AD'
            WHEN matched_adset_id IS NOT NULL THEN 'EXACT_ADSET'
            WHEN matched_campaign_id IS NOT NULL THEN 'EXACT_CAMPAIGN'
            WHEN lower(btrim(utm_source)) IN ('facebook','meta','instagram') THEN 'META_SOURCE_ONLY'
            ELSE 'UNATTRIBUTED'
        END AS attribution_tier
    FROM flagged
)
SELECT attribution_tier, COUNT(*) AS orders, ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (),2) AS pct
FROM tiered
GROUP BY attribution_tier
ORDER BY CASE attribution_tier WHEN 'CONFLICT' THEN 1 WHEN 'EXACT_AD' THEN 2 WHEN 'EXACT_ADSET' THEN 3 WHEN 'EXACT_CAMPAIGN' THEN 4 WHEN 'META_SOURCE_ONLY' THEN 5 WHEN 'UNATTRIBUTED' THEN 6 ELSE 7 END;

-- Validate tiers sum to total:
-- SELECT COUNT(*) FROM order_tracking; -- should equal SUM(orders) from previous

-- ============================================================
-- Q7 — Unmatched utm_campaign (grouped)
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
)
SELECT
    btrim(utm_campaign) AS utm_campaign,
    COUNT(*) AS order_count,
    CASE
        WHEN btrim(utm_campaign) ~ '^\d{10,}$' THEN 'NUMERIC_ID_LIKE'
        WHEN btrim(utm_campaign) ILIKE '\{\{campaign%' THEN 'MALFORMED'
        WHEN btrim(utm_campaign) IS NULL OR btrim(utm_campaign)='' THEN 'EMPTY'
        WHEN btrim(utm_campaign) ~ '[A-Za-z]' THEN 'NAME_OR_TEXT'
        ELSE 'OTHER'
    END AS pattern_type,
    MIN(o.created_at_shopify) AS first_seen,
    MAX(o.created_at_shopify) AS last_seen
FROM order_tracking t
JOIN data_pipeline.shopify_orders o ON o.shopify_order_id = t.shopify_order_id
WHERE utm_campaign IS NOT NULL AND btrim(utm_campaign) <> ''
  AND NOT EXISTS (SELECT 1 FROM data_pipeline.meta_campaigns c WHERE c.campaign_id = btrim(utm_campaign))
GROUP BY btrim(utm_campaign)
ORDER BY order_count DESC;

-- For numeric unmatched, check if they exist indirectly:
-- SELECT DISTINCT ad.campaign_id FROM data_pipeline.meta_ads ad WHERE ad.campaign_id IN (SELECT btrim(utm_campaign) FROM ... unmatched);
-- SELECT DISTINCT ads.campaign_id FROM data_pipeline.meta_adsets ads WHERE ads.campaign_id IN (...);
-- SELECT DISTINCT d.campaign_id FROM data_pipeline.meta_ads_daily d WHERE d.campaign_id IN (...);

-- ============================================================
-- Q8 — Unmatched utm_term (grouped)
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term') AS utm_term
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
)
SELECT
    btrim(utm_term) AS utm_term,
    COUNT(*) AS order_count,
    CASE
        WHEN btrim(utm_term) ~ '^\d{10,}$' THEN 'NUMERIC_ID_LIKE'
        WHEN btrim(utm_term) ILIKE '\{\{%' THEN 'MALFORMED'
        WHEN btrim(utm_term) IS NULL OR btrim(utm_term)='' THEN 'EMPTY'
        WHEN btrim(utm_term) ~ '[A-Za-z]' THEN 'NAME_OR_TEXT'
        ELSE 'OTHER'
    END AS pattern_type
FROM order_tracking
WHERE utm_term IS NOT NULL AND btrim(utm_term) <> ''
  AND NOT EXISTS (SELECT 1 FROM data_pipeline.meta_adsets a WHERE a.adset_id = btrim(utm_term))
GROUP BY btrim(utm_term)
ORDER BY order_count DESC;

-- Check indirect existence via meta_ads.adset_id:
-- SELECT DISTINCT ad.adset_id FROM data_pipeline.meta_ads ad WHERE ad.adset_id IN (SELECT btrim(utm_term) FROM ...);

-- ============================================================
-- Q9 — Unmatched utm_content (grouped) + check in facts
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content') AS utm_content
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
)
SELECT
    btrim(utm_content) AS utm_content,
    COUNT(*) AS order_count,
    CASE
        WHEN btrim(utm_content) ~ '^\d{10,}$' THEN 'NUMERIC_ID_LIKE'
        WHEN btrim(utm_content) ILIKE '\{\{ad%' THEN 'MALFORMED'
        WHEN btrim(utm_content) IS NULL OR btrim(utm_content)='' THEN 'EMPTY'
        WHEN btrim(utm_content) ~ '[A-Za-z]' THEN 'NAME_OR_TEXT'
        ELSE 'OTHER'
    END AS pattern_type
FROM order_tracking
WHERE utm_content IS NOT NULL AND btrim(utm_content) <> ''
  AND NOT EXISTS (SELECT 1 FROM data_pipeline.meta_ads ad WHERE ad.ad_id = btrim(utm_content))
GROUP BY btrim(utm_content)
ORDER BY order_count DESC;

-- For numeric values, check existence in facts table:
-- SELECT DISTINCT d.ad_id FROM data_pipeline.meta_ads_daily d WHERE d.ad_id = btrim(utm_content);
-- If found → META_FACT_ID_FOUND_METADATA_MISSING (real ad ID, missing dimension row)

-- ============================================================
-- Q10 — Meta Metadata Completeness (facts vs dimensions)
-- ============================================================
SELECT 'campaign' AS entity,
    (SELECT COUNT(DISTINCT campaign_id) FROM data_pipeline.meta_ads_daily) AS distinct_in_facts,
    (SELECT COUNT(*) FROM data_pipeline.meta_campaigns) AS distinct_in_metadata,
    (SELECT COUNT(DISTINCT campaign_id) FROM data_pipeline.meta_ads_daily WHERE campaign_id NOT IN (SELECT campaign_id FROM data_pipeline.meta_campaigns)) AS missing_in_metadata
UNION ALL
SELECT 'adset',
    (SELECT COUNT(DISTINCT adset_id) FROM data_pipeline.meta_ads_daily),
    (SELECT COUNT(*) FROM data_pipeline.meta_adsets),
    (SELECT COUNT(DISTINCT adset_id) FROM data_pipeline.meta_ads_daily WHERE adset_id NOT IN (SELECT adset_id FROM data_pipeline.meta_adsets))
UNION ALL
SELECT 'ad',
    (SELECT COUNT(DISTINCT ad_id) FROM data_pipeline.meta_ads_daily),
    (SELECT COUNT(*) FROM data_pipeline.meta_ads),
    (SELECT COUNT(DISTINCT ad_id) FROM data_pipeline.meta_ads_daily WHERE ad_id NOT IN (SELECT ad_id FROM data_pipeline.meta_ads));

-- Detail: which IDs are missing (if any)
-- SELECT DISTINCT campaign_id FROM data_pipeline.meta_ads_daily WHERE campaign_id NOT IN (SELECT campaign_id FROM data_pipeline.meta_campaigns);
-- SELECT DISTINCT adset_id FROM data_pipeline.meta_ads_daily WHERE adset_id NOT IN (SELECT adset_id FROM data_pipeline.meta_adsets);
-- SELECT DISTINCT ad_id FROM data_pipeline.meta_ads_daily WHERE ad_id NOT IN (SELECT ad_id FROM data_pipeline.meta_ads);

-- ============================================================
-- Q11 — Attribution Quality Over Time (weekly)
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        o.created_at_shopify,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term')     AS utm_term,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content')  AS utm_content,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_source')   AS utm_source
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id, o.created_at_shopify
)
SELECT
    date_trunc('week', created_at_shopify)::date AS week_start,
    COUNT(*) AS total_orders,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_ads ad WHERE ad.ad_id = btrim(utm_content))) AS exact_ad,
    ROUND(100.0*COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_ads ad WHERE ad.ad_id = btrim(utm_content)))/NULLIF(COUNT(*),0),2) AS exact_ad_pct,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_adsets a WHERE a.adset_id = btrim(utm_term))) AS exact_adset,
    ROUND(100.0*COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_adsets a WHERE a.adset_id = btrim(utm_term)))/NULLIF(COUNT(*),0),2) AS exact_adset_pct,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_campaigns c WHERE c.campaign_id = btrim(utm_campaign))) AS exact_campaign,
    ROUND(100.0*COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM data_pipeline.meta_campaigns c WHERE c.campaign_id = btrim(utm_campaign)))/NULLIF(COUNT(*),0),2) AS exact_campaign_pct,
    COUNT(*) FILTER (WHERE lower(btrim(utm_source)) IN ('facebook','meta','instagram')) AS meta_source_only_strict,
    COUNT(*) FILTER (WHERE utm_source IS NULL OR btrim(utm_source)='') AS unattributed_source_missing
FROM order_tracking
GROUP BY date_trunc('week', created_at_shopify)
ORDER BY week_start;

-- Also daily granularity if needed: replace date_trunc('week', ...) with created_at_shopify::date

-- ============================================================
-- Q12 — utm_source distribution
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_source') AS utm_source
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
)
SELECT lower(btrim(utm_source)) AS utm_source_norm, btrim(utm_source) AS utm_source_raw, COUNT(*) AS order_count, ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (),2) AS pct
FROM order_tracking
WHERE utm_source IS NOT NULL AND btrim(utm_source) <> ''
GROUP BY lower(btrim(utm_source)), btrim(utm_source)
ORDER BY order_count DESC;

-- ============================================================
-- Q13 — Final Day 1 Summary (single row)
-- ============================================================
WITH order_tracking AS (
    SELECT
        o.shopify_order_id,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_source')  AS utm_source,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_campaign') AS utm_campaign,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_term')     AS utm_term,
        MAX(na.attribute_value) FILTER (WHERE lower(na.attribute_name) = 'utm_content')  AS utm_content
    FROM data_pipeline.shopify_orders o
    LEFT JOIN data_pipeline.shopify_note_attributes na ON na.shopify_order_id = o.shopify_order_id
    WHERE o.created_at_shopify >= '2026-08-01'::timestamptz
      AND o.created_at_shopify <= '2026-09-03 23:59:59+00'::timestamptz
    GROUP BY o.shopify_order_id
),
matched AS (
    SELECT
        t.*,
        (EXISTS (SELECT 1 FROM data_pipeline.meta_campaigns c WHERE c.campaign_id = btrim(t.utm_campaign))) AS has_campaign_match,
        (EXISTS (SELECT 1 FROM data_pipeline.meta_adsets a WHERE a.adset_id = btrim(t.utm_term))) AS has_adset_match,
        (EXISTS (SELECT 1 FROM data_pipeline.meta_ads ad WHERE ad.ad_id = btrim(t.utm_content))) AS has_ad_match,
        ad.adset_id AS ad_adset_id, ad.campaign_id AS ad_campaign_id,
        ads.campaign_id AS adset_campaign_id
    FROM order_tracking t
    LEFT JOIN data_pipeline.meta_ads ad ON btrim(t.utm_content) = ad.ad_id
    LEFT JOIN data_pipeline.meta_adsets ads ON btrim(t.utm_term) = ads.adset_id
)
SELECT
    COUNT(*) AS total_orders,
    COUNT(*) FILTER (WHERE utm_source IS NOT NULL AND btrim(utm_source)<>'') AS orders_with_utm_source,
    ROUND(100.0*COUNT(*) FILTER (WHERE utm_source IS NOT NULL AND btrim(utm_source)<>'')/NULLIF(COUNT(*),0),2) AS utm_source_pct,
    COUNT(*) FILTER (WHERE utm_campaign IS NOT NULL AND btrim(utm_campaign)<>'') AS orders_with_utm_campaign,
    ROUND(100.0*COUNT(*) FILTER (WHERE utm_campaign IS NOT NULL AND btrim(utm_campaign)<>'')/NULLIF(COUNT(*),0),2) AS utm_campaign_pct,
    COUNT(*) FILTER (WHERE utm_term IS NOT NULL AND btrim(utm_term)<>'') AS orders_with_utm_term,
    ROUND(100.0*COUNT(*) FILTER (WHERE utm_term IS NOT NULL AND btrim(utm_term)<>'')/NULLIF(COUNT(*),0),2) AS utm_term_pct,
    COUNT(*) FILTER (WHERE utm_content IS NOT NULL AND btrim(utm_content)<>'') AS orders_with_utm_content,
    ROUND(100.0*COUNT(*) FILTER (WHERE utm_content IS NOT NULL AND btrim(utm_content)<>'')/NULLIF(COUNT(*),0),2) AS utm_content_pct,
    COUNT(*) FILTER (WHERE has_campaign_match) AS direct_campaign_matches,
    ROUND(100.0*COUNT(*) FILTER (WHERE has_campaign_match)/NULLIF(COUNT(*),0),2) AS direct_campaign_match_pct,
    COUNT(*) FILTER (WHERE has_adset_match) AS direct_adset_matches,
    ROUND(100.0*COUNT(*) FILTER (WHERE has_adset_match)/NULLIF(COUNT(*),0),2) AS direct_adset_match_pct,
    COUNT(*) FILTER (WHERE has_ad_match) AS direct_ad_matches,
    ROUND(100.0*COUNT(*) FILTER (WHERE has_ad_match)/NULLIF(COUNT(*),0),2) AS direct_ad_match_pct,
    COUNT(*) FILTER (WHERE has_ad_match) AS exact_ad_orders,
    COUNT(*) FILTER (WHERE NOT has_ad_match AND has_adset_match) AS exact_adset_only_orders,
    COUNT(*) FILTER (WHERE NOT has_ad_match AND NOT has_adset_match AND has_campaign_match) AS exact_campaign_only_orders,
    COUNT(*) FILTER (WHERE COALESCE(ad_campaign_id, adset_campaign_id, CASE WHEN has_campaign_match THEN btrim(utm_campaign) END) IS NOT NULL) AS recoverable_exact_campaign_orders,
    ROUND(100.0*COUNT(*) FILTER (WHERE COALESCE(ad_campaign_id, adset_campaign_id, CASE WHEN has_campaign_match THEN btrim(utm_campaign) END) IS NOT NULL)/NULLIF(COUNT(*),0),2) AS recoverable_campaign_pct,
    COUNT(*) FILTER (WHERE COALESCE(ad_adset_id, CASE WHEN has_adset_match THEN btrim(utm_term) END) IS NOT NULL) AS recoverable_exact_adset_orders,
    ROUND(100.0*COUNT(*) FILTER (WHERE COALESCE(ad_adset_id, CASE WHEN has_adset_match THEN btrim(utm_term) END) IS NOT NULL)/NULLIF(COUNT(*),0),2) AS recoverable_adset_pct,
    ROUND(100.0*COUNT(*) FILTER (WHERE has_ad_match)/NULLIF(COUNT(*),0),2) AS exact_ad_pct
FROM matched;

-- For tier breakdown see Q6. Join Q13 and Q6 for complete summary.

