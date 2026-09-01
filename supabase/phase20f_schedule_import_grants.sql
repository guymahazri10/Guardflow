-- supabase/phase20f_schedule_import_grants.sql
--
-- RLS policies alone are not sufficient — Postgres also requires a base
-- table-level GRANT to the role before RLS is even evaluated. phase20b
-- created policies but never issued these GRANTs, so every direct client
-- read/write to these 4 tables was rejected with "permission denied" for
-- the authenticated role, regardless of RLS. This went undetected through
-- all local testing because local verification always ran as the postgres
-- superuser (via docker exec), which bypasses grants entirely — and RPC
-- calls (security definer) run as the function owner, not the caller, so
-- they never exercised these grants either. Only a genuine client-side
-- SELECT (e.g. useFeatureFlag) surfaces this.

grant select, insert, update on public.schedule_imports to authenticated;
grant select on public.shift_assignments to authenticated;
grant select on public.staffing_change_log to authenticated;
grant select, update on public.app_feature_flags to authenticated;
