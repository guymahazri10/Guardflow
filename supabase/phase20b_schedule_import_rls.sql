-- supabase/phase20b_schedule_import_rls.sql

alter table public.schedule_imports enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.staffing_change_log enable row level security;
alter table public.app_feature_flags enable row level security;

-- schedule_imports: manager only, direct access (low-risk metadata, no RPC needed)
create policy "schedule_imports select manager"
  on public.schedule_imports for select
  to authenticated
  using (public.get_my_role() = 'מנהל');

create policy "schedule_imports insert manager"
  on public.schedule_imports for insert
  to authenticated
  with check (public.get_my_role() = 'מנהל');

create policy "schedule_imports update manager"
  on public.schedule_imports for update
  to authenticated
  using (public.get_my_role() = 'מנהל')
  with check (public.get_my_role() = 'מנהל');

-- shift_assignments: readable by any authenticated user for published rows;
-- unpublished rows are manager-only. No insert/update/delete policy at all —
-- writes only happen through security definer RPCs (Task 11).
create policy "shift_assignments select published or manager"
  on public.shift_assignments for select
  to authenticated
  using (published = true or public.get_my_role() = 'מנהל');

-- staffing_change_log: readable by manager and commander, no direct writes.
create policy "staffing_change_log select manager or commander"
  on public.staffing_change_log for select
  to authenticated
  using (public.get_my_role() in ('מנהל', 'אחמ"ש'));

-- app_feature_flags: any authenticated user can read (needed to gate the UI),
-- only manager can write.
create policy "app_feature_flags select all authenticated"
  on public.app_feature_flags for select
  to authenticated
  using (true);

create policy "app_feature_flags update manager"
  on public.app_feature_flags for update
  to authenticated
  using (public.get_my_role() = 'מנהל')
  with check (public.get_my_role() = 'מנהל');
