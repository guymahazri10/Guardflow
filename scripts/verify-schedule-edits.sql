-- scripts/verify-schedule-edits.sql
--
-- Regression checks for phase22_manager_schedule_edits.sql: manager edits of the
-- published schedule (hours, worker, move, add, cancel, restore), history,
-- concurrency, permissions, "My shifts" attribution, and a re-upload of the
-- same / an updated Excel. Everything runs in ONE transaction that is rolled
-- back; callers are impersonated with set_config('request.jwt.claims') / SET
-- LOCAL ROLE, so do not run this against a database you care about.
-- Run by scripts/verify-schedule-edits.sh. All names are invented.
begin;

-- ---- fixtures ---------------------------------------------------------------
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  guard uuid := '00000000-0000-0000-0000-000000000003';
begin
  delete from public.schedule_worker_links;
  update public.profiles set full_name = 'אורי כהן' where id = guard;
  update public.profiles set full_name = 'דנה לוי' where id = commander;
  update public.profiles set full_name = 'מנהל בדיקה' where id = manager;
end $$;

create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create or replace function pg_temp.mine(p_user uuid, p_week date) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user(p_user);
  r := public.get_my_shifts(p_week);
  reset role;
  return r;
end $$;

-- ids of the user's shifts in a week, as a sorted text for easy asserts
create or replace function pg_temp.mine_ids(p_user uuid, p_week date) returns text language sql as $$
  select coalesce(string_agg(s->>'position' || '@' || (s->>'work_date') || '/' || (s->>'starts_at'), ' | ' order by s->>'starts_at'), '')
  from jsonb_array_elements(pg_temp.mine(p_user, p_week)->'shifts') s
$$;

create or replace function pg_temp.row_at(p_date date, p_cat text, p_pos text, p_slot int) returns public.shift_assignments language sql as $$
  select * from public.shift_assignments where work_date = p_date and shift_category = p_cat and position = p_pos and slot_index = p_slot
$$;

-- publish a file for the week through the REAL RPC (as the manager)
create or replace function pg_temp.publish_file(p_import uuid, p_rows jsonb, p_resolutions jsonb default '{}', p_confirm uuid[] default '{}', p_dry boolean default false) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000001');
  r := public.publish_schedule_import(p_import_id => p_import, p_assignments => p_rows, p_resolutions => p_resolutions,
         p_confirmed_delete_ids => p_confirm, p_dry_run => p_dry);
  reset role;
  return r;
end $$;

create or replace function pg_temp.file_row(d date, cat text, kind text, pos text, slot int, s timestamptz, e timestamptz, name text) returns jsonb language sql as $$
  select jsonb_build_object('work_date', d, 'shift_category', cat, 'worker_kind', kind, 'position', pos, 'slot_index', slot,
                            'starts_at', s, 'ends_at', e, 'source_name', name, 'planned_user_id', null)
$$;

-- the week used by every scenario (a Sunday in the far future)
create or replace function pg_temp.W() returns date language sql as $$ select date '2032-01-04' $$;

-- the "Excel": five rows
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  w date := pg_temp.W();
  v_import uuid;
begin
  perform pg_temp.as_user(manager);
  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (w, 'excel', 'test/e', 'e.xlsx', 'e-hash', manager) returning id into v_import;
  reset role;
  perform set_config('test.import', v_import::text, false);
  perform pg_temp.publish_file(v_import, jsonb_build_array(
    pg_temp.file_row(w,   'morning',  'מאבטח','AB',0,(w||' 06:45+02')::timestamptz,(w||' 15:10+02')::timestamptz,'אורי כהן'),
    pg_temp.file_row(w+1, 'morning',  'מאבטח','AB',0,((w+1)||' 06:45+02')::timestamptz,((w+1)||' 15:10+02')::timestamptz,'דנה לוי'),
    pg_temp.file_row(w+2, 'night',    'מאבטח','לובי תחתון',0,((w+2)||' 22:45+02')::timestamptz,((w+3)||' 07:10+02')::timestamptz,'אורי כהן'),
    pg_temp.file_row(w+3, 'morning',  'מאבטח','CD',0,((w+3)||' 06:45+02')::timestamptz,((w+3)||' 15:10+02')::timestamptz,'אורי כהן'),
    pg_temp.file_row(w+4, 'afternoon','מאבטח','EFG',0,((w+4)||' 14:45+02')::timestamptz,((w+4)||' 23:10+02')::timestamptz,'גיא ללא חשבון')
  ));
  assert (select count(*) from public.shift_assignments where work_date between w and w + 6) = 5, 'fixture: expected 5 imported rows';
end $$;

-- ===========================================================================
-- E1: an hours edit keeps the Excel record, writes history with before/after,
--     and "My shifts" attribution survives (the worker is NOT replaced)
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  r public.shift_assignments; before_row public.shift_assignments; lg record;
begin
  before_row := pg_temp.row_at(w, 'morning', 'AB', 0);
  assert pg_temp.mine_ids(guard, w) like '%AB@2032-01-04%', 'E1 setup: guard should see the imported shift';
  perform pg_temp.as_user(manager);
  r := public.edit_shift_assignment(before_row.id, before_row.updated_at,
         jsonb_build_object('starts_at', (w||' 07:00+02')::timestamptz, 'ends_at', (w||' 15:00+02')::timestamptz), null);
  reset role;
  assert r.starts_at = (w||' 07:00+02')::timestamptz and r.is_manually_edited, 'E1 FAILED: hours not changed / not flagged';
  assert r.source_name = 'אורי כהן' and r.import_id = before_row.import_id and r.source = 'excel', 'E1 FAILED: source record changed';
  assert r.updated_at > before_row.updated_at, 'E1 FAILED: updated_at not bumped';
  select * into lg from public.staffing_change_log where assignment_id = r.id order by changed_at desc limit 1;
  assert lg.change_kind = 'manual_edit' and lg.changed_by = manager, 'E1 FAILED: history kind/changed_by';
  assert (lg.details->'before'->>'starts_at')::timestamptz = before_row.starts_at and (lg.details->'before'->>'is_manually_edited')::boolean = false,
         'E1 FAILED: history must keep the original (Excel) hours in "before"';
  assert (lg.details->'after'->>'starts_at')::timestamptz = r.starts_at, 'E1 FAILED: history "after"';
  assert pg_temp.mine_ids(guard, w) like '%AB@2032-01-04%' and (pg_temp.mine(guard, w)->'shifts'->0->>'starts_at')::timestamptz = r.starts_at,
         'E1 FAILED: hours-only edit must keep the shift in My shifts with the new hours';
  assert not public.shift_worker_replaced(r), 'E1 FAILED: an hours edit is not a worker replacement';
  raise notice 'E1 PASSED';
end $$;

-- ===========================================================================
-- E2: attribution survives an hours edit also through an explicit link, and for a
--     manually added shift whose worker is an account
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  r public.shift_assignments;
begin
  perform pg_temp.as_user(manager);
  perform public.link_schedule_worker('גיא ללא חשבון', commander);
  reset role;
  assert pg_temp.mine_ids(commander, w) like '%EFG@2032-01-08%', 'E2 setup: explicit link should give the commander the shift';
  r := pg_temp.row_at(w+4, 'afternoon', 'EFG', 0);
  perform pg_temp.as_user(manager);
  r := public.edit_shift_assignment(r.id, r.updated_at, jsonb_build_object('ends_at', ((w+4)||' 23:30+02')::timestamptz), 'later finish');
  reset role;
  assert pg_temp.mine_ids(commander, w) like '%EFG@2032-01-08%', 'E2 FAILED: explicit-link attribution lost after an hours edit';

  -- manual add for the guard account, then an hours edit of that added row
  perform pg_temp.as_user(manager);
  r := public.add_shift_assignment(jsonb_build_object('work_date', w+5, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
          'starts_at', ((w+5)||' 06:45+02')::timestamptz, 'ends_at', ((w+5)||' 15:10+02')::timestamptz, 'worker', jsonb_build_object('user_id', guard, 'name', 'אורי כהן')), null);
  reset role;
  assert r.source = 'manual' and r.import_id is null and r.source_name is null, 'E2 FAILED: manual add must be a manual row without Excel data';
  assert pg_temp.mine_ids(guard, w) like '%@2032-01-09%', 'E2 FAILED: added shift must show for its account';
  perform pg_temp.as_user(manager);
  r := public.edit_shift_assignment(r.id, r.updated_at, jsonb_build_object('ends_at', ((w+5)||' 16:00+02')::timestamptz), null);
  reset role;
  assert pg_temp.mine_ids(guard, w) like '%@2032-01-09%', 'E2 FAILED: attribution of an added row lost after an hours edit';
  raise notice 'E2 PASSED';
end $$;

-- ===========================================================================
-- E3: replacing the worker: the shift moves to the replacement and leaves the original;
--     a free-text replacement belongs to nobody; replacing back restores the original owner
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  r public.shift_assignments;
begin
  r := pg_temp.row_at(w+1, 'morning', 'AB', 0);
  assert pg_temp.mine_ids(commander, w) like '%AB@2032-01-05%', 'E3 setup: commander owns the Monday shift by name';
  perform pg_temp.as_user(manager);
  r := public.edit_shift_assignment(r.id, r.updated_at, jsonb_build_object('worker', jsonb_build_object('user_id', guard, 'name', 'אורי כהן')), 'sick leave');
  reset role;
  assert pg_temp.mine_ids(guard, w) like '%AB@2032-01-05%', 'E3 FAILED: replacement account does not see the shift';
  assert pg_temp.mine_ids(commander, w) not like '%AB@2032-01-05%', 'E3 FAILED: replaced worker still sees the shift';
  assert r.source_name = 'דנה לוי', 'E3 FAILED: the Excel name must stay as read';

  perform pg_temp.as_user(manager);
  r := public.edit_shift_assignment(r.id, r.updated_at, jsonb_build_object('worker', jsonb_build_object('user_id', null, 'name', 'מחליף חופשי')), null);
  reset role;
  assert r.actual_user_id is null and r.actual_name = 'מחליף חופשי', 'E3 FAILED: free text not stored';
  assert pg_temp.mine_ids(guard, w) not like '%AB@2032-01-05%' and pg_temp.mine_ids(commander, w) not like '%AB@2032-01-05%',
         'E3 FAILED: a free-text replacement must belong to nobody';

  perform pg_temp.as_user(manager);
  r := public.edit_shift_assignment(r.id, r.updated_at, jsonb_build_object('worker', jsonb_build_object('user_id', commander, 'name', 'דנה לוי')), null);
  reset role;
  assert pg_temp.mine_ids(commander, w) like '%AB@2032-01-05%', 'E3 FAILED: replacing back to the original worker must restore attribution';
  raise notice 'E3 PASSED';
end $$;

-- ===========================================================================
-- E4: night shift (crosses midnight) and validation
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  r public.shift_assignments; msg text;
begin
  r := pg_temp.row_at(w+2, 'night', 'לובי תחתון', 0);
  perform pg_temp.as_user(manager);
  r := public.edit_shift_assignment(r.id, r.updated_at, jsonb_build_object('starts_at', ((w+2)||' 23:00+02')::timestamptz, 'ends_at', ((w+3)||' 07:30+02')::timestamptz), null);
  assert r.work_date = w+2 and (r.ends_at at time zone 'Asia/Jerusalem')::date = w+3, 'E4 FAILED: night shift stays under its start date, ends next day';
  reset role;
  assert pg_temp.mine_ids(guard, w) like '%לובי תחתון@2032-01-06%', 'E4 FAILED: night shift shows under its start date';
  perform pg_temp.as_user(manager);
  foreach msg in array array['bad_start','bad_end','too_long'] loop
    begin
      perform public.edit_shift_assignment(r.id, r.updated_at, case msg
        when 'bad_start' then jsonb_build_object('starts_at', ((w+3)||' 01:00+02')::timestamptz, 'ends_at', ((w+3)||' 08:00+02')::timestamptz)
        when 'bad_end' then jsonb_build_object('ends_at', ((w+2)||' 22:00+02')::timestamptz)
        else jsonb_build_object('ends_at', ((w+3)||' 20:00+02')::timestamptz) end, null);
      assert false, 'E4 FAILED: invalid hours accepted ('||msg||')';
    exception when sqlstate '22023' then null; end;
  end loop;
  reset role;
  raise notice 'E4 PASSED';
end $$;

-- ===========================================================================
-- E5: cancel, restore (same row, history chain), add at an occupied place, add onto a cancelled marker
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  r public.shift_assignments; r2 public.shift_assignments; kinds text;
begin
  r := pg_temp.row_at(w+3, 'morning', 'CD', 0);
  perform pg_temp.as_user(manager);
  r2 := public.cancel_shift_assignment(r.id, r.updated_at, 'will not come');
  reset role;
  assert not r2.published and r2.is_manually_edited and r2.id = r.id, 'E5 FAILED: cancel must keep the row as a cancelled marker';
  assert pg_temp.mine_ids(guard, w) not like '%CD@2032-01-07%', 'E5 FAILED: cancelled shift still in My shifts';
  perform pg_temp.as_user(manager);
  begin perform public.cancel_shift_assignment(r.id, r2.updated_at, null); assert false, 'E5 FAILED: double cancel';
  exception when sqlstate '22023' then null; end;
  begin perform public.edit_shift_assignment(r.id, r2.updated_at, jsonb_build_object('ends_at', (r.ends_at + interval '1 hour')), null); assert false, 'E5 FAILED: edit of a cancelled shift';
  exception when sqlstate '22023' then null; end;
  r2 := public.restore_shift_assignment(r.id, r2.updated_at, null);
  reset role;
  assert r2.published and r2.id = r.id, 'E5 FAILED: restore must bring the SAME row back';
  assert pg_temp.mine_ids(guard, w) like '%CD@2032-01-07%', 'E5 FAILED: restored shift not back in My shifts';
  select string_agg(change_kind, ',' order by changed_at, id) into kinds from public.staffing_change_log where assignment_id = r.id and change_kind like 'manual_%';
  assert kinds = 'manual_cancel,manual_restore', 'E5 FAILED: history chain should be cancel then restore, got '||kinds;

  -- add where a live shift already is
  perform pg_temp.as_user(manager);
  begin
    perform public.add_shift_assignment(jsonb_build_object('work_date', w+3, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'CD', 'slot_index', 0,
       'starts_at', ((w+3)||' 06:45+02')::timestamptz, 'ends_at', ((w+3)||' 15:10+02')::timestamptz, 'worker', jsonb_build_object('name', 'אחר')), null);
    assert false, 'E5 FAILED: add over a live shift';
  exception when sqlstate '23505' then null; end;
  -- cancel again, then add onto the marker: reuses the same row
  r := pg_temp.row_at(w+3, 'morning', 'CD', 0);
  r2 := public.cancel_shift_assignment(r.id, r.updated_at, null);
  r2 := public.add_shift_assignment(jsonb_build_object('work_date', w+3, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'CD', 'slot_index', 0,
       'starts_at', ((w+3)||' 06:45+02')::timestamptz, 'ends_at', ((w+3)||' 15:10+02')::timestamptz, 'worker', jsonb_build_object('name', 'מחליף')), null);
  reset role;
  assert r2.id = r.id and r2.published, 'E5 FAILED: add onto a cancelled marker should reuse the row';
  raise notice 'E5 PASSED';
end $$;

-- ===========================================================================
-- E6: move = atomic cancel + create, linked in history; occupied target changes nothing
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  src public.shift_assignments; moved public.shift_assignments; marker public.shift_assignments; l1 record; l2 record;
  snap_before text; snap_after text;
begin
  src := pg_temp.row_at(w, 'morning', 'AB', 0);  -- the guard's, hours already edited in E1
  perform pg_temp.as_user(manager);
  moved := public.edit_shift_assignment(src.id, src.updated_at, jsonb_build_object('shift_category', 'afternoon', 'position', 'CD', 'slot_index', 0,
             'starts_at', (w||' 14:45+02')::timestamptz, 'ends_at', (w||' 23:10+02')::timestamptz), 'moved to the afternoon');
  reset role;
  marker := pg_temp.row_at(w, 'morning', 'AB', 0);
  assert moved.id <> src.id and moved.published and moved.shift_category = 'afternoon' and moved.position = 'CD', 'E6 FAILED: moved row not created';
  assert not marker.published and marker.is_manually_edited and marker.id = src.id, 'E6 FAILED: the old place must become a cancelled marker';
  assert marker.starts_at = src.starts_at and marker.source_name = src.source_name, 'E6 FAILED: the marker must keep its original values';
  assert moved.source_name = 'אורי כהן' and moved.import_id = src.import_id, 'E6 FAILED: moved row lost the Excel name/import';
  select * into l1 from public.staffing_change_log where assignment_id = src.id and change_kind = 'manual_cancel' order by changed_at desc limit 1;
  select * into l2 from public.staffing_change_log where assignment_id = moved.id and change_kind = 'manual_move' limit 1;
  assert l1.details->>'change_group' = l2.details->>'change_group' and (l1.details->>'moved_to_id')::uuid = moved.id and (l2.details->>'moved_from_id')::uuid = src.id,
         'E6 FAILED: the two history entries must be linked';
  assert pg_temp.mine_ids(guard, w) like '%CD@2032-01-04%' and pg_temp.mine_ids(guard, w) not like '%AB@2032-01-04%', 'E6 FAILED: My shifts must show only the new place';

  -- restore of a marker left by a move is refused while the copy is live
  perform pg_temp.as_user(manager);
  begin perform public.restore_shift_assignment(marker.id, marker.updated_at, null); assert false, 'E6 FAILED: restored a moved-away marker';
  exception when sqlstate '22023' then null; end;
  reset role;

  -- target occupied by a live shift: error, NOTHING changes
  insert into public.shift_assignments (work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, actual_name, source, is_manually_edited, published)
  values (w+1, 'afternoon', 'מאבטח', 'CD', 0, ((w+1)||' 14:45+02')::timestamptz, ((w+1)||' 23:10+02')::timestamptz, 'תפוס', 'תפוס', 'excel', false, true);
  select md5(string_agg(x::text, '|' order by x::text)) into snap_before from public.shift_assignments x where work_date between w and w + 6;
  perform pg_temp.as_user(manager);
  src := pg_temp.row_at(w+1, 'morning', 'AB', 0);
  begin
    perform public.edit_shift_assignment(src.id, src.updated_at, jsonb_build_object('shift_category', 'afternoon', 'position', 'CD', 'slot_index', 0,
              'starts_at', ((w+1)||' 14:45+02')::timestamptz, 'ends_at', ((w+1)||' 23:10+02')::timestamptz), null);
    assert false, 'E6 FAILED: moved onto an occupied place';
  exception when sqlstate '23505' then null; end;
  reset role;
  select md5(string_agg(x::text, '|' order by x::text)) into snap_after from public.shift_assignments x where work_date between w and w + 6;
  assert snap_before = snap_after, 'E6 FAILED: a refused move must leave every row untouched (atomic)';
  assert (select count(*) from public.staffing_change_log where assignment_id = src.id and change_kind in ('manual_cancel','manual_move')) = 0, 'E6 FAILED: refused move wrote history';
  raise notice 'E6 PASSED';
end $$;

-- ===========================================================================
-- E7: concurrency, including a change made through the EXISTING replace mechanism
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  seen public.shift_assignments; r public.shift_assignments; n int := 0;
begin
  -- (one transaction has one now(): make "what the manager saw" an earlier moment, as in real life)
  update public.shift_assignments set updated_at = updated_at - interval '1 minute' where work_date between w and w + 6;
  seen := pg_temp.row_at(w+3, 'morning', 'CD', 0);
  -- somebody else changes it through replace_assignment_worker
  perform pg_temp.as_user(manager);
  perform public.replace_assignment_worker(seen.id, guard, 'אורי כהן', 'swap');
  begin
    perform public.edit_shift_assignment(seen.id, seen.updated_at, jsonb_build_object('ends_at', (seen.ends_at + interval '30 minutes')), null);
    assert false, 'E7 FAILED: a stale edit overwrote a replace_assignment_worker change';
  exception when sqlstate '40001' then n := n + 1; end;
  begin perform public.cancel_shift_assignment(seen.id, seen.updated_at, null); assert false, 'E7 FAILED: stale cancel';
  exception when sqlstate '40001' then n := n + 1; end;
  -- two editors with the same view: the second one loses
  seen := pg_temp.row_at(w+3, 'morning', 'CD', 0);
  perform public.edit_shift_assignment(seen.id, seen.updated_at, jsonb_build_object('ends_at', (seen.ends_at + interval '10 minutes')), null);
  begin perform public.edit_shift_assignment(seen.id, seen.updated_at, jsonb_build_object('ends_at', (seen.ends_at + interval '20 minutes')), null); assert false, 'E7 FAILED: second editor overwrote the first';
  exception when sqlstate '40001' then n := n + 1; end;
  begin perform public.edit_shift_assignment(seen.id, null, jsonb_build_object('ends_at', (seen.ends_at + interval '20 minutes')), null); assert false, 'E7 FAILED: edit without expected_updated_at';
  exception when sqlstate '40001' then n := n + 1; end;
  reset role;
  assert n = 4, 'E7 FAILED: expected 4 concurrency refusals';
  raise notice 'E7 PASSED';
end $$;

-- ===========================================================================
-- E8: permissions are enforced in the database
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  r public.shift_assignments; who uuid; denied int := 0; upd int;
begin
  r := pg_temp.row_at(w+4, 'afternoon', 'EFG', 0);
  foreach who in array array[commander, guard] loop
    perform pg_temp.as_user(who);
    begin perform public.edit_shift_assignment(r.id, r.updated_at, jsonb_build_object('ends_at', r.ends_at + interval '5 minutes'), null); exception when insufficient_privilege then denied := denied + 1; end;
    begin perform public.cancel_shift_assignment(r.id, r.updated_at, null); exception when insufficient_privilege then denied := denied + 1; end;
    begin perform public.restore_shift_assignment(r.id, r.updated_at, null); exception when insufficient_privilege then denied := denied + 1; end;
    begin perform public.add_shift_assignment(jsonb_build_object('work_date', w+6, 'shift_category','morning','worker_kind','מאבטח','position','AB','slot_index',0,
            'starts_at', ((w+6)||' 06:45+02')::timestamptz,'ends_at', ((w+6)||' 15:10+02')::timestamptz,'worker', jsonb_build_object('name','x')), null); exception when insufficient_privilege then denied := denied + 1; end;
    begin update public.shift_assignments set ends_at = ends_at where id = r.id; get diagnostics upd = row_count; assert upd = 0, 'E8 FAILED: direct update changed a row';
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
  assert denied = 8, 'E8 FAILED: expected 8 RPC denials (4 per role), got '||denied;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  begin perform public.edit_shift_assignment(r.id, r.updated_at, '{}'::jsonb, null); assert false, 'E8 FAILED: anon edit';
  exception when insufficient_privilege then null; end;
  reset role;
  assert (select ends_at from public.shift_assignments where id = r.id) = r.ends_at, 'E8 FAILED: a denied call changed the row';
  raise notice 'E8 PASSED';
end $$;

-- ===========================================================================
-- E9: correcting a past shift needs a reason (stored); the future does not
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  w date := pg_temp.W();
  past public.shift_assignments; r public.shift_assignments; lg record;
begin
  insert into public.shift_assignments (work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, actual_name, source, published)
  values (date '2020-01-05', 'morning', 'מאבטח', 'AB', 0, '2020-01-05 06:45+02', '2020-01-05 15:10+02', 'ישן', 'ישן', 'excel', true) returning * into past;
  perform pg_temp.as_user(manager);
  begin perform public.edit_shift_assignment(past.id, past.updated_at, jsonb_build_object('ends_at', past.ends_at + interval '1 hour'), null); assert false, 'E9 FAILED: past edit without a reason';
  exception when sqlstate '22023' then null; end;
  begin perform public.edit_shift_assignment(past.id, past.updated_at, jsonb_build_object('ends_at', past.ends_at + interval '1 hour'), '   '); assert false, 'E9 FAILED: blank reason accepted';
  exception when sqlstate '22023' then null; end;
  r := public.edit_shift_assignment(past.id, past.updated_at, jsonb_build_object('ends_at', past.ends_at + interval '1 hour'), 'actual hours worked');
  reset role;
  select * into lg from public.staffing_change_log where assignment_id = past.id order by changed_at desc limit 1;
  assert lg.reason = 'actual hours worked', 'E9 FAILED: reason not stored in history';
  raise notice 'E9 PASSED';
end $$;

-- ===========================================================================
-- E10: re-upload of the SAME Excel after manual edits: nothing resurrected or duplicated,
--      conflicts are reported, and an explicit "revert to file" resolves them
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  v_import uuid := current_setting('test.import')::uuid;
  file jsonb;
  dry jsonb; pub jsonb; rows_before int; rows_after int; marker public.shift_assignments; moved public.shift_assignments;
  cancelled_ids uuid[]; r public.shift_assignments;
begin
  -- also cancel the Wednesday-night row so a cancelled shift is part of the story
  perform pg_temp.as_user(manager);
  r := pg_temp.row_at(w+2, 'night', 'לובי תחתון', 0);
  perform public.cancel_shift_assignment(r.id, r.updated_at, 'night cancelled');
  reset role;

  file := jsonb_build_array(
    pg_temp.file_row(w,   'morning',  'מאבטח','AB',0,(w||' 06:45+02')::timestamptz,(w||' 15:10+02')::timestamptz,'אורי כהן'),
    pg_temp.file_row(w+1, 'morning',  'מאבטח','AB',0,((w+1)||' 06:45+02')::timestamptz,((w+1)||' 15:10+02')::timestamptz,'דנה לוי'),
    pg_temp.file_row(w+2, 'night',    'מאבטח','לובי תחתון',0,((w+2)||' 22:45+02')::timestamptz,((w+3)||' 07:10+02')::timestamptz,'אורי כהן'),
    pg_temp.file_row(w+3, 'morning',  'מאבטח','CD',0,((w+3)||' 06:45+02')::timestamptz,((w+3)||' 15:10+02')::timestamptz,'אורי כהן'),
    pg_temp.file_row(w+4, 'afternoon','מאבטח','EFG',0,((w+4)||' 14:45+02')::timestamptz,((w+4)||' 23:10+02')::timestamptz,'גיא ללא חשבון'));

  select count(*) into rows_before from public.shift_assignments where work_date between w and w + 6;
  dry := pg_temp.publish_file(v_import, file, '{}', '{}', true);
  assert jsonb_array_length(dry->'to_insert') = 0, 'E10 FAILED: dry-run would insert (a cancelled/moved row would come back): '||(dry->'to_insert')::text;
  assert jsonb_array_length(dry->'to_delete') = 0, 'E10 FAILED: dry-run would delete: '||(dry->'to_delete')::text;
  -- the cancelled markers and the moved-away marker are listed as kept, not as new rows
  assert (select count(*) from jsonb_array_elements(dry->'to_keep_manual') k where (k->>'id')::uuid in (
            select id from public.shift_assignments where work_date between w and w+6 and not published)) >= 2, 'E10 FAILED: cancelled markers must be reported in to_keep_manual';
  pub := pg_temp.publish_file(v_import, file, '{}', '{}', false);
  select count(*) into rows_after from public.shift_assignments where work_date between w and w + 6;
  assert rows_before = rows_after, 'E10 FAILED: re-upload changed the row count '||rows_before||' -> '||rows_after;
  assert (select count(*) from public.shift_assignments where work_date = w and shift_category = 'morning' and position = 'AB' and published) = 0, 'E10 FAILED: a moved-away shift came back at its old place';
  assert (select count(*) from public.shift_assignments where work_date = w+2 and published and position = 'לובי תחתון') = 0, 'E10 FAILED: a cancelled shift came back';
  assert (select ends_at from public.shift_assignments where work_date = w+3 and position = 'CD' and shift_category = 'morning') <> (((w+3)||' 15:10+02')::timestamptz), 'E10 FAILED: edited hours were overwritten';
  assert pg_temp.mine_ids(guard, w) like '%CD@2032-01-04%' and pg_temp.mine_ids(guard, w) not like '%לובי תחתון%', 'E10 FAILED: My shifts after re-upload';
  -- a second identical upload changes nothing again
  pub := pg_temp.publish_file(v_import, file, '{}', '{}', false);
  assert (select count(*) from public.shift_assignments where work_date between w and w + 6) = rows_after, 'E10 FAILED: second re-upload changed rows';

  -- an UPDATED file: new hours for a manually moved/edited row and a brand-new row
  file := file || pg_temp.file_row(w+5, 'morning', 'מאבטח','EFG',0,((w+5)||' 06:45+02')::timestamptz,((w+5)||' 15:10+02')::timestamptz,'חדש בקובץ');
  file := (select jsonb_agg(case when e->>'position' = 'CD' and e->>'shift_category' = 'morning'
                                 then e || jsonb_build_object('ends_at', ((w+3)||' 16:30+02')::timestamptz) else e end) from jsonb_array_elements(file) e);
  dry := pg_temp.publish_file(v_import, file, '{}', '{}', true);
  assert jsonb_array_length(dry->'to_insert') = 1, 'E10 FAILED: only the genuinely new row should be inserted';
  assert jsonb_array_length(dry->'conflicts') >= 1, 'E10 FAILED: the differing manual edit must be reported as a conflict';
  pub := pg_temp.publish_file(v_import, file, '{}', '{}', false);
  assert (select ends_at from public.shift_assignments where work_date = w+3 and position = 'CD' and shift_category = 'morning') <> (((w+3)||' 16:30+02')::timestamptz), 'E10 FAILED: updated file overwrote a manual edit silently';
  assert exists (select 1 from public.shift_assignments where work_date = w+5 and position = 'EFG' and published), 'E10 FAILED: new row from the updated file missing';

  -- explicit decision: revert the cancelled night row to the file -> it returns, no longer a manual edit
  pub := pg_temp.publish_file(v_import, file, jsonb_build_object((w+2)::text||'|night|לובי תחתון|0', 'revert_to_file'), '{}', false);
  r := pg_temp.row_at(w+2, 'night', 'לובי תחתון', 0);
  assert r.published and not r.is_manually_edited and r.starts_at = ((w+2)||' 22:45+02')::timestamptz, 'E10 FAILED: revert_to_file should restore the cancelled row from the file';
  raise notice 'E10 PASSED';
end $$;

-- ===========================================================================
-- E11: the original Excel record is never rewritten and the history shows before/after
-- ===========================================================================
do $$
declare
  w date := pg_temp.W();
  first_edit record;
begin
  select l.* into first_edit from public.staffing_change_log l join public.shift_assignments a on a.id = l.assignment_id
  where a.work_date = w and a.shift_category = 'morning' and a.position = 'AB' and l.change_kind = 'manual_cancel' and l.details ? 'moved_to_id' limit 1;
  assert first_edit.details->'before'->>'source_name' = 'אורי כהן', 'E11 FAILED: original name missing from history';
  assert (first_edit.details->'before'->>'starts_at')::timestamptz = (w||' 07:00+02')::timestamptz, 'E11: before values';
  assert (select count(*) from public.staffing_change_log l where l.details is not null and l.details ? 'before' and l.details ? 'after') >= 8, 'E11 FAILED: every manual change must carry before/after';
  assert (select count(*) from public.shift_assignments where source_name is not null and source = 'excel' and work_date = w) >= 1;
  raise notice 'E11 PASSED';
end $$;

-- ===========================================================================
-- E12: the replace mechanism (Live swap / Setup) refuses a stale screen, cannot touch a
--      cancelled shift, keeps its old rules, and the old 4-parameter call still works
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := pg_temp.W();
  seen public.shift_assignments; r public.shift_assignments; n int := 0; other public.shift_assignments;
begin
  -- a shift that is "in progress right now" for the commander rule
  insert into public.shift_assignments (work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, actual_name, source, published)
  values (((now() - interval '1 hour') at time zone 'Asia/Jerusalem')::date, 'morning', 'מאבטח', 'עמדת בדיקה E12', 0, now() - interval '1 hour', now() + interval '1 hour', 'פעיל', 'פעיל', 'excel', true);
  update public.shift_assignments set updated_at = updated_at - interval '1 minute' where position = 'עמדת בדיקה E12';
  seen := pg_temp.row_at(((now() - interval '1 hour') at time zone 'Asia/Jerusalem')::date, 'morning', 'עמדת בדיקה E12', 0);

  -- somebody else edits it first (manager screen)
  perform pg_temp.as_user(manager);
  perform public.edit_shift_assignment(seen.id, seen.updated_at, jsonb_build_object('ends_at', seen.ends_at + interval '30 minutes'), 'x');
  reset role;

  -- the commander's Live screen is now stale: refused, nothing overwritten
  perform pg_temp.as_user(commander);
  begin perform public.replace_assignment_worker(seen.id, guard, 'אורי כהן', 'late', seen.updated_at); assert false, 'E12 FAILED: stale replace overwrote a change';
  exception when sqlstate '40001' then n := n + 1; end;
  begin perform public.replace_assignment_worker(seen.id, guard, 'אורי כהן', 'late', null); assert false, 'E12 FAILED: replace without expected_updated_at';
  exception when sqlstate '40001' then n := n + 1; end;
  reset role;
  assert (select actual_name from public.shift_assignments where id = seen.id) = 'פעיל', 'E12 FAILED: a refused replace changed the worker';

  -- with a fresh view it works (commander, in-progress shift), history has before/after
  seen := pg_temp.row_at(((now() - interval '1 hour') at time zone 'Asia/Jerusalem')::date, 'morning', 'עמדת בדיקה E12', 0);
  perform pg_temp.as_user(commander);
  r := public.replace_assignment_worker(seen.id, guard, 'אורי כהן', 'swap', seen.updated_at);
  reset role;
  assert r.actual_user_id = guard and r.is_manually_edited, 'E12 FAILED: fresh replace should work';
  assert (select details->'before'->>'actual_name' from public.staffing_change_log where assignment_id = seen.id and change_kind = 'manual_replace' order by changed_at desc limit 1) = 'פעיל', 'E12 FAILED: replace history lacks before';

  -- the manager editing from a stale screen after THAT replacement is refused too
  perform pg_temp.as_user(manager);
  begin perform public.edit_shift_assignment(seen.id, seen.updated_at, jsonb_build_object('ends_at', seen.ends_at + interval '10 minutes'), 'x'); assert false, 'E12 FAILED: stale manager edit after a replace';
  exception when sqlstate '40001' then n := n + 1; end;
  reset role;

  -- a cancelled shift cannot be replaced; a guard cannot; the commander rule for a non-active shift stays
  seen := pg_temp.row_at(w+4, 'afternoon', 'EFG', 0);
  perform pg_temp.as_user(manager);
  perform public.cancel_shift_assignment(seen.id, seen.updated_at, null);
  reset role;
  seen := pg_temp.row_at(w+4, 'afternoon', 'EFG', 0);
  perform pg_temp.as_user(manager);
  begin perform public.replace_assignment_worker(seen.id, guard, 'x', 'r', seen.updated_at); assert false, 'E12 FAILED: replaced a cancelled shift';
  exception when sqlstate '22023' then n := n + 1; end;
  reset role;
  perform pg_temp.as_user(guard);
  begin perform public.replace_assignment_worker(seen.id, guard, 'x', 'r', seen.updated_at); assert false, 'E12 FAILED: guard replaced';
  exception when insufficient_privilege then n := n + 1; end;
  reset role;
  perform pg_temp.as_user(commander);
  other := pg_temp.row_at(w+1, 'morning', 'AB', 0);
  begin perform public.replace_assignment_worker(other.id, guard, 'x', 'r', other.updated_at); assert false, 'E12 FAILED: commander replaced a shift that is not in progress';
  exception when insufficient_privilege then n := n + 1; end;
  reset role;
  assert n = 6, 'E12 FAILED: expected 6 refusals, got '||n;

  -- the OLD four-parameter call (what the currently deployed client sends) still resolves and works
  perform pg_temp.as_user(manager);
  seen := pg_temp.row_at(w+3, 'morning', 'CD', 0);
  r := public.replace_assignment_worker(p_assignment_id => seen.id, p_new_user_id => commander, p_new_name => 'דנה לוי', p_reason => 'old client');
  reset role;
  assert r.actual_user_id = commander, 'E12 FAILED: the old 4-parameter replace stopped working';
  assert (select count(*) from pg_proc where proname = 'replace_assignment_worker' and pronamespace = 'public'::regnamespace) = 2, 'E12 FAILED: expected both replace overloads';
  raise notice 'E12 PASSED';
end $$;

-- ===========================================================================
-- E13: non-managers learn ONLY "this slot is cancelled" (no names / hours / ids, no draft
--      rows), cannot read unpublished rows, and open screens get a realtime signal
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := date '2032-02-01';
  r public.shift_assignments; slots jsonb; who uuid; rev0 bigint; rev1 bigint; n int;
begin
  insert into public.shift_assignments (work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, actual_name, source, published) values
    (w, 'morning', 'מאבטח', 'AB', 0, (w||' 06:45+02')::timestamptz, (w||' 15:10+02')::timestamptz, 'שם סודי א', 'שם סודי א', 'excel', true),
    (w, 'morning', 'מאבטח', 'CD', 0, (w||' 06:45+02')::timestamptz, (w||' 15:10+02')::timestamptz, 'טיוטה שלא פורסמה', 'טיוטה שלא פורסמה', 'excel', false);
  update public.shift_assignments set updated_at = updated_at - interval '1 minute' where work_date = w;
  r := pg_temp.row_at(w, 'morning', 'AB', 0);
  select revision into rev0 from public.schedule_revisions;

  perform pg_temp.as_user(manager);
  perform public.cancel_shift_assignment(r.id, r.updated_at, null);
  reset role;
  select revision into rev1 from public.schedule_revisions;
  assert rev1 > rev0, 'E13 FAILED: a cancel must bump the revision signal';

  foreach who in array array[commander, guard] loop
    perform pg_temp.as_user(who);
    select count(*) into n from public.shift_assignments where work_date = w and not published;
    assert n = 0, 'E13 FAILED: a non-manager can read unpublished rows';
    slots := public.get_cancelled_slots(w);
    assert jsonb_array_length(slots) = 1, 'E13 FAILED: expected exactly the one cancelled slot (the unedited draft must not be listed), got '||slots::text;
    assert (select array_agg(k order by k) from jsonb_object_keys(slots->0) k) = array['position','shift_category','slot_index','work_date'],
           'E13 FAILED: only date/shift/post/slot may be exposed, got '||(slots->0)::text;
    assert slots::text not like '%שם סודי%' and slots::text not like '%טיוטה%', 'E13 FAILED: a name leaked';
    -- the signal is readable, but nobody but the RPCs can write it
    select revision into rev0 from public.schedule_revisions; assert rev0 = rev1, 'E13 FAILED: signal not readable';
    begin update public.schedule_revisions set revision = 0; get diagnostics n = row_count; assert n = 0, 'E13 FAILED: direct write to the signal changed a row';
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;

  -- anon cannot call it
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  begin perform public.get_cancelled_slots(w); assert false, 'E13 FAILED: anon read cancelled slots';
  exception when insufficient_privilege then null; end;
  reset role;

  -- restore removes it from the list and bumps again
  r := pg_temp.row_at(w, 'morning', 'AB', 0);
  perform pg_temp.as_user(manager);
  perform public.restore_shift_assignment(r.id, r.updated_at, null);
  reset role;
  perform pg_temp.as_user(guard);
  assert jsonb_array_length(public.get_cancelled_slots(w)) = 0, 'E13 FAILED: restored shift still listed as cancelled';
  reset role;
  assert (select revision from public.schedule_revisions) > rev1, 'E13 FAILED: restore must bump the signal';
  raise notice 'E13 PASSED';
end $$;

rollback;
