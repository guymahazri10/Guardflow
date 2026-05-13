-- GuardFlow Phase 1 RLS draft

alter table public.roster_boards enable row level security;
alter table public.shift_staffing enable row level security;

-- Phase 1:
-- Keep read access for authenticated users only.
-- Do not allow broad write access yet.
-- Role-based write policies will be implemented in Phase 2.

drop policy if exists "allow authenticated read roster_boards" on public.roster_boards;
create policy "allow authenticated read roster_boards"
  on public.roster_boards
  for select
  to authenticated
  using (true);

drop policy if exists "allow authenticated manage roster_boards" on public.roster_boards;

drop policy if exists "allow authenticated read shift_staffing" on public.shift_staffing;
create policy "allow authenticated read shift_staffing"
  on public.shift_staffing
  for select
  to authenticated
  using (true);

drop policy if exists "allow authenticated manage shift_staffing" on public.shift_staffing;

-- Phase 2 TODO:
-- roster_boards:
-- read: authenticated
-- create/update/delete: manager only
--
-- shift_staffing:
-- read: authenticated
-- create/update: manager or shift commander
-- delete: manager only