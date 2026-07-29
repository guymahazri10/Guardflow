-- GuardFlow Phase 18c — scope shift_templates' update grant to safe columns
--
-- phase18b granted UPDATE on the whole row to `authenticated`. The RLS
-- policy only checks the caller's role, not which columns changed, so any
-- manager could in principle PATCH shift_id directly (bypassing the app's
-- own code, which never touches it) and orphan one of the five fixed
-- templates. There's no INSERT/DELETE grant, so a 6th row still can't be
-- created — but a row could be silently detached from its shift.
--
-- Scoping the grant to cols/rows/notes (the only fields the app ever
-- writes) makes shift_id and updated_at read-only for authenticated users
-- at the database level, not just by convention.

revoke update on public.shift_templates from authenticated;
grant update (cols, rows, notes) on public.shift_templates to authenticated;
