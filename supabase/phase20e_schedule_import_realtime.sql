-- supabase/phase20e_schedule_import_realtime.sql
--
-- Registers public.shift_assignments in the supabase_realtime publication.
-- Without this, postgres_changes subscriptions on this table (e.g.
-- src/hooks/useShiftAssignments.ts's useShiftAssignmentsForWeek, which powers
-- the live "תוכנן:"/"בפועל:" propagation on ShiftLivePage) never fire, in any
-- environment — Supabase does not auto-register new tables for Realtime, a
-- table must be explicitly added to the publication first.

alter publication supabase_realtime add table public.shift_assignments;
