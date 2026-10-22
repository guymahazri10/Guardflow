-- supabase/phase20k_rollback.sql
--
-- Reverse of phase20j + phase20k, written against what production had BEFORE
-- either was applied (publish_schedule_import as of phase20c with a 4-parameter
-- signature and 'excel' hardcoded; shift_assignments_source_check without
-- 'json'). Nothing here touches row data.
--
-- ORDER MATTERS. Do these in sequence and stop if a check fails:
--
--   STEP 1 (not SQL)  Put the CODE back first: Vercel rollback to the previous
--                     production deployment (dpl_5Z4gpusci9LsN29KeR1pGcHeqAkH,
--                     commit 8d73ceb). Then verify the old client works: open
--                     the import screen and run a preview. The old client calls
--                     the 4-parameter function, which this migration set never
--                     drops, so it works the whole time.
--   STEP 2 (PART A)   Only after STEP 1 is verified, and only if needed:
--                     remove the new 5-parameter function. Refuses to run
--                     unless you confirm the client was reverted.
--   STEP 3 (PART B)   Only if needed: restore the pre-phase20j function body
--                     and, if no row uses the 'json' source, the old constraint.
--
-- Never remove a function the live client still calls. The 4-parameter
-- function is never removed by this file (see PART C, which is cleanup only).

-- ---------------------------------------------------------------- PART A ---
-- Undoes phase20k. Requires:  set guardflow.client_reverted = 'yes';
do $$
begin
  if coalesce(current_setting('guardflow.client_reverted', true), '') <> 'yes' then
    raise exception 'Refusing to drop the new publish_schedule_import: first roll the CODE back (Vercel) and verify the old client, then run: set guardflow.client_reverted = ''yes'';';
  end if;
end $$;
drop function if exists public.publish_schedule_import(uuid, jsonb, jsonb, uuid[], boolean);
-- The EXECUTE grants phase20k added (revoke from public/anon, grant to
-- authenticated) are intentionally left in place: they only close access to
-- anon, and `authenticated` keeps working.

-- ---------------------------------------------------------------- PART B ---
CREATE OR REPLACE FUNCTION public.publish_schedule_import(p_import_id uuid, p_assignments jsonb, p_resolutions jsonb DEFAULT '{}'::jsonb, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        values (new_assignment_id, incoming.planned_user_id, incoming.source_name, 'import_insert', auth.uid());
      else
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

  if not p_dry_run then
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
$function$;

do $$
begin
  if exists (select 1 from public.shift_assignments where source = 'json') then
    raise notice 'shift_assignments_source_check NOT narrowed: rows with source = json exist';
  else
    alter table public.shift_assignments drop constraint shift_assignments_source_check;
    alter table public.shift_assignments
      add constraint shift_assignments_source_check
      check (source = any (array['excel'::text, 'pdf'::text, 'image'::text, 'manual'::text]));
  end if;
end $$;

-- ---------------------------------------------------------------- PART C ---
-- Cleanup only, once nothing calls the four-parameter form any more:
-- drop function if exists public.publish_schedule_import(uuid, jsonb, jsonb, boolean);
