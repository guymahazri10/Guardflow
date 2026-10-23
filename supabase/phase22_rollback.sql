-- Reverses phase22_manager_schedule_edits.sql. ORDER: roll the CODE back first
-- (the old client never calls these functions), then run this.
--
-- get_my_shifts goes back to the phase21 body below. The history written by the
-- new RPCs is kept: rows with the new change kinds are NOT deleted, so the
-- change_kind constraint is only narrowed when none of them exist.

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
        (a.is_manually_edited and a.actual_user_id = me)
        or (
          not a.is_manually_edited
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

drop function if exists public.restore_shift_assignment(uuid, timestamptz, text);
drop function if exists public.cancel_shift_assignment(uuid, timestamptz, text);
drop function if exists public.add_shift_assignment(jsonb, text);
drop function if exists public.edit_shift_assignment(uuid, timestamptz, jsonb, text);
drop function if exists public.require_edit_reason(date, text);
drop function if exists public.validate_shift_fields(date, text, text, text, int, timestamptz, timestamptz);
drop function if exists public.assignment_snapshot(public.shift_assignments);
drop function if exists public.shift_worker_replaced(public.shift_assignments);

-- Keep the history columns / kinds if any manual-edit history exists.
do $$
begin
  if not exists (
    select 1 from public.staffing_change_log
    where change_kind in ('manual_edit', 'manual_add', 'manual_cancel', 'manual_restore', 'manual_move')
  ) then
    alter table public.staffing_change_log drop constraint staffing_change_log_change_kind_check;
    alter table public.staffing_change_log add constraint staffing_change_log_change_kind_check check (
      change_kind in ('manual_replace', 'import_insert', 'import_update', 'import_kept_manual', 'import_revert_to_file')
    );
    alter table public.staffing_change_log drop column details;
  else
    raise notice 'manual-edit history exists: keeping staffing_change_log.details and the new change kinds';
  end if;
end $$;
