-- supabase/phase22_manager_schedule_edits.sql
--
-- A manager can correct the published weekly schedule without uploading a new
-- Excel: replace the worker, change hours, move a shift to another post /
-- shift, add a shift, cancel one, and restore a cancelled one.
--
-- Design (see the planning notes in the PR):
--   * Writes only through the four security-definer RPCs below, manager only,
--     enforced here in the database (not by hiding buttons).
--   * A cancelled shift is NOT deleted: it stays as a row with published = false
--     and is_manually_edited = true. publish_schedule_import already keeps any
--     is_manually_edited row untouched (and never sweeps it), so a re-upload of
--     the same or an updated Excel can neither resurrect nor duplicate it; the
--     import preview shows it as a conflict the manager must resolve.
--   * Moving a shift to another post / shift is ONE transaction: the old row
--     becomes a cancelled marker (its Excel values untouched) and the new row is
--     created (or a cancelled marker at the target is reused). If the target is
--     taken by a live shift the whole call fails and nothing changes.
--   * Excel source data is never rewritten: source_name, import_id and the
--     original values (in the first history entry's "before") stay as read.
--   * Concurrency: every change to an existing row names the updated_at the
--     manager saw; if the row changed meanwhile (another editor, or the existing
--     replace_assignment_worker, which also bumps updated_at) the call fails.
--   * History: staffing_change_log gains details (jsonb: full before/after) and
--     five new change kinds. Moves are linked by details.change_group.
--
-- publish_schedule_import, replace_assignment_worker and shift_assignments'
-- columns are NOT changed.

alter table public.staffing_change_log add column details jsonb;

alter table public.staffing_change_log drop constraint staffing_change_log_change_kind_check;
alter table public.staffing_change_log add constraint staffing_change_log_change_kind_check check (
  change_kind in (
    'manual_replace', 'import_insert', 'import_update', 'import_kept_manual', 'import_revert_to_file',
    'manual_edit', 'manual_add', 'manual_cancel', 'manual_restore', 'manual_move'
  )
);

-- ---------------------------------------------------------------------------
-- "Manually edited" is not "the worker was replaced". A row is a worker
-- replacement when it was edited AND its worker differs from the file's:
--   * a different account, or
--   * no account at all (free text) with a name that differs from the file's.
-- Hours / post-only edits keep the worker, so "My shifts" keeps attributing the
-- row by name / explicit link exactly as before the edit.
create or replace function public.shift_worker_replaced(a public.shift_assignments)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a.is_manually_edited
    and (
      a.actual_user_id is distinct from a.planned_user_id
      or (a.actual_user_id is null and a.actual_name is distinct from a.source_name)
    );
$$;

revoke all on function public.shift_worker_replaced(public.shift_assignments) from public, anon, authenticated;

create or replace function public.assignment_snapshot(a public.shift_assignments)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'work_date', a.work_date, 'shift_category', a.shift_category, 'worker_kind', a.worker_kind,
    'position', a.position, 'slot_index', a.slot_index, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
    'source_name', a.source_name, 'planned_user_id', a.planned_user_id,
    'actual_user_id', a.actual_user_id, 'actual_name', a.actual_name,
    'is_manually_edited', a.is_manually_edited, 'cancelled', not a.published, 'source', a.source
  );
$$;

revoke all on function public.assignment_snapshot(public.shift_assignments) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- shared validation of a (category, post, slot, hours) combination

create or replace function public.validate_shift_fields(
  p_work_date date, p_category text, p_worker_kind text, p_position text, p_slot int, p_starts timestamptz, p_ends timestamptz
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_category not in ('morning', 'afternoon', 'night') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_worker_kind not in ('אחמ"ש', 'מאבטח') then
    raise exception 'invalid_worker_kind' using errcode = '22023';
  end if;
  if coalesce(btrim(p_position), '') = '' then
    raise exception 'invalid_position' using errcode = '22023';
  end if;
  if (p_position = 'אחמ"ש') <> (p_worker_kind = 'אחמ"ש') then
    raise exception 'post_kind_mismatch' using errcode = '22023';
  end if;
  if p_slot is null or p_slot < 0 or p_slot > 9 then
    raise exception 'invalid_slot' using errcode = '22023';
  end if;
  if p_ends <= p_starts then
    raise exception 'ends_before_start' using errcode = '22023';
  end if;
  if p_ends - p_starts > interval '16 hours' then
    raise exception 'shift_too_long' using errcode = '22023';
  end if;
  -- a shift belongs to the calendar day it STARTS on (Israel time), a night shift included
  if (p_starts at time zone 'Asia/Jerusalem')::date <> p_work_date then
    raise exception 'start_date_mismatch' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.validate_shift_fields(date, text, text, text, int, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.require_edit_reason(p_work_date date, p_reason text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  -- correcting a shift that already happened must say why
  if p_work_date < (now() at time zone 'Asia/Jerusalem')::date and coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.require_edit_reason(date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- edit_shift_assignment: in-place edit of hours / worker, or an atomic move
-- p_changes keys (all optional): starts_at, ends_at, shift_category, position,
-- slot_index, worker { user_id | null, name }.

create or replace function public.edit_shift_assignment(
  p_assignment_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_reason text default null
)
returns public.shift_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row public.shift_assignments;
  target public.shift_assignments;
  result public.shift_assignments;
  n_starts timestamptz;
  n_ends timestamptz;
  n_cat text;
  n_pos text;
  n_slot int;
  worker jsonb := p_changes -> 'worker';
  n_actual_user uuid;
  n_actual_name text;
  worker_changed boolean := false;
  is_move boolean;
  grp uuid := gen_random_uuid();
begin
  if coalesce(public.get_my_role(), '') <> 'מנהל' then
    raise exception 'Only מנהל can edit the schedule' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;

  select * into old_row from public.shift_assignments where id = p_assignment_id for update;
  if old_row.id is null then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if not old_row.published then
    raise exception 'assignment_cancelled' using errcode = '22023';
  end if;
  if p_expected_updated_at is null or old_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'concurrent_change' using errcode = '40001';
  end if;
  perform public.require_edit_reason(old_row.work_date, p_reason);

  n_starts := coalesce((p_changes ->> 'starts_at')::timestamptz, old_row.starts_at);
  n_ends := coalesce((p_changes ->> 'ends_at')::timestamptz, old_row.ends_at);
  n_cat := coalesce(p_changes ->> 'shift_category', old_row.shift_category);
  n_pos := coalesce(p_changes ->> 'position', old_row.position);
  n_slot := coalesce((p_changes ->> 'slot_index')::int, old_row.slot_index);
  n_actual_user := old_row.actual_user_id;
  n_actual_name := old_row.actual_name;

  if worker is not null and jsonb_typeof(worker) = 'object' then
    n_actual_user := nullif(worker ->> 'user_id', '')::uuid;
    n_actual_name := nullif(btrim(coalesce(worker ->> 'name', '')), '');
    if n_actual_user is not null then
      if not exists (select 1 from public.profiles where id = n_actual_user) then
        raise exception 'account_not_found' using errcode = '22023';
      end if;
      n_actual_name := coalesce(n_actual_name, (select full_name from public.profiles where id = n_actual_user));
    end if;
    if n_actual_name is null then
      raise exception 'worker_name_required' using errcode = '22023';
    end if;
    worker_changed := n_actual_user is distinct from old_row.actual_user_id or n_actual_name is distinct from old_row.actual_name;
  end if;

  -- legacy rows may carry odd hours; only validate what the caller is changing
  if p_changes ? 'starts_at' or p_changes ? 'ends_at' or p_changes ? 'shift_category' or p_changes ? 'position' or p_changes ? 'slot_index' then
    perform public.validate_shift_fields(old_row.work_date, n_cat, old_row.worker_kind, n_pos, n_slot, n_starts, n_ends);
  end if;

  is_move := (n_cat, n_pos, n_slot) is distinct from (old_row.shift_category, old_row.position, old_row.slot_index);

  if not is_move and n_starts = old_row.starts_at and n_ends = old_row.ends_at and not worker_changed then
    raise exception 'no_changes' using errcode = '22023';
  end if;

  if not is_move then
    update public.shift_assignments
    set starts_at = n_starts, ends_at = n_ends,
        actual_user_id = n_actual_user, actual_name = n_actual_name,
        is_manually_edited = true, updated_at = clock_timestamp()
    where id = old_row.id
    returning * into result;

    insert into public.staffing_change_log (assignment_id, from_user_id, from_name, to_user_id, to_name, reason, change_kind, changed_by, changed_at, details)
    values (old_row.id, old_row.actual_user_id, old_row.actual_name, result.actual_user_id, result.actual_name, p_reason, 'manual_edit', auth.uid(), clock_timestamp(),
            jsonb_build_object('before', public.assignment_snapshot(old_row), 'after', public.assignment_snapshot(result)));
    return result;
  end if;

  -- ---- move: ONE transaction; any failure below rolls the whole call back ----
  select * into target from public.shift_assignments
  where work_date = old_row.work_date and shift_category = n_cat and position = n_pos and slot_index = n_slot
  for update;

  if target.id is not null and target.published then
    raise exception 'target_occupied' using errcode = '23505';
  end if;

  -- the old row becomes a cancelled marker, values untouched (the Excel record stays)
  update public.shift_assignments set published = false, is_manually_edited = true, updated_at = clock_timestamp()
  where id = old_row.id;

  if target.id is not null then
    -- reuse the cancelled marker at the target key
    update public.shift_assignments
    set starts_at = n_starts, ends_at = n_ends, worker_kind = old_row.worker_kind,
        source_name = old_row.source_name, planned_user_id = old_row.planned_user_id,
        actual_user_id = n_actual_user, actual_name = n_actual_name,
        source = old_row.source, import_id = old_row.import_id,
        published = true, is_manually_edited = true, updated_at = clock_timestamp()
    where id = target.id
    returning * into result;
  else
    insert into public.shift_assignments (
      work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at,
      source_name, planned_user_id, actual_user_id, actual_name, source, import_id, is_manually_edited, published
    ) values (
      old_row.work_date, n_cat, old_row.worker_kind, n_pos, n_slot, n_starts, n_ends,
      old_row.source_name, old_row.planned_user_id, n_actual_user, n_actual_name, old_row.source, old_row.import_id, true, true
    ) returning * into result;
  end if;

  select * into old_row from public.shift_assignments where id = p_assignment_id;  -- after the cancel, for the log

  insert into public.staffing_change_log (assignment_id, from_user_id, from_name, to_user_id, to_name, reason, change_kind, changed_by, changed_at, details)
  values
    (p_assignment_id, old_row.actual_user_id, old_row.actual_name, null, null, p_reason, 'manual_cancel', auth.uid(), clock_timestamp(),
     jsonb_build_object('change_group', grp, 'moved_to_id', result.id, 'before', public.assignment_snapshot(old_row) || jsonb_build_object('cancelled', false),
                        'after', public.assignment_snapshot(old_row))),
    (result.id, old_row.actual_user_id, old_row.actual_name, result.actual_user_id, result.actual_name, p_reason, 'manual_move', auth.uid(), clock_timestamp(),
     jsonb_build_object('change_group', grp, 'moved_from_id', p_assignment_id,
                        'before', public.assignment_snapshot(old_row) || jsonb_build_object('cancelled', false),
                        'after', public.assignment_snapshot(result)));
  return result;
end;
$$;

-- ---------------------------------------------------------------------------

create or replace function public.add_shift_assignment(p_assignment jsonb, p_reason text default null)
returns public.shift_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date := (p_assignment ->> 'work_date')::date;
  cat text := p_assignment ->> 'shift_category';
  kind text := p_assignment ->> 'worker_kind';
  pos text := p_assignment ->> 'position';
  slot int := coalesce((p_assignment ->> 'slot_index')::int, 0);
  s timestamptz := (p_assignment ->> 'starts_at')::timestamptz;
  e timestamptz := (p_assignment ->> 'ends_at')::timestamptz;
  worker jsonb := p_assignment -> 'worker';
  w_user uuid := nullif(worker ->> 'user_id', '')::uuid;
  w_name text := nullif(btrim(coalesce(worker ->> 'name', '')), '');
  existing public.shift_assignments;
  result public.shift_assignments;
  before_snap jsonb;
begin
  if coalesce(public.get_my_role(), '') <> 'מנהל' then
    raise exception 'Only מנהל can edit the schedule' using errcode = '42501';
  end if;
  perform public.validate_shift_fields(d, cat, kind, pos, slot, s, e);
  perform public.require_edit_reason(d, p_reason);
  if w_user is not null then
    if not exists (select 1 from public.profiles where id = w_user) then
      raise exception 'account_not_found' using errcode = '22023';
    end if;
    w_name := coalesce(w_name, (select full_name from public.profiles where id = w_user));
  end if;
  if w_name is null then
    raise exception 'worker_name_required' using errcode = '22023';
  end if;

  select * into existing from public.shift_assignments
  where work_date = d and shift_category = cat and position = pos and slot_index = slot for update;

  if existing.id is not null and existing.published then
    raise exception 'target_occupied' using errcode = '23505';
  end if;

  if existing.id is not null then
    -- a cancelled marker sits here: bring it back with the new content (history continues on the same row)
    before_snap := public.assignment_snapshot(existing);
    update public.shift_assignments
    set starts_at = s, ends_at = e, actual_user_id = w_user, actual_name = w_name,
        published = true, is_manually_edited = true, updated_at = clock_timestamp()
    where id = existing.id
    returning * into result;
  else
    insert into public.shift_assignments (
      work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at,
      source_name, planned_user_id, actual_user_id, actual_name, source, import_id, is_manually_edited, published
    ) values (d, cat, kind, pos, slot, s, e, null, null, w_user, w_name, 'manual', null, true, true)
    returning * into result;
  end if;

  insert into public.staffing_change_log (assignment_id, from_user_id, from_name, to_user_id, to_name, reason, change_kind, changed_by, changed_at, details)
  values (result.id, existing.actual_user_id, existing.actual_name, result.actual_user_id, result.actual_name, p_reason, 'manual_add', auth.uid(), clock_timestamp(),
          jsonb_build_object('before', before_snap, 'after', public.assignment_snapshot(result), 'reused_cancelled_marker', existing.id is not null));
  return result;
end;
$$;

create or replace function public.cancel_shift_assignment(p_assignment_id uuid, p_expected_updated_at timestamptz, p_reason text default null)
returns public.shift_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row public.shift_assignments;
  result public.shift_assignments;
begin
  if coalesce(public.get_my_role(), '') <> 'מנהל' then
    raise exception 'Only מנהל can edit the schedule' using errcode = '42501';
  end if;
  select * into old_row from public.shift_assignments where id = p_assignment_id for update;
  if old_row.id is null then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if not old_row.published then
    raise exception 'assignment_cancelled' using errcode = '22023';
  end if;
  if p_expected_updated_at is null or old_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'concurrent_change' using errcode = '40001';
  end if;
  perform public.require_edit_reason(old_row.work_date, p_reason);

  update public.shift_assignments set published = false, is_manually_edited = true, updated_at = clock_timestamp()
  where id = old_row.id returning * into result;

  insert into public.staffing_change_log (assignment_id, from_user_id, from_name, to_user_id, to_name, reason, change_kind, changed_by, changed_at, details)
  values (old_row.id, old_row.actual_user_id, old_row.actual_name, null, null, p_reason, 'manual_cancel', auth.uid(), clock_timestamp(),
          jsonb_build_object('before', public.assignment_snapshot(old_row), 'after', public.assignment_snapshot(result)));
  return result;
end;
$$;

create or replace function public.restore_shift_assignment(p_assignment_id uuid, p_expected_updated_at timestamptz, p_reason text default null)
returns public.shift_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row public.shift_assignments;
  result public.shift_assignments;
  moved_to uuid;
begin
  if coalesce(public.get_my_role(), '') <> 'מנהל' then
    raise exception 'Only מנהל can edit the schedule' using errcode = '42501';
  end if;
  select * into old_row from public.shift_assignments where id = p_assignment_id for update;
  if old_row.id is null then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if old_row.published then
    raise exception 'assignment_not_cancelled' using errcode = '22023';
  end if;
  if p_expected_updated_at is null or old_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'concurrent_change' using errcode = '40001';
  end if;
  perform public.require_edit_reason(old_row.work_date, p_reason);

  -- a marker left behind by a MOVE cannot come back while the moved copy is live
  select (l.details ->> 'moved_to_id')::uuid into moved_to
  from public.staffing_change_log l
  where l.assignment_id = old_row.id and l.change_kind = 'manual_cancel' and l.details ? 'moved_to_id'
  order by l.changed_at desc limit 1;
  if moved_to is not null and exists (select 1 from public.shift_assignments m where m.id = moved_to and m.published) then
    raise exception 'moved_away' using errcode = '22023';
  end if;

  update public.shift_assignments set published = true, updated_at = clock_timestamp()
  where id = old_row.id returning * into result;

  insert into public.staffing_change_log (assignment_id, from_user_id, from_name, to_user_id, to_name, reason, change_kind, changed_by, changed_at, details)
  values (old_row.id, null, null, result.actual_user_id, result.actual_name, p_reason, 'manual_restore', auth.uid(), clock_timestamp(),
          jsonb_build_object('before', public.assignment_snapshot(old_row), 'after', public.assignment_snapshot(result)));
  return result;
end;
$$;

revoke execute on function public.edit_shift_assignment(uuid, timestamptz, jsonb, text) from public, anon;
revoke execute on function public.add_shift_assignment(jsonb, text) from public, anon;
revoke execute on function public.cancel_shift_assignment(uuid, timestamptz, text) from public, anon;
revoke execute on function public.restore_shift_assignment(uuid, timestamptz, text) from public, anon;
grant execute on function public.edit_shift_assignment(uuid, timestamptz, jsonb, text) to authenticated;
grant execute on function public.add_shift_assignment(jsonb, text) to authenticated;
grant execute on function public.cancel_shift_assignment(uuid, timestamptz, text) to authenticated;
grant execute on function public.restore_shift_assignment(uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_shifts: a worker REPLACEMENT is decided by shift_worker_replaced, not
-- by is_manually_edited alone, so an hours / post edit (or a manual add whose
-- worker is an account) keeps the right attribution. Same signature and result
-- shape as phase21.

create or replace function public.get_my_shifts(p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_key text;
  explicit_linked boolean;
  exact_ok boolean;
  shifts jsonb;
  blocked text;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_week_start is null then
    raise exception 'Week start required';
  end if;

  select public.person_name_key(full_name) into my_key from public.profiles where id = me;

  explicit_linked := exists (select 1 from public.schedule_worker_links where user_id = me);

  exact_ok := coalesce(my_key, '') <> ''
    and (select count(*) from public.profiles p where public.person_name_key(p.full_name) = my_key) = 1
    and not exists (select 1 from public.schedule_worker_links l where l.source_key = my_key)
    and exists (
      select 1 from public.shift_assignments s
      where s.published and public.person_name_key(s.source_name) = my_key
    );

  with mine as (
    select a.id, a.work_date, a.shift_category, a.worker_kind, a.position, a.slot_index,
           a.starts_at, a.ends_at, a.source_name, a.actual_name, a.is_manually_edited
    from public.shift_assignments a
    where a.published
      and a.work_date between p_week_start - 1 and p_week_start + 7
      and (
        (public.shift_worker_replaced(a) and a.actual_user_id = me)
        or (
          not public.shift_worker_replaced(a)
          and (
            exists (
              select 1 from public.schedule_worker_links l
              where l.source_key = public.person_name_key(a.source_name) and l.user_id = me
            )
            or (exact_ok and public.person_name_key(a.source_name) = my_key)
          )
        )
      )
  )
  select coalesce(jsonb_agg(
           to_jsonb(m) || jsonb_build_object('overlaps', exists (
             select 1 from mine o where o.id <> m.id and least(m.ends_at, o.ends_at) > greatest(m.starts_at, o.starts_at)
           ))
           order by m.starts_at, m.position, m.slot_index), '[]'::jsonb)
  into shifts
  from mine m
  where m.work_date between p_week_start and p_week_start + 6;

  if coalesce(my_key, '') <> '' then
    if exists (select 1 from public.schedule_worker_links l where l.source_key = my_key and l.is_ambiguous) then
      blocked := 'shared_name';
    elsif not explicit_linked and (select count(*) from public.profiles p where public.person_name_key(p.full_name) = my_key) > 1 then
      blocked := 'duplicate_accounts';
    end if;
  end if;

  return jsonb_build_object(
    'linked', explicit_linked or exact_ok,
    'link_kind', case when explicit_linked then 'explicit' when exact_ok then 'exact' else null end,
    'blocked_reason', blocked,
    'shifts', shifts
  );
end;
$$;
