-- GuardFlow Phase 18b — fix missing shift_templates grants
--
-- phase18_shift_templates.sql enabled RLS and added select/update policies
-- for `authenticated`, but never granted the underlying Postgres table
-- privileges — RLS policies are irrelevant without them, so every
-- authenticated read/update against shift_templates failed with
-- "permission denied for table shift_templates" (Postgres 42501).

grant select, update on public.shift_templates to authenticated;
