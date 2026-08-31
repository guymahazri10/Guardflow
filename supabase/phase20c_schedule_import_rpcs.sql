-- supabase/phase20c_schedule_import_rpcs.sql

-- p_assignments: jsonb array of objects matching MatchedAssignment shape
-- (work_date, shift_category, worker_kind, position, slot_index, starts_at,
-- ends_at, source_name, planned_user_id).
-- p_resolutions: jsonb object mapping "work_date|shift_category|position|slot_index"
-- -> "revert_to_file" for rows the manager explicitly chose to overwrite
-- despite a manual-edit conflict. Any key not present defaults to "keep_manual".
create or replace function public.publish_schedule_import(
  p_import_id uuid,
  p_assignments jsonb,
  p_resolutions jsonb default '{}'::jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.get_my_role();
  incoming record;
  existing_row public.shift_assignments;
  identity_key text;
  resolution text;
  to_insert jsonb := '[]'::jsonb;
  to_update jsonb := '[]'::jsonb;
  to_skip_manual jsonb := '[]'::jsonb;
  conflicts jsonb := '[]'::jsonb;
  new_assignment_id uuid;
  week_start_date date;
begin
  if coalesce(caller_role, '') <> 'מנהל' then
    raise exception 'Only מנהל can publish a schedule import' using errcode = '42501';
  end if;

  for incoming in select * from jsonb_to_recordset(p_assignments) as x(
    work_date date,
    shift_category text,
    worker_kind text,
    position text,
    slot_index int,
    starts_at timestamptz,
    ends_at timestamptz,
    source_name text,
    planned_user_id uuid
  )
  loop
    identity_key := incoming.work_date::text || '|' || incoming.shift_category || '|' || incoming.position || '|' || incoming.slot_index::text;
    resolution := coalesce(p_resolutions ->> identity_key, 'keep_manual');

    select * into existing_row
    from public.shift_assignments
    where work_date = incoming.work_date
      and shift_category = incoming.shift_category
      and position = incoming.position
      and slot_index = incoming.slot_index;

    if existing_row.id is not null and existing_row.is_manually_edited and resolution <> 'revert_to_file' then
      to_skip_manual := to_skip_manual || jsonb_build_object('identity_key', identity_key);
      conflicts := conflicts || to_jsonb(incoming);
      continue;
    end if;

    if existing_row.id is null then
      to_insert := to_insert || to_jsonb(incoming);
    else
      to_update := to_update || to_jsonb(incoming);
    end if;

    if not p_dry_run then
      if existing_row.id is null then
        insert into public.shift_assignments (
          work_date, shift_category, worker_kind, position, slot_index,
          starts_at, ends_at, source_name, planned_user_id, actual_user_id,
          actual_name, source, import_id, is_manually_edited, published
        ) values (
          incoming.work_date, incoming.shift_category, incoming.worker_kind, incoming.position, incoming.slot_index,
          incoming.starts_at, incoming.ends_at, incoming.source_name, incoming.planned_user_id, incoming.planned_user_id,
          incoming.source_name, 'excel', p_import_id, false, true
        )
        returning id into new_assignment_id;

        insert into public.staffing_change_log (assignment_id, to_user_id, to_name, change_kind, changed_by)
        values (new_assignment_id, incoming.planned_user_id, incoming.source_name, 'import_update', auth.uid());
      else
        update public.shift_assignments
        set
          starts_at = incoming.starts_at,
          ends_at = incoming.ends_at,
          source_name = incoming.source_name,
          planned_user_id = incoming.planned_user_id,
          actual_user_id = case when resolution = 'revert_to_file' then incoming.planned_user_id else actual_user_id end,
          actual_name = case when resolution = 'revert_to_file' then incoming.source_name else actual_name end,
          is_manually_edited = case when resolution = 'revert_to_file' then false else is_manually_edited end,
          import_id = p_import_id,
          published = true,
          updated_at = now()
        where id = existing_row.id;

        insert into public.staffing_change_log (assignment_id, from_user_id, from_name, to_user_id, to_name, change_kind, changed_by)
        values (
          existing_row.id, existing_row.actual_user_id, existing_row.actual_name,
          incoming.planned_user_id, incoming.source_name,
          case when resolution = 'revert_to_file' then 'import_revert_to_file' else 'import_kept_manual' end,
          auth.uid()
        );
      end if;
    end if;
  end loop;

  -- Delete assignments from a prior import for weeks touched by this file
  -- that are no longer present in it and were never manually edited.
  if not p_dry_run then
    select (p_assignments -> 0 ->> 'work_date')::date into week_start_date;
    if week_start_date is not null then
      delete from public.shift_assignments sa
      where sa.work_date between week_start_date and week_start_date + interval '6 days'
        and sa.is_manually_edited = false
        and not exists (
          select 1 from jsonb_to_recordset(p_assignments) as x(work_date date, shift_category text, position text, slot_index int)
          where x.work_date = sa.work_date and x.shift_category = sa.shift_category
            and x.position = sa.position and x.slot_index = sa.slot_index
        );
    end if;

    update public.schedule_imports set status = 'published', updated_at = now() where id = p_import_id;
  end if;

  return jsonb_build_object(
    'to_insert', to_insert,
    'to_update', to_update,
    'to_skip_manual', to_skip_manual,
    'conflicts', conflicts
  );
end;
$$;

grant execute on function public.publish_schedule_import(uuid, jsonb, jsonb, boolean) to authenticated;

comment on function public.publish_schedule_import(uuid, jsonb, jsonb, boolean) is
  'Manager-only. Upserts shift_assignments from a parsed weekly import on the (work_date, shift_category, position, slot_index) identity key. Manually-edited rows are preserved unless explicitly resolved to revert_to_file. dry_run=true computes the diff without writing.';

create or replace function public.replace_assignment_worker(
  p_assignment_id uuid,
  p_new_user_id uuid,
  p_new_name text,
  p_reason text
)
returns public.shift_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.get_my_role();
  target_row public.shift_assignments;
  updated_row public.shift_assignments;
begin
  if coalesce(caller_role, '') not in ('מנהל', 'אחמ"ש') then
    raise exception 'Only מנהל or אחמ"ש can replace an assignment worker' using errcode = '42501';
  end if;

  select * into target_row from public.shift_assignments where id = p_assignment_id;
  if target_row.id is null then
    raise exception 'Assignment not found';
  end if;

  if caller_role = 'אחמ"ש' then
    if not (now() >= target_row.starts_at and now() < target_row.ends_at) then
      raise exception 'אחמ"ש יכול להחליף רק שיבוץ פעיל כעת' using errcode = '42501';
    end if;
  end if;

  update public.shift_assignments
  set
    actual_user_id = p_new_user_id,
    actual_name = p_new_name,
    is_manually_edited = true,
    updated_at = now()
  where id = p_assignment_id
  returning * into updated_row;

  insert into public.staffing_change_log (
    assignment_id, from_user_id, from_name, to_user_id, to_name, reason, change_kind, changed_by
  ) values (
    p_assignment_id, target_row.actual_user_id, target_row.actual_name, p_new_user_id, p_new_name, p_reason, 'manual_replace', auth.uid()
  );

  return updated_row;
end;
$$;

grant execute on function public.replace_assignment_worker(uuid, uuid, text, text) to authenticated;

comment on function public.replace_assignment_worker(uuid, uuid, text, text) is
  'Manager can replace any assignment worker. אחמ"ש can only replace the worker on an assignment currently in progress (now between starts_at and ends_at). Always logs to staffing_change_log.';
