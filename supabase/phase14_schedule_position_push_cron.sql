-- GuardFlow Phase 14 — schedule send-position-push every minute
--
-- pg_cron fires an HTTP POST (via pg_net) to the Edge Function every minute.
-- The function itself decides whether anything is actually due to be sent
-- (guards inside the 5-minute pre-transition window) and dedupes against
-- push_notification_log, so a minute-granularity schedule just bounds the
-- worst-case delay, not the send rate.
--
-- The shared secret is pulled from Vault at call time (see phase12) so it
-- never appears in the migration itself in plaintext beyond this lookup.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-position-push-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://graeqyvsipbqfqwhcxlj.supabase.co/functions/v1/send-position-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
