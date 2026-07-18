-- GuardFlow Phase 4 (build roadmap Phase 0) — guard_names on roster_boards
--
-- Architecture decision: roster_boards is the single source of truth for a
-- shift board — both structure (cols/rows) AND guard names. shift_staffing
-- is deprecated (see note below) and must not be read from or written to.
--
-- This migration only adds the column. RLS for who may update guard_names
-- (manager + commander, without granting structure edits) is Phase 1 of the
-- build roadmap and ships in a separate migration.

alter table public.roster_boards
  add column if not exists guard_names jsonb not null default '{}'::jsonb;

comment on table public.roster_boards is
  'Single source of truth for a shift board: structure (cols/rows) and guard_names together. Do not introduce a second table for guard names.';

comment on column public.roster_boards.guard_names is
  'Map of role/column name -> guard display name for this board. Read and written only through this column.';

-- shift_staffing is deprecated. No code reads or writes it. It will be
-- dropped in a later migration (build roadmap Phase 7) once we've confirmed
-- nothing depends on it.
comment on table public.shift_staffing is
  'DEPRECATED — do not use. Guard names live in public.roster_boards.guard_names. Scheduled for removal.';
