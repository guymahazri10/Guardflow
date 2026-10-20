-- supabase/phase20k_schedule_import_diff_and_safety.sql
--
-- Built directly on top of phase20j_schedule_import_source_kind_fix.sql's
-- version of publish_schedule_import (which added import_source_kind and the
-- 'json' source value) — this migration must be applied after that one, not
-- instead of it, or it will silently drop the source_kind fix.
--
-- The dry-run preview screen was designed (see
-- docs/superpowers/specs/2026-08-31-weekly-schedule-import-design.md) to be
-- backed by a real p_dry_run=true call to this RPC. In practice the RPC
-- itself was never capable of that: it never returned which rows would be
-- deleted, it classified an unchanged row the same as a changed one, it let
-- an empty assignment list through (which the delete-sweep would have turned
-- into "delete the whole week"), it didn't enforce that every row actually
-- belongs to the import's own week, and a non-manually-edited row whose
-- worker was corrected by a re-upload never updated actual_user_id/
-- actual_name (only revert_to_file did, which only applies to manually-
-- edited rows). This migration fixes all of that in the RPC itself, and adds
-- an explicit two-step delete confirmation so the client's "please confirm
-- these deletions" UI is actually enforced server-side, not just displayed.

drop function if exists public.publish_schedule_import(uuid, jsonb, jsonb, boolean);

create or replace function public.publish_schedule_import(
  p_import_id uuid,
  p_assignments jsonb,
  p_resolutions jsonb default '{}'::jsonb,
  p_confirmed_delete_ids uuid[] default '{}'::uuid[],
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
  unchanged jsonb := '[]'::jsonb;
  to_keep_manual jsonb := '[]'::jsonb;
  to_delete jsonb := '[]'::jsonb;
  conflicts jsonb := '[]'::jsonb;
  seen_keys text[] := '{}';
  delete_ids uuid[] := '{}';
  new_assignment_id uuid;
  week_start_date date;
  week_end_date date;
  effective_actual_user_id uuid;
  effective_actual_name text;
  content_changed boolean;
  import_source_kind text;
  extra_row public.shift_assignments;
  unconfirmed_count int;
begin
  if coalesce(caller_role, '') <> 'מנהל' then
    raise exception 'Only מנהל can publish a schedule import' using errcode = '42501';
  end if;

  select source_kind, week_start into import_source_kind, week_start_date
  from public.schedule_imports where id = p_import_id;
  if import_source_kind is null then
    raise exception 'Schedule import not found';
  end if;
  week_end_date := week_start_date + 6;

  -- An empty assignment list would otherwise sail straight through and let
  -- the delete-sweep below remove every previously-imported row for the
  -- week — a partial file or a cropped image must never be able to wipe a
  -- whole week's schedule this way. Rejected in both dry-run and real mode
  -- so the preview can't even be built on top of an empty list either.
  if jsonb_array_length(p_assignments) = 0 then
    raise exception 'לא ניתן לפרסם רשימת שיבוצים ריקה — פעולה זו הייתה מוחקת את כל השבוע. יש לבטל את הייבוא במקום.';
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
    -- Belt-and-suspenders: the client already restricts the file to the
    -- manager's selected week before this is ever called, but a row that
    -- somehow lands outside week_start..week_start+6 must never be written
    -- under this import's week regardless of how it got here.
    if incoming.work_date < week_start_date or incoming.work_date > week_end_date then
      raise exception 'שורה עם תאריך % מחוץ לשבוע %-%', incoming.work_date, week_start_date, week_end_date;
    end if;

    identity_key := incoming.work_date::text || '|' || incoming.shift_category || '|' || incoming.position || '|' || incoming.slot_index::text;
    seen_keys := array_append(seen_keys, identity_key);
    resolution := coalesce(p_resolutions ->> identity_key, 'keep_manual');

    select * into existing_row
    from public.shift_assignments
    where work_date = incoming.work_date
      and shift_category = incoming.shift_category
      and position = incoming.position
      and slot_index = incoming.slot_index;

    if existing_row.id is not null and existing_row.is_manually_edited and resolution <> 'revert_to_file' then
      to_keep_manual := to_keep_manual || jsonb_build_object(
        'id', existing_row.id, 'work_date', existing_row.work_date, 'shift_category', existing_row.shift_category,
        'worker_kind', existing_row.worker_kind, 'position', existing_row.position, 'slot_index', existing_row.slot_index,
        'starts_at', existing_row.starts_at, 'ends_at', existing_row.ends_at, 'source_name', existing_row.source_name,
        'planned_user_id', existing_row.planned_user_id, 'actual_user_id', existing_row.actual_user_id, 'actual_name', existing_row.actual_name
      );
      -- A genuine conflict is when the file's own content disagrees with what
      -- the manual edit kept — not merely "a manual edit exists here", which
      -- is the common, expected case for every row in to_keep_manual.
      if existing_row.planned_user_id is distinct from incoming.planned_user_id
        or existing_row.source_name is distinct from incoming.source_name
        or existing_row.starts_at is distinct from incoming.starts_at
        or existing_row.ends_at is distinct from incoming.ends_at then
        conflicts := conflicts || to_jsonb(incoming);
      end if;
      continue;
    end if;

    -- For a row that is NOT manually edited, the import is the sole source
    -- of truth for who is actually working it — actual_* must track
    -- planned_*/source_name directly. Previously actual_* only ever changed
    -- via an explicit revert_to_file resolution (meant for manually-edited
    -- rows), so a plain re-upload correcting a wrong name never actually
    -- changed who the live board and audit log showed as working.
    effective_actual_user_id := incoming.planned_user_id;
    effective_actual_name := incoming.source_name;

    if existing_row.id is null then
      to_insert := to_insert || jsonb_build_object(
        'id', null, 'work_date', incoming.work_date, 'shift_category', incoming.shift_category,
        'worker_kind', incoming.worker_kind, 'position', incoming.position, 'slot_index', incoming.slot_index,
        'starts_at', incoming.starts_at, 'ends_at', incoming.ends_at, 'source_name', incoming.source_name,
        'planned_user_id', incoming.planned_user_id, 'actual_user_id', effective_actual_user_id, 'actual_name', effective_actual_name
      );

      if not p_dry_run then
        insert into public.shift_assignments (
          work_date, shift_category, worker_kind, position, slot_index,
          starts_at, ends_at, source_name, planned_user_id, actual_user_id,
          actual_name, source, import_id, is_manually_edited, published
        ) values (
          incoming.work_date, incoming.shift_category, incoming.worker_kind, incoming.position, incoming.slot_index,
          incoming.starts_at, incoming.ends_at, incoming.source_name, incoming.planned_user_id, effective_actual_user_id,
          effective_actual_name, import_source_kind, p_import_id, false, true
        )
        returning id into new_assignment_id;

        insert into public.staffing_change_log (assignment_id, to_user_id, to_name, change_kind, changed_by)
        values (new_assignment_id, incoming.planned_user_id, incoming.source_name, 'import_insert', auth.uid());
      end if;
      continue;
    end if;

    -- By this point existing_row.is_manually_edited is either already false,
    -- or true with resolution = 'revert_to_file' (the only other case was
    -- handled by the to_keep_manual branch above and never reaches here) —
    -- either way the row's effective is_manually_edited after this write is
    -- always false. Compared explicitly below so a revert that resets only
    -- the flag (the file's own content already matches) is still classified
    -- as a change and the flag actually gets cleared, not left true.
    content_changed :=
      existing_row.starts_at is distinct from incoming.starts_at
      or existing_row.ends_at is distinct from incoming.ends_at
      or existing_row.source_name is distinct from incoming.source_name
      or existing_row.planned_user_id is distinct from incoming.planned_user_id
      or existing_row.actual_user_id is distinct from effective_actual_user_id
      or existing_row.actual_name is distinct from effective_actual_name
      or existing_row.is_manually_edited is distinct from false
      -- A row previously written by one source_kind (e.g. an image import)
      -- re-confirmed via a different one (e.g. Excel) should have its
      -- audit-trail source label updated too, not just its content fields.
      or existing_row.source is distinct from import_source_kind;

    if not content_changed then
      unchanged := unchanged || jsonb_build_object(
        'id', existing_row.id, 'work_date', existing_row.work_date, 'shift_category', existing_row.shift_category,
        'worker_kind', existing_row.worker_kind, 'position', existing_row.position, 'slot_index', existing_row.slot_index,
        'starts_at', existing_row.starts_at, 'ends_at', existing_row.ends_at, 'source_name', existing_row.source_name,
        'planned_user_id', existing_row.planned_user_id, 'actual_user_id', existing_row.actual_user_id, 'actual_name', existing_row.actual_name
      );

      if not p_dry_run then
        update public.shift_assignments set import_id = p_import_id, published = true where id = existing_row.id;
      end if;
      continue;
    end if;

    to_update := to_update || jsonb_build_object(
      'id', existing_row.id, 'work_date', incoming.work_date, 'shift_category', incoming.shift_category,
      'worker_kind', incoming.worker_kind, 'position', incoming.position, 'slot_index', incoming.slot_index,
      'starts_at', incoming.starts_at, 'ends_at', incoming.ends_at, 'source_name', incoming.source_name,
      'planned_user_id', incoming.planned_user_id, 'actual_user_id', effective_actual_user_id, 'actual_name', effective_actual_name
    );

    if not p_dry_run then
      update public.shift_assignments
      set
        starts_at = incoming.starts_at,
        ends_at = incoming.ends_at,
        source_name = incoming.source_name,
        planned_user_id = incoming.planned_user_id,
        actual_user_id = effective_actual_user_id,
        actual_name = effective_actual_name,
        is_manually_edited = false,
        source = import_source_kind,
        import_id = p_import_id,
        published = true,
        updated_at = now()
      where id = existing_row.id;

      insert into public.staffing_change_log (assignment_id, from_user_id, from_name, to_user_id, to_name, change_kind, changed_by)
      values (existing_row.id, existing_row.actual_user_id, existing_row.actual_name, effective_actual_user_id, effective_actual_name, 'import_update', auth.uid());
    end if;
  end loop;

  -- to_keep_manual, second source: a manually-edited row in this week that
  -- has no matching row in the file at all (the manager edited it, and the
  -- new file just doesn't mention that slot). The loop above only ever
  -- visits rows that have a matching incoming row, so without this pass
  -- these rows would never appear anywhere in the diff — invisible to the
  -- client's overlap check even though they remain in the database exactly
  -- as before (they're excluded from the delete-sweep by is_manually_edited
  -- = true, same as always).
  for extra_row in
    select * from public.shift_assignments sa
    where sa.work_date between week_start_date and week_end_date
      and sa.is_manually_edited = true
      and not (sa.work_date::text || '|' || sa.shift_category || '|' || sa.position || '|' || sa.slot_index::text = any(seen_keys))
  loop
    to_keep_manual := to_keep_manual || jsonb_build_object(
      'id', extra_row.id, 'work_date', extra_row.work_date, 'shift_category', extra_row.shift_category,
      'worker_kind', extra_row.worker_kind, 'position', extra_row.position, 'slot_index', extra_row.slot_index,
      'starts_at', extra_row.starts_at, 'ends_at', extra_row.ends_at, 'source_name', extra_row.source_name,
      'planned_user_id', extra_row.planned_user_id, 'actual_user_id', extra_row.actual_user_id, 'actual_name', extra_row.actual_name
    );
  end loop;

  -- Deletions: rows that came from a *prior import* (import_id is not null —
  -- never sweep a row some other mechanism created), aren't manually edited,
  -- and are no longer present in this file.
  for extra_row in
    select * from public.shift_assignments sa
    where sa.work_date between week_start_date and week_end_date
      and sa.is_manually_edited = false
      and sa.import_id is not null
      and not (sa.work_date::text || '|' || sa.shift_category || '|' || sa.position || '|' || sa.slot_index::text = any(seen_keys))
  loop
    to_delete := to_delete || jsonb_build_object(
      'id', extra_row.id, 'work_date', extra_row.work_date, 'shift_category', extra_row.shift_category,
      'worker_kind', extra_row.worker_kind, 'position', extra_row.position, 'slot_index', extra_row.slot_index,
      'starts_at', extra_row.starts_at, 'ends_at', extra_row.ends_at, 'source_name', extra_row.source_name,
      'planned_user_id', extra_row.planned_user_id, 'actual_user_id', extra_row.actual_user_id, 'actual_name', extra_row.actual_name
    );
    delete_ids := array_append(delete_ids, extra_row.id);
  end loop;

  if not p_dry_run and array_length(delete_ids, 1) is not null then
    -- Every row about to be deleted must have been explicitly confirmed by
    -- the caller (the ids the manager checked off against the last dry-run's
    -- to_delete list). If a new deletion has appeared since — someone else
    -- reverted a manual edit, or time simply passed and the sweep window
    -- shifted — abort the whole publish rather than silently deleting more
    -- than what was shown and approved.
    select count(*) into unconfirmed_count
    from unnest(delete_ids) as d(id)
    where not (d.id = any(p_confirmed_delete_ids));

    if unconfirmed_count > 0 then
      raise exception 'התגלו מחיקות חדשות שלא אושרו מאז הבדיקה האחרונה — יש להריץ בדיקה מחדש (dry run) ולאשר מחדש לפני פרסום.';
    end if;

    delete from public.shift_assignments where id = any(delete_ids);
  end if;

  -- dry_run=true must be a pure read path with zero side effects — every
  -- write above is already gated on `not p_dry_run`, and so is this one.
  -- (An earlier revision of this migration also advanced schedule_imports to
  -- 'ready_for_review' on a successful dry-run; that write is intentionally
  -- dropped here so dry-run truly writes nothing, full stop. The row simply
  -- stays 'processing' until an actual publish sets 'published'.)
  if not p_dry_run then
    update public.schedule_imports set status = 'published', updated_at = now() where id = p_import_id;
  end if;

  return jsonb_build_object(
    'to_insert', to_insert,
    'to_update', to_update,
    'unchanged', unchanged,
    'to_keep_manual', to_keep_manual,
    'to_delete', to_delete,
    'conflicts', conflicts
  );
end;
$$;

-- publish_schedule_import and replace_assignment_worker were never
-- explicitly revoked from PUBLIC — Postgres grants EXECUTE on a new function
-- to PUBLIC by default, which includes anon. The only thing stopping an
-- unauthenticated/non-manager caller today is the caller_role check inside
-- the function body. Add the DB-level grant as a second, independent layer.
revoke execute on function public.publish_schedule_import(uuid, jsonb, jsonb, uuid[], boolean) from public, anon;
grant execute on function public.publish_schedule_import(uuid, jsonb, jsonb, uuid[], boolean) to authenticated;

revoke execute on function public.replace_assignment_worker(uuid, uuid, text, text) from public, anon;
grant execute on function public.replace_assignment_worker(uuid, uuid, text, text) to authenticated;
