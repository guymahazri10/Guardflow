-- Apply after phase22. Save daily staffing and select one existing ready-to-air board.
begin;

create or replace function public.save_shift_setup(
  p_board_id uuid, p_expected_updated_at timestamptz, p_guard_names jsonb,
  p_work_date date, p_replacements jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  board public.roster_boards;
  category text;
  local_now timestamp := now() at time zone 'Asia/Jerusalem';
  change record;
  old_row public.shift_assignments;
  saved public.shift_assignments;
begin
  if coalesce(public.get_my_role(), '') not in ('מנהל','אחמ"ש') then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  select shift_type into strict category from public.roster_boards where id = p_board_id;
  -- All setup saves for the category acquire locks in the same order, even for different variants.
  perform id from public.roster_boards where shift_type = category order by id for update;
  select * into strict board from public.roster_boards where id = p_board_id;
  if board.updated_at is distinct from p_expected_updated_at or board.shift_type <> category then
    raise exception 'concurrent_change' using errcode = '40001';
  end if;
  if p_work_date is distinct from local_now::date - (case when category = 'night' and extract(hour from local_now) < 7 then 1 else 0 end) then
    raise exception 'shift_date_changed' using errcode = '22023';
  end if;
  if jsonb_typeof(p_guard_names) is distinct from 'object' or jsonb_typeof(p_replacements) is distinct from 'array'
     or jsonb_array_length(board.cols) = 0 or jsonb_array_length(board.rows) = 0 then
    raise exception 'incomplete_board' using errcode = '22023';
  end if;
  if exists (select from jsonb_each(p_guard_names) g
      where jsonb_typeof(g.value->'name') is distinct from 'string'
        or coalesce(jsonb_typeof(g.value->'user_id'), '') not in ('null','string')) then
    raise exception 'invalid_guard_names' using errcode = '22023';
  end if;
  for change in select * from jsonb_to_recordset(p_replacements)
    as r(id uuid, expected_at timestamptz, name text, user_id uuid) order by id
  loop
    if change.name is null or change.expected_at is null then
      raise exception 'invalid_replacement' using errcode = '22023';
    end if;
    select * into old_row from public.shift_assignments where id = change.id for update;
    if not found or not old_row.published or old_row.work_date <> p_work_date
       or old_row.shift_category <> category or old_row.updated_at is distinct from change.expected_at then
      raise exception 'concurrent_change' using errcode = '40001';
    end if;
    update public.shift_assignments set actual_user_id = change.user_id, actual_name = trim(change.name),
      worker_set_by_manager = true, is_manually_edited = true, updated_at = clock_timestamp()
      where id = change.id returning * into saved;
    insert into public.staffing_change_log
      (assignment_id, from_user_id, from_name, to_user_id, to_name, reason, change_kind, changed_by, details)
      values (saved.id, old_row.actual_user_id, old_row.actual_name, saved.actual_user_id, saved.actual_name,
        'עדכון ידני דרך מסך שיבוץ', 'manual_replace', auth.uid(),
        jsonb_build_object('before', public.assignment_snapshot(old_row), 'after', public.assignment_snapshot(saved)));
  end loop;
  update public.roster_boards set published = false, updated_at = clock_timestamp()
    where shift_type = category and id <> board.id and published;
  update public.roster_boards set guard_names = p_guard_names, published = true, updated_at = clock_timestamp()
    where id = board.id;
  if jsonb_array_length(p_replacements) > 0 then perform public.bump_schedule_revision(); end if;
end;
$$;
revoke all on function public.save_shift_setup(uuid,timestamptz,jsonb,date,jsonb) from public, anon;
grant execute on function public.save_shift_setup(uuid,timestamptz,jsonb,date,jsonb) to authenticated;
do $$ begin
  if not exists (select from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'roster_boards') then
    alter publication supabase_realtime add table public.roster_boards;
  end if;
end $$;
commit;
