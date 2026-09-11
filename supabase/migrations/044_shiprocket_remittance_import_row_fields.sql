-- 044 — Complete the immutable remittance import-row audit payload.
-- Migration 042 created the audit table before all workbook fields were
-- propagated into the selected-import query. Keep this additive so existing
-- installations can apply it safely.

alter table data_pipeline.shiprocket_remittance_import_rows
  add column if not exists shipped_date date,
  add column if not exists courier text,
  add column if not exists channel_name text,
  add column if not exists remittance_type text,
  add column if not exists linked_crf_ids text;

create index if not exists idx_sr_remittance_import_rows_crf
  on data_pipeline.shiprocket_remittance_import_rows (import_id, crf_id);

