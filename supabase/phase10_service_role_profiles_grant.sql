-- GuardFlow Phase 10 — grant service_role full access to profiles
--
-- The invite-user / delete-user Edge Functions use the service-role key to
-- read and update public.profiles directly via PostgREST. service_role was
-- never explicitly granted privileges on this table (only anon/authenticated
-- were managed by phase2's revoke/grant), so those requests failed with
-- "permission denied for table profiles". service_role always bypasses RLS,
-- but still needs the underlying GRANT.

grant select, insert, update, delete on public.profiles to service_role;
