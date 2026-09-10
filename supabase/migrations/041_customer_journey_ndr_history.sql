-- 041 — Separate current/open NDR from historical NDR experience.
-- Additive and idempotent. Scan evidence is pre-aggregated before joining.

create schema if not exists data_pipeline;
create schema if not exists analytics;

create or replace view data_pipeline.mart_order_journey_ndr with (security_invoker = true) as
with scan_history as (
  select sr_order_id,
    bool_or(
      lower(coalesce(status, '')) like '%ndr%' or lower(coalesce(status, '')) = 'undelivered'
      or lower(coalesce(sr_status_label, '')) like '%ndr%' or lower(coalesce(sr_status_label, '')) = 'undelivered'
      or lower(coalesce(activity, '')) like '%ndr%' or lower(coalesce(activity, '')) like '%undelivered%'
    ) as scan_had_ndr
  from data_pipeline.shiprocket_scans
  group by sr_order_id
)
select p.*, s.undelivered_reason_code,
  (coalesce(p.is_ndr, false)
   or nullif(btrim(coalesce(p.undelivered_reason, '')), '') is not null
   or nullif(btrim(coalesce(s.undelivered_reason_code, '')), '') is not null
   or coalesce(h.scan_had_ndr, false)) as had_ndr
from data_pipeline.mart_order_journey_profitability p
left join data_pipeline.shiprocket_orders s on s.sr_order_id = p.shiprocket_sr_order_id
left join scan_history h on h.sr_order_id = p.shiprocket_sr_order_id;

grant select on data_pipeline.mart_order_journey_ndr to service_role, authenticated;
create or replace view analytics.mart_order_journey_ndr with (security_invoker = true) as
select * from data_pipeline.mart_order_journey_ndr;
grant select on analytics.mart_order_journey_ndr to service_role, authenticated;

comment on view data_pipeline.mart_order_journey_ndr is
'is_ndr is current/open NDR only; had_ndr uses current NDR, explicit reason/code, or explicit NDR/UNDELIVERED scan evidence. One row per Shopify order.';
