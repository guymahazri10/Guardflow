-- Apply after phase22_manager_schedule_edits.sql.
-- A single transaction changes the staffed board and its dated assignments.
create or replace function public.save_shift_setup(
  p_board_id uuid, p_expected_updated_at timestamptz, p_guard_names jsonb, p_changes jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  board public.roster_boards;
  previous public.shift_assignments;
  updated public.shift_assignments;
  change jsonb;
  caller text := public.get_my_role();
  local_now timestamp := now() at time zone 'Asia/Jerusalem';
  work_day date := local_now::date;
begin
  if coalesce(caller, '') not in ('מנהל', 'אחמ"ש') then
    raise exception 'Staffing permission required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_guard_names) is distinct from 'object'
     or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Invalid staffing data' using errcode = '22023';
  end if;

  -- Serialize setup saves, including concurrent selections of different variants.
  perform pg_advisory_xact_lock(hashtextextended('public.save_shift_setup', 0));
  select * into strict board from public.roster_boards where id = p_board_id for update;
  if board.updated_at is distinct from p_expected_updated_at then
    raise exception 'concurrent_change' using errcode = '40001';
  end if;
  if jsonb_array_length(board.cols) = 0 or jsonb_array_length(board.rows) = 0 then
    raise exception 'Board has no schedule' using errcode = '22023';
  end if;
  if board.shift_type = 'night' and local_now::time < time '07:00' then
    work_day := work_day - 1;
  end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    select * into strict previous from public.shift_assignments
      where id = (change->>'id')::uuid for update;
    if not previous.published or previous.work_date <> work_day
       or previous.shift_category <> board.shift_type
       or previous.updated_at is distinct from (change->>'updated_at')::timestamptz then
      raise exception 'concurrent_change' using errcode = '40001';
    end if;
    update public.shift_assignments
       set actual_user_id = (change->>'user_id')::uuid,
           actual_name = change->>'name', worker_set_by_manager = true,
           is_manually_edited = true, updated_at = clock_timestamp()
     where id = previous.id returning * into updated;
    insert into public.staffing_change_log
      (assignment_id, from_user_id, from_name, to_user_id, to_name, reason,
       change_kind, changed_by, changed_at, details)
    values (previous.id, previous.actual_user_id, previous.actual_name,
       updated.actual_user_id, updated.actual_name, 'עדכון ידני דרך מסך שיבוץ',
       'manual_replace', auth.uid(), clock_timestamp(),
       jsonb_build_object('before', public.assignment_snapshot(previous), 'after', public.assignment_snapshot(updated)));
  end loop;
  if jsonb_array_length(p_changes) > 0 then perform public.bump_schedule_revision(); end if;
  update public.roster_boards set published = false, updated_at = clock_timestamp()
    where shift_type = board.shift_type and id <> board.id and published;
  update public.roster_boards set published = true, guard_names = p_guard_names, updated_at = clock_timestamp()
    where id = board.id;
end;
$$;
revoke all on function public.save_shift_setup(uuid,timestamptz,jsonb,jsonb) from public, anon;
grant execute on function public.save_shift_setup(uuid,timestamptz,jsonb,jsonb) to authenticated;

-- Live viewers already subscribe to this table; enable delivery for the table.
do $$
begin
  if not exists (select from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'roster_boards') then
    alter publication supabase_realtime add table public.roster_boards;
  end if;
end;
$$;
