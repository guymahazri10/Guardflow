-- GuardFlow Phase 13 — grant service_role full access to roster_boards
--
-- Same root cause as phase10 (profiles): send-position-push's admin client
-- got "permission denied for table roster_boards" even though service_role
-- bypasses RLS — it still needs the underlying GRANT, which was never
-- given (only anon/authenticated were managed by phase3a's policies).

grant select, insert, update, delete on public.roster_boards to service_role;
