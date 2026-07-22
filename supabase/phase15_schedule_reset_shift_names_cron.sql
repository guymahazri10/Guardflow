-- GuardFlow Phase 15 — schedule reset-shift-names every 5 minutes
--
-- Once a shift's time window ends (per its category — morning 07:00-15:00,
-- afternoon 15:00-23:00, night 23:00-07:00), its board's guard_names should
-- go back to blank so the next time it's opened it doesn't still show
-- whoever worked it last time. The function itself is idempotent (clearing
-- an already-empty board is a no-op), so a 5-minute cadence is plenty —
-- this isn't time-sensitive the way the position-change push is.

select cron.schedule(
  'reset-shift-names-every-5-min',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://graeqyvsipbqfqwhcxlj.supabase.co/functions/v1/reset-shift-names',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
