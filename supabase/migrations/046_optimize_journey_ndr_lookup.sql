-- 046 — Avoid aggregating the complete scan history for every Journey query.
-- had_ndr semantics are unchanged; evidence is checked only for matched
-- Shiprocket orders returned by the surrounding query.

create index if not exists idx_shiprocket_scans_sr_order_id
  on data_pipeline.shiprocket_scans (sr_order_id);

create or replace view data_pipeline.mart_order_journey_ndr with (security_invoker = true) as
select
  p.*,
  s.undelivered_reason_code,
  (
    coalesce(p.is_ndr, false)
    or nullif(btrim(coalesce(p.undelivered_reason, '')), '') is not null
    or nullif(btrim(coalesce(s.undelivered_reason_code, '')), '') is not null
    or exists (
      select 1
      from data_pipeline.shiprocket_scans h
      where h.sr_order_id = p.shiprocket_sr_order_id
        and (
          lower(coalesce(h.status, '')) like '%ndr%'
          or lower(coalesce(h.status, '')) = 'undelivered'
          or lower(coalesce(h.sr_status_label, '')) like '%ndr%'
          or lower(coalesce(h.sr_status_label, '')) = 'undelivered'
          or lower(coalesce(h.activity, '')) like '%ndr%'
          or lower(coalesce(h.activity, '')) like '%undelivered%'
        )
    )
  ) as had_ndr
from data_pipeline.mart_order_journey_profitability p
left join data_pipeline.shiprocket_orders s
  on s.sr_order_id = p.shiprocket_sr_order_id;

create or replace view analytics.mart_order_journey_ndr with (security_invoker = true) as
select * from data_pipeline.mart_order_journey_ndr;

