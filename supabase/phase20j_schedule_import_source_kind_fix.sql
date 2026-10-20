-- supabase/phase20j_schedule_import_source_kind_fix.sql
--
-- publish_schedule_import has always hardcoded 'excel' as the
-- shift_assignments.source value on insert, regardless of the actual
-- schedule_imports.source_kind ('excel'/'pdf'/'image'/'json') for the
-- import being published. That mislabels every image- and JSON-sourced
-- assignment in the audit trail. Fix: look up the import's source_kind
-- and use it instead of the literal, and widen the CHECK constraint to
-- allow 'json' (schedule_imports.source_kind already allows it as of
-- phase20i_schedule_import_json_support.sql).

alter table public.shift_assignments
  drop constraint shift_assignments_source_check;

alter table public.shift_assignments
  add constraint shift_assignments_source_check
  check (source in ('excel', 'pdf', 'image', 'json', 'manual'));

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
  content_changed boolean;
  import_source_kind text;
begin
  if coalesce(caller_role, '') <> 'מנהל' then
    raise exception 'Only מנהל can publish a schedule import' using errcode = '42501';
  end if;

  select source_kind into import_source_kind from public.schedule_imports where id = p_import_id;
  if import_source_kind is null then
    raise exception 'Schedule import not found';
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
          incoming.source_name, import_source_kind, p_import_id, false, true
        )
        returning id into new_assignment_id;

        insert into public.staffing_change_log (assignment_id, to_user_id, to_name, change_kind, changed_by)
        values (new_assignment_id, incoming.planned_user_id, incoming.source_name, 'import_insert', auth.uid());
      else
        -- Compare against what the row's actual_user_id / actual_name / is_manually_edited
        -- would actually become (only reassigned on an explicit revert_to_file) rather than
        -- against incoming's raw planned_user_id / source_name, otherwise a keep_manual
        -- republish would be misdetected as "changed" whenever a prior manual replace had
        -- already made actual_* diverge from planned_user_id / source_name.
        content_changed :=
          existing_row.starts_at is distinct from incoming.starts_at
          or existing_row.ends_at is distinct from incoming.ends_at
          or existing_row.source_name is distinct from incoming.source_name
          or existing_row.planned_user_id is distinct from incoming.planned_user_id
          or existing_row.actual_user_id is distinct from (case when resolution = 'revert_to_file' then incoming.planned_user_id else existing_row.actual_user_id end)
          or existing_row.actual_name is distinct from (case when resolution = 'revert_to_file' then incoming.source_name else existing_row.actual_name end)
          or existing_row.is_manually_edited is distinct from (case when resolution = 'revert_to_file' then false else existing_row.is_manually_edited end);

        if resolution = 'revert_to_file' or content_changed then
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

          -- By this point either resolution = 'revert_to_file' (a manually-edited
          -- row the manager explicitly chose to overwrite), or the earlier
          -- to_skip_manual/continue branch already filtered out every row where
          -- existing_row.is_manually_edited was true and resolution wasn't
          -- revert_to_file — so a plain content update reaching here always
          -- means existing_row.is_manually_edited was false. Label accordingly:
          -- 'import_kept_manual' is reserved for an actual manually-edited row,
          -- never used for an ordinary content change.
          insert into public.staffing_change_log (assignment_id, from_user_id, from_name, to_user_id, to_name, change_kind, changed_by)
          values (
            existing_row.id, existing_row.actual_user_id, existing_row.actual_name,
            incoming.planned_user_id, incoming.source_name,
            case
              when resolution = 'revert_to_file' then 'import_revert_to_file'
              when existing_row.is_manually_edited then 'import_kept_manual'
              else 'import_update'
            end,
            auth.uid()
          );
        end if;
      end if;
    end if;
  end loop;

  -- Delete assignments from a prior import for weeks touched by this file
  -- that are no longer present in it and were never manually edited.
  if not p_dry_run then
    -- Read the authoritative week_start from schedule_imports itself rather
    -- than p_assignments -> 0, which depends on grid iteration order and can
    -- be wrong if the first parsed row isn't actually Sunday — that would
    -- sweep non-manually-edited rows out of the wrong week.
    select week_start into week_start_date from public.schedule_imports where id = p_import_id;
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
