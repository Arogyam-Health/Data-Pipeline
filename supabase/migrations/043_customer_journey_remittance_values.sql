-- 043 — Add canonical per-order remittance display values to the journey.
-- Additive wrapper around 041; preserves one row per Shopify order.

create schema if not exists data_pipeline;
create schema if not exists analytics;

create or replace view data_pipeline.mart_order_journey_remittance with (security_invoker = true) as
select
  j.*,
  r.order_value as latest_remittance_order_value,
  r.total_adjusted_amt as latest_total_adjusted_amt,
  r.remittance_date as latest_remittance_date,
  r.match_method as latest_remittance_match_method,
  r.match_reason_code as latest_remittance_match_reason_code
from data_pipeline.mart_order_journey_ndr j
left join lateral (
  select ro.order_value, ro.total_adjusted_amt, ro.remittance_date,
    ro.match_method, ro.match_reason_code
  from data_pipeline.shiprocket_remittance_orders ro
  where ro.matched_sr_order_id = j.shiprocket_sr_order_id
    and ro.match_status = 'matched'
  order by ro.remittance_date desc nulls last, ro.updated_at desc
  limit 1
) r on true;

grant select on data_pipeline.mart_order_journey_remittance to service_role, authenticated;

create or replace view analytics.mart_order_journey_remittance with (security_invoker = true) as
select * from data_pipeline.mart_order_journey_remittance;

grant select on analytics.mart_order_journey_remittance to service_role, authenticated;

comment on view data_pipeline.mart_order_journey_remittance is
'Canonical journey remittance display values: order_value and adjustment are separate; one row per Shopify order.';
