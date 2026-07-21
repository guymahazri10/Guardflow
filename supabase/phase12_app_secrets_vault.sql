-- GuardFlow Phase 12 — app secrets via Supabase Vault
--
-- send-position-push needs three values that must never sit in an env var
-- readable from the repo or in the pg_cron job body: the VAPID key pair
-- (Web Push signing) and a shared secret pg_cron uses to prove it's really
-- our cron calling the function (the function has verify_jwt disabled so
-- it can be invoked without a user session).
--
-- The secrets themselves were inserted directly against the live project —
-- NOT reproduced here, so a real key never lands in git:
--
--   select vault.create_secret('<vapid public key>',  'vapid_public_key',    '...');
--   select vault.create_secret('<vapid private key>', 'vapid_private_key',   '...');
--   select vault.create_secret('<random hex string>', 'cron_shared_secret',  '...');
--
-- This function is the only way anything reads them back, and only
-- service_role may call it.

create or replace function public.get_app_secret(secret_name text)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name;
$$;

revoke all on function public.get_app_secret(text) from public, anon, authenticated;
grant execute on function public.get_app_secret(text) to service_role;
