-- 049 — Effective remittance membership infrastructure.
-- No existing business views are changed in this phase.

alter table data_pipeline.shiprocket_remittance_imports
  add column if not exists is_active boolean not null default true;

create index if not exists idx_shiprocket_remittance_imports_active
  on data_pipeline.shiprocket_remittance_imports (status, is_active);

create index if not exists idx_shiprocket_remittance_import_rows_identity
  on data_pipeline.shiprocket_remittance_import_rows (crf_id, awb, order_id, import_id);

create view data_pipeline.shiprocket_effective_remittance_orders
with (security_invoker = true) as
select ro.*
from data_pipeline.shiprocket_remittance_orders ro
where exists (
  select 1
  from data_pipeline.shiprocket_remittance_import_rows ir
  join data_pipeline.shiprocket_remittance_imports i on i.id = ir.import_id
  where i.status = 'completed'
    and i.is_active = true
    and ir.crf_id is not distinct from ro.crf_id
    and ir.awb is not distinct from ro.awb
    and ir.order_id is not distinct from ro.order_id
);

revoke all on data_pipeline.shiprocket_effective_remittance_orders from anon, authenticated;
grant select on data_pipeline.shiprocket_effective_remittance_orders to service_role;

comment on view data_pipeline.shiprocket_effective_remittance_orders is
  'Current remittance evidence only: canonical rows supported by at least one completed active import. Raw canonical rows remain historical audit data.';
