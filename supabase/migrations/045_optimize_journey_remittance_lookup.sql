-- 045 — Optimize the canonical remittance lookup used by Customer Journey.
-- The previous wrapper used a correlated lateral lookup for every journey row.
-- Rank canonical matches once, then join the single latest row per SR order.

create index if not exists idx_shiprocket_remittance_orders_journey_latest
  on data_pipeline.shiprocket_remittance_orders
  (matched_sr_order_id, match_status, remittance_date desc, updated_at desc);

create or replace view data_pipeline.mart_order_journey_remittance with (security_invoker = true) as
with latest_remittance as (
  select distinct on (ro.matched_sr_order_id)
    ro.matched_sr_order_id,
    ro.order_value,
    ro.total_adjusted_amt,
    ro.remittance_date,
    ro.match_method,
    ro.match_reason_code
  from data_pipeline.shiprocket_remittance_orders ro
  where ro.matched_sr_order_id is not null
    and ro.match_status = 'matched'
  order by ro.matched_sr_order_id, ro.remittance_date desc nulls last, ro.updated_at desc
)
select
  j.*,
  r.order_value as latest_remittance_order_value,
  r.total_adjusted_amt as latest_total_adjusted_amt,
  r.remittance_date as latest_remittance_date,
  r.match_method as latest_remittance_match_method,
  r.match_reason_code as latest_remittance_match_reason_code
from data_pipeline.mart_order_journey_ndr j
left join latest_remittance r
  on r.matched_sr_order_id = j.shiprocket_sr_order_id;

create or replace view analytics.mart_order_journey_remittance with (security_invoker = true) as
select * from data_pipeline.mart_order_journey_remittance;

