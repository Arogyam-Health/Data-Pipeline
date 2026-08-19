-- 004_shiprocket_queue.sql
-- Creates the pgmq queue and helper functions for Shiprocket webhook processing.
-- Portable: no project IDs, no URLs, no credentials.
-- Requires: pgmq extension (available on Supabase).

-- Enable pgmq extension
create extension if not exists pgmq;

-- ============================================================
-- Queue creation
-- ============================================================
select pgmq.create('shiprocket_webhooks');

-- ============================================================
-- Helper functions (namespaced under data_pipeline)
-- ============================================================

-- Ingest a Shiprocket webhook: insert event + enqueue atomically.
-- Returns the event_id and whether it was a duplicate.
create or replace function data_pipeline.ingest_shiprocket_webhook(
  p_payload jsonb,
  p_request_hash text,
  p_request_headers jsonb default null
) returns jsonb as $$
declare
  v_event_id uuid;
  v_is_duplicate boolean := false;
begin
  -- Try to insert the integration event
  begin
    insert into data_pipeline.integration_events (
      provider, event_type, request_hash, payload, request_headers, status
    ) values (
      'shiprocket', 'webhook', p_request_hash, p_payload, p_request_headers, 'pending'
    )
    returning id into v_event_id;
  exception when unique_violation then
    -- Duplicate request hash — look up existing event
    select id into v_event_id
    from data_pipeline.integration_events
    where provider = 'shiprocket' and request_hash = p_request_hash;

    v_is_duplicate := true;
  end;

  -- Enqueue if not duplicate
  if not v_is_duplicate then
    perform pgmq.send('shiprocket_webhooks', jsonb_build_object('event_id', v_event_id));
  end if;

  return jsonb_build_object(
    'event_id', v_event_id,
    'duplicate', v_is_duplicate
  );
end;
$$ language plpgsql;

-- Read a batch of messages from the Shiprocket queue.
create or replace function data_pipeline.read_shiprocket_queue(
  p_batch_size integer default 20,
  p_visibility_timeout integer default 300
) returns setof pgmq.message_record as $$
begin
  return query
  select *
  from pgmq.read('shiprocket_webhooks', p_batch_size, p_visibility_timeout);
end;
$$ language plpgsql;

-- Archive (ack) a successfully processed message.
create or replace function data_pipeline.archive_shiprocket_queue_message(
  p_msg_id bigint
) returns void as $$
begin
  perform pgmq.archive('shiprocket_webhooks', p_msg_id);
end;
$$ language plpgsql;

-- Retry a failed message with a visibility delay.
create or replace function data_pipeline.retry_shiprocket_queue_message(
  p_msg_id bigint,
  p_delay_seconds integer
) returns void as $$
begin
  perform pgmq.set_visibility('shiprocket_webhooks', p_msg_id, p_delay_seconds);
end;
$$ language plpgsql;

-- Delete a dead-letter message from the queue.
create or replace function data_pipeline.delete_shiprocket_queue_message(
  p_msg_id bigint
) returns void as $$
begin
  perform pgmq.delete('shiprocket_webhooks', p_msg_id);
end;
$$ language plpgsql;
