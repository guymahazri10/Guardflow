-- GuardFlow Phase 1 RLS draft

alter table public.roster_boards enable row level security;
alter table public.shift_staffing enable row level security;

-- Placeholder policies for later phases.
-- Keep simple now; refine with auth roles in Phase 2.

drop policy if exists "allow authenticated read roster_boards" on public.roster_boards;
create policy "allow authenticated read roster_boards"
  on public.roster_boards
  for select
  to authenticated
  using (true);

drop policy if exists "allow authenticated manage roster_boards" on public.roster_boards;
create policy "allow authenticated manage roster_boards"
  on public.roster_boards
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "allow authenticated read shift_staffing" on public.shift_staffing;
create policy "allow authenticated read shift_staffing"
  on public.shift_staffing
  for select
  to authenticated
  using (true);

drop policy if exists "allow authenticated manage shift_staffing" on public.shift_staffing;
create policy "allow authenticated manage shift_staffing"
  on public.shift_staffing
  for all
  to authenticated
  using (true)
  with check (true);
