-- GuardFlow Phase 8 (build roadmap Phase 7) — drop deprecated shift_staffing
--
-- shift_staffing has been deprecated since the Phase 0 architecture decision
-- (roster_boards.guard_names is the single source of truth for names). No
-- application code has ever read or written it, and it holds zero rows.
-- Safe to drop.

drop table if exists public.shift_staffing;
