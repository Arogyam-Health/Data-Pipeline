-- 007_cron_setup.sql
-- Cron configuration for invoking the Shiprocket worker.
-- IMPORTANT: This migration does NOT embed any Supabase project URL or ref.
-- The Edge Function URL must be configured manually or via secrets.
--
-- Manual setup steps:
-- 1. Deploy the shiprocket-worker Edge Function:
--    supabase functions deploy shiprocket-worker
--
-- 2. Set the WORKER_SECRET in your Supabase project:
--    supabase secrets set WORKER_SECRET=<your-secret>
--
-- 3. Create the cron job via the Supabase Dashboard > SQL Editor:
--
--    SELECT cron.schedule(
--      'shiprocket-worker-trigger',
--      '* * * * *',
--      $$
--      SELECT net.http_post(
--        url := current_setting('app.settings.supabase_url') || '/functions/v1/shiprocket-worker',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || current_setting('app.settings.worker_secret')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
-- 4. Or use the Supabase CLI to set project-specific config:
--    supabase config set app.settings.supabase_url=<your-project-url>
--    supabase config set app.settings.worker_secret=<your-worker-secret>
--
-- Note: The above uses PostgreSQL settings which are project-specific.
-- Do NOT hardcode these values into the migration file.

-- ============================================================
-- Alternative: Pure pg_cron approach using a database function
-- This avoids needing to call Edge Functions via HTTP.
-- ============================================================

-- Create a function that reads and processes a batch directly in SQL.
-- This is a simpler alternative to the Edge Function for initial testing.
create or replace function data_pipeline.process_shiprocket_batch(
  p_batch_size integer default 20
) returns jsonb as $$
declare
  v_msg record;
  v_processed integer := 0;
  v_failed integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  -- Read messages from queue
  for v_msg in
    select * from pgmq.read('shiprocket_webhooks', p_batch_size, 300)
  loop
    begin
      -- Mark event as processing
      update data_pipeline.integration_events
      set status = 'processing',
          processing_started_at = now(),
          attempt_count = attempt_count + 1
      where id = (v_msg.message->>'event_id')::uuid
        and status in ('pending', 'failed');

      -- Archive the message (processing will be completed by the worker)
      perform pgmq.archive('shiprocket_webhooks', v_msg.msg_id);

      v_processed := v_processed + 1;
      v_events := v_events || jsonb_build_object(
        'event_id', v_msg.message->>'event_id',
        'msg_id', v_msg.msg_id
      );

    exception when others then
      v_failed := v_failed + 1;
      -- Set visibility delay for retry
      perform pgmq.set_visibility('shiprocket_webhooks', v_msg.msg_id, 30);
    end;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'failed', v_failed,
    'events', v_events
  );
end;
$$ language plpgsql;
