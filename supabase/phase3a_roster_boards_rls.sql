-- GuardFlow Phase 3A roster_boards RLS
--
-- Architecture rule:
-- public.roster_boards stores schedule structure only.
-- Guard names must stay only in public.shift_staffing, never in public.roster_boards.
--
-- This phase changes roster_boards policies only.
-- public.shift_staffing remains read-only for authenticated users for now.

alter table public.roster_boards enable row level security;

-- Remove older roster_boards policy names before installing the Phase 3A policy set.
drop policy if exists "allow authenticated read roster_boards" on public.roster_boards;
drop policy if exists "allow authenticated manage roster_boards" on public.roster_boards;
drop policy if exists "roster_boards select authenticated" on public.roster_boards;
drop policy if exists "roster_boards insert manager" on public.roster_boards;
drop policy if exists "roster_boards update manager" on public.roster_boards;
drop policy if exists "roster_boards delete manager" on public.roster_boards;

-- Any authenticated user may read roster board templates.
create policy "roster_boards select authenticated"
  on public.roster_boards
  for select
  to authenticated
  using (true);

-- Only managers may create roster board templates.
create policy "roster_boards insert manager"
  on public.roster_boards
  for insert
  to authenticated
  with check (public.get_my_role() = 'מנהל');

-- Only managers may update roster board templates.
create policy "roster_boards update manager"
  on public.roster_boards
  for update
  to authenticated
  using (public.get_my_role() = 'מנהל')
  with check (public.get_my_role() = 'מנהל');

-- Only managers may delete roster board templates.
create policy "roster_boards delete manager"
  on public.roster_boards
  for delete
  to authenticated
  using (public.get_my_role() = 'מנהל');

-- Future policy plan for public.shift_staffing, not implemented in this phase:
-- read: authenticated
-- create/update: manager or shift commander
-- delete: manager only
