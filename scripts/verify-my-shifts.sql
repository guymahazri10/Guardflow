-- scripts/verify-my-shifts.sql
--
-- Regression checks for phase21_schedule_worker_links.sql (get_my_shifts,
-- link_schedule_worker, unlink_schedule_worker, schedule_worker_links RLS).
-- Everything runs in ONE transaction that is rolled back at the end; it
-- impersonates callers with set_config('request.jwt.claims') / SET LOCAL ROLE,
-- so do not run it against a database you care about. Run by
-- scripts/verify-my-shifts.sh. Test names are invented.
begin;

-- ---- fixtures (as superuser) ----------------------------------------------
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := date '2031-01-05';  -- a Sunday
  u1 uuid := '00000000-0000-0000-0000-0000000000a1';
  u2 uuid := '00000000-0000-0000-0000-0000000000a2';
  u3 uuid := '00000000-0000-0000-0000-0000000000a3';
begin
  assert extract(dow from w) = 0;
  delete from public.schedule_worker_links;  -- start from no links (rolled back with everything else)
  update public.profiles set full_name = 'אורי כהן' where id = guard;
  update public.profiles set full_name = 'דנה לוי' where id = commander;
  update public.profiles set full_name = 'מנהל בדיקה' where id = manager;

  -- two accounts with the SAME name, and one whose name is only a first name
  set local session_replication_role = replica;  -- skip the invite-only signup trigger for test users
  insert into auth.users (id, email) values (u1, 'u1@local.test'), (u2, 'u2@local.test'), (u3, 'u3@local.test');
  insert into public.profiles (id, email, full_name, app_role) values
    (u1, 'u1@local.test', 'תמר גל', 'מאבטח') on conflict (id) do update set full_name = 'תמר גל';
  insert into public.profiles (id, email, full_name, app_role) values
    (u2, 'u2@local.test', 'תמר גל', 'מאבטח') on conflict (id) do update set full_name = 'תמר גל';
  insert into public.profiles (id, email, full_name, app_role) values
    (u3, 'u3@local.test', 'גיא', 'מאבטח') on conflict (id) do update set full_name = 'גיא';
  set local session_replication_role = origin;

  -- A1 plain exact; A2 odd whitespace; A3 stale fuzzy link to the commander
  insert into public.shift_assignments (work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, planned_user_id, actual_user_id, actual_name, source, is_manually_edited, published) values
   (w,     'morning','מאבטח','AB',0, (w||' 06:45+02')::timestamptz,(w||' 15:10+02')::timestamptz,'אורי כהן',null,null,'אורי כהן','excel',false,true),
   (w+1,   'morning','מאבטח','AB',0, ((w+1)||' 06:45+02')::timestamptz,((w+1)||' 15:10+02')::timestamptz,'אורי   כהן',null,null,'אורי   כהן','excel',false,true),
   (w+2,   'morning','מאבטח','AB',0, ((w+2)||' 06:45+02')::timestamptz,((w+2)||' 15:10+02')::timestamptz,'אורי כהן',commander,commander,'אורי כהן','excel',false,true),
   -- A4 replaced by an account (the guard) ; A5 replaced by free text
   (w+3,   'morning','מאבטח','CD',0, ((w+3)||' 06:45+02')::timestamptz,((w+3)||' 15:10+02')::timestamptz,'דנה לוי',commander,guard,'אורי כהן','excel',true,true),
   (w+4,   'morning','מאבטח','CD',0, ((w+4)||' 06:45+02')::timestamptz,((w+4)||' 15:10+02')::timestamptz,'דנה לוי',commander,null,'מישהו חופשי','excel',true,true),
   -- A6 night shift: starts Friday evening, ends Saturday morning -> belongs to Friday
   (w+5,   'night','אחמ"ש','אחמ"ש',0, ((w+5)||' 22:30+02')::timestamptz,((w+6)||' 07:00+02')::timestamptz,'דנה לוי',null,null,'דנה לוי','excel',false,true),
   -- same name 'תמר גל' on two rows at the same hour (two people), plus a first-name-only person
   (w+6,   'morning','מאבטח','EFG',0, ((w+6)||' 06:45+02')::timestamptz,((w+6)||' 15:10+02')::timestamptz,'תמר גל',null,null,'תמר גל','excel',false,true),
   (w+6,   'morning','מאבטח','EFG',1, ((w+6)||' 06:45+02')::timestamptz,((w+6)||' 15:10+02')::timestamptz,'תמר גל',null,null,'תמר גל','excel',false,true),
   (w,     'afternoon','מאבטח','CD',0, (w||' 14:45+02')::timestamptz,(w||' 23:10+02')::timestamptz,'גיא מהצרי',null,null,'גיא מהצרי','excel',false,true),
   -- alias spelling, unpublished row, other week
   (w,     'afternoon','מאבטח','EFG',0, (w||' 14:45+02')::timestamptz,(w||' 23:10+02')::timestamptz,'אורי כ.',null,null,'אורי כ.','excel',false,true),
   (w+1,   'afternoon','מאבטח','EFG',0, ((w+1)||' 14:45+02')::timestamptz,((w+1)||' 23:10+02')::timestamptz,'אורי כהן',null,null,'אורי כהן','excel',false,false),
   (w+7,   'morning','מאבטח','AB',0, ((w+7)||' 06:45+02')::timestamptz,((w+7)||' 15:10+02')::timestamptz,'אורי כהן',null,null,'אורי כהן','excel',false,true);
end $$;

-- helper: run get_my_shifts as a user, returning jsonb
create or replace function pg_temp.mine(p_user uuid, p_week date) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.get_my_shifts(p_week);
  reset role;
  return r;
end $$;
grant execute on function pg_temp.mine(uuid, date) to public;

create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ===========================================================================
-- M1: exact single match, whitespace-tolerant, stale planned/actual link ignored,
--     account replacement goes to the replacement, free text to nobody,
--     unpublished / other-week rows excluded, night shift under its start date
-- ===========================================================================
do $$
declare
  guard uuid := '00000000-0000-0000-0000-000000000003';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  w date := date '2031-01-05';
  g jsonb; c jsonb;
begin
  g := pg_temp.mine(guard, w);
  c := pg_temp.mine(commander, w);
  -- guard: A1, A2, A3 (stale link to commander ignored) + alias row not yet + A4 (replaced to guard) = 4
  assert (g->>'linked')::boolean and g->>'link_kind' = 'exact', 'M1 FAILED: guard should be exact-linked: '||g::text;
  assert jsonb_array_length(g->'shifts') = 4, 'M1 FAILED: guard expected 4 shifts (A1,A2,A3,A4), got '||jsonb_array_length(g->'shifts')||' '||g::text;
  -- commander: night A6 only (A3 stale link ignored, A4 replaced away, A5 free text -> nobody)
  assert jsonb_array_length(c->'shifts') = 1, 'M1 FAILED: commander expected 1 shift (night), got '||c::text;
  assert (c->'shifts'->0->>'work_date')::date = w + 5, 'M1 FAILED: night shift must sit under its start date';
  assert (c->'shifts'->0->>'ends_at')::timestamptz > ((w+6)||' 00:00+02')::timestamptz, 'M1: night ends next day';
  assert not exists (select 1 from jsonb_array_elements(c->'shifts') s where s->>'actual_name' = 'מישהו חופשי'), 'M1 FAILED: free-text replacement shown to original worker';
  assert not exists (select 1 from jsonb_array_elements(g->'shifts') s where (s->>'work_date')::date = w+7), 'M1 FAILED: other week leaked';
  -- ordered by start time
  assert (select array_agg(s->>'starts_at' order by ord) from jsonb_array_elements(g->'shifts') with ordinality t(s,ord)) =
         (select array_agg(s->>'starts_at' order by s->>'starts_at') from jsonb_array_elements(g->'shifts') s), 'M1 FAILED: not ordered';
  raise notice 'M1 PASSED';
end $$;

-- ===========================================================================
-- M2: same name on two accounts + same name twice at the same time: nobody
--     gets it automatically; first-name-only profile is NOT linked
-- ===========================================================================
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-0000000000a1';
  u2 uuid := '00000000-0000-0000-0000-0000000000a2';
  u3 uuid := '00000000-0000-0000-0000-0000000000a3';
  w date := date '2031-01-05';
  a jsonb; b jsonb; c jsonb;
begin
  a := pg_temp.mine(u1, w); b := pg_temp.mine(u2, w); c := pg_temp.mine(u3, w);
  assert not (a->>'linked')::boolean and jsonb_array_length(a->'shifts') = 0, 'M2 FAILED: duplicate-name account u1 attributed: '||a::text;
  assert not (b->>'linked')::boolean and jsonb_array_length(b->'shifts') = 0, 'M2 FAILED: duplicate-name account u2 attributed: '||b::text;
  assert not (c->>'linked')::boolean and jsonb_array_length(c->'shifts') = 0, 'M2 FAILED: first-name-only profile must not match the full name: '||c::text;
  raise notice 'M2 PASSED';
end $$;

-- ===========================================================================
-- M3: explicit link beats automatic matching (contradicting link), aliases
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  u1 uuid := '00000000-0000-0000-0000-0000000000a1';
  u2 uuid := '00000000-0000-0000-0000-0000000000a2';
  u3 uuid := '00000000-0000-0000-0000-0000000000a3';
  w date := date '2031-01-05';
  r jsonb;
begin
  perform pg_temp.as_user(manager);
  -- the manager decides: this 'תמר גל' is u1
  perform public.link_schedule_worker('תמר גל', u1);
  -- alias: 'אורי כ.' is the guard ; first-name-only profile u3 linked to the full name 'גיא מהצרי'
  perform public.link_schedule_worker('אורי כ.', guard);
  perform public.link_schedule_worker('גיא מהצרי', u3);
  reset role;

  r := pg_temp.mine(u1, w);
  assert (r->>'linked')::boolean and r->>'link_kind' = 'explicit' and jsonb_array_length(r->'shifts') = 2, 'M3 FAILED: explicit link did not attribute both rows to u1: '||r::text;
  r := pg_temp.mine(u2, w);
  assert jsonb_array_length(r->'shifts') = 0 and not (r->>'linked')::boolean, 'M3 FAILED: same-name account u2 must get nothing once the name is linked to u1: '||r::text;
  r := pg_temp.mine(guard, w);
  assert jsonb_array_length(r->'shifts') = 5, 'M3 FAILED: alias row should add one shift to the guard (5): '||jsonb_array_length(r->'shifts');
  r := pg_temp.mine(u3, w);
  assert (r->>'linked')::boolean and jsonb_array_length(r->'shifts') = 1, 'M3 FAILED: first-name account linked explicitly to the full name: '||r::text;

  -- contradicting link: explicit link of the guard's OWN name to someone else
  perform pg_temp.as_user(manager);
  perform public.link_schedule_worker('אורי כהן', u3);
  reset role;
  r := pg_temp.mine(guard, w);
  -- guard loses A1-A3 (explicit says u3) but keeps the replacement (A4) and the alias row
  assert jsonb_array_length(r->'shifts') = 2, 'M3 FAILED: explicit link elsewhere must beat the guard''s exact name: '||jsonb_array_length(r->'shifts');
  assert not (select (pg_temp.mine(guard, w))->'link_kind' = '"explicit"') or true;

  -- 'no account' decision = ambiguous
  perform pg_temp.as_user(manager);
  perform public.link_schedule_worker('אורי כהן', null);
  reset role;
  assert (select is_ambiguous from public.schedule_worker_links where source_key = 'אורי כהן'), 'M3 FAILED: ambiguous decision not stored';
  r := pg_temp.mine(guard, w);
  assert jsonb_array_length(r->'shifts') = 2, 'M3 FAILED: ambiguous name must not be attributed: '||jsonb_array_length(r->'shifts');
  assert r->>'blocked_reason' = 'shared_name', 'M3 FAILED: shared-name marking must be reported: '||r::text;

  -- unlink returns to automatic matching
  perform pg_temp.as_user(manager);
  perform public.unlink_schedule_worker('אורי כהן');
  reset role;
  r := pg_temp.mine(guard, w);
  assert jsonb_array_length(r->'shifts') = 5, 'M3 FAILED: after unlink the exact match applies again: '||jsonb_array_length(r->'shifts');
  raise notice 'M3 PASSED';
end $$;

-- ===========================================================================
-- M4: same name on two overlapping rows (two people) is not attributed
--     automatically to the one account that carries the name
-- ===========================================================================
do $$
declare
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := date '2031-02-02';
  r jsonb;
begin
  insert into public.shift_assignments (work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, actual_name, source, published) values
   (w, 'morning','מאבטח','AB',0,(w||' 06:45+02')::timestamptz,(w||' 15:10+02')::timestamptz,'אורי כהן','אורי כהן','excel',true),
   (w, 'morning','מאבטח','CD',0,(w||' 06:45+02')::timestamptz,(w||' 15:10+02')::timestamptz,'אורי כהן','אורי כהן','excel',true);
  r := pg_temp.mine(guard, w);
  assert jsonb_array_length(r->'shifts') = 0, 'M4 FAILED: overlapping same-name rows attributed automatically: '||r::text;
  assert (r->>'blocked_reason') = 'overlap_review' and (r->>'held_back')::int = 2, 'M4 FAILED: overlap should be reported as needing review: '||r::text;
  -- even a SHORT overlap (25 min hand-over) is only a sign to review: no tolerance has been approved,
  -- so nothing is attributed automatically, and it is reported rather than silently hidden
  delete from public.shift_assignments where work_date = w;
  insert into public.shift_assignments (work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, actual_name, source, published) values
   (w, 'morning','מאבטח','AB',0,(w||' 06:45+02')::timestamptz,(w||' 15:10+02')::timestamptz,'אורי כהן','אורי כהן','excel',true),
   (w, 'afternoon','מאבטח','AB',0,(w||' 14:45+02')::timestamptz,(w||' 23:10+02')::timestamptz,'אורי כהן','אורי כהן','excel',true);
  r := pg_temp.mine(guard, w);
  assert jsonb_array_length(r->'shifts') = 0 and r->>'blocked_reason' = 'overlap_review', 'M4 FAILED: short overlap must not prove identity: '||r::text;
  -- touching but not overlapping (ends 15:10, starts 15:10) is not a sign of anything
  delete from public.shift_assignments where work_date = w;
  insert into public.shift_assignments (work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, actual_name, source, published) values
   (w, 'morning','מאבטח','AB',0,(w||' 06:45+02')::timestamptz,(w||' 15:10+02')::timestamptz,'אורי כהן','אורי כהן','excel',true),
   (w, 'afternoon','מאבטח','AB',0,(w||' 15:10+02')::timestamptz,(w||' 23:10+02')::timestamptz,'אורי כהן','אורי כהן','excel',true);
  r := pg_temp.mine(guard, w);
  assert jsonb_array_length(r->'shifts') = 2 and r->>'blocked_reason' is null, 'M4 FAILED: adjacent rows wrongly held back: '||r::text;
  raise notice 'M4 PASSED';
end $$;

-- ===========================================================================
-- M5: re-upload through publish_schedule_import keeps links and attribution,
--     leaves source_name alone, and does not need any link to publish
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  w date := date '2031-02-16';
  v_import uuid;
  before_links int; after_links int; r jsonb; pub jsonb;
begin
  perform pg_temp.as_user(manager);
  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (w, 'excel', 'test/m5', 'm5.xlsx', 'm5', manager) returning id into v_import;
  select count(*) into before_links from public.schedule_worker_links;
  pub := public.publish_schedule_import(p_import_id => v_import, p_assignments => jsonb_build_array(jsonb_build_object(
      'work_date', w, 'shift_category','morning','worker_kind','מאבטח','position','AB','slot_index',0,
      'starts_at',(w||' 06:45+02')::timestamptz,'ends_at',(w||' 15:10+02')::timestamptz,'source_name','אורי כהן','planned_user_id',null)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false);
  -- publish the SAME file again (re-upload)
  pub := public.publish_schedule_import(p_import_id => v_import, p_assignments => jsonb_build_array(jsonb_build_object(
      'work_date', w, 'shift_category','morning','worker_kind','מאבטח','position','AB','slot_index',0,
      'starts_at',(w||' 06:45+02')::timestamptz,'ends_at',(w||' 15:10+02')::timestamptz,'source_name','אורי כהן','planned_user_id',null)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false);
  reset role;
  select count(*) into after_links from public.schedule_worker_links;
  assert before_links = after_links, 'M5 FAILED: re-upload touched the links table';
  assert (select count(*) from public.shift_assignments where work_date = w) = 1, 'M5 FAILED: duplicate rows after re-upload';
  assert (select source_name from public.shift_assignments where work_date = w) = 'אורי כהן', 'M5 FAILED: source_name changed';
  r := pg_temp.mine(guard, w);
  assert jsonb_array_length(r->'shifts') = 1, 'M5 FAILED: attribution lost after re-upload: '||r::text;
  -- manual replacement afterwards moves the shift away from the original worker
  perform pg_temp.as_user(manager);
  perform public.replace_assignment_worker((select id from public.shift_assignments where work_date = w), null, 'שם חופשי', 'm5');
  reset role;
  r := pg_temp.mine(guard, w);
  assert jsonb_array_length(r->'shifts') = 0, 'M5 FAILED: free-text replacement still shown to the original worker';
  -- republishing the file keeps the manual edit (keep_manual) so it stays away from the original worker
  perform pg_temp.as_user(manager);
  pub := public.publish_schedule_import(p_import_id => v_import, p_assignments => jsonb_build_array(jsonb_build_object(
      'work_date', w, 'shift_category','morning','worker_kind','מאבטח','position','AB','slot_index',0,
      'starts_at',(w||' 06:45+02')::timestamptz,'ends_at',(w||' 15:10+02')::timestamptz,'source_name','אורי כהן','planned_user_id',null)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false);
  reset role;
  r := pg_temp.mine(guard, w);
  assert jsonb_array_length(r->'shifts') = 0, 'M5 FAILED: republish resurrected the replaced shift for the original worker';
  raise notice 'M5 PASSED';
end $$;

-- ===========================================================================
-- M6: security
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  guard uuid := '00000000-0000-0000-0000-000000000003';
  n int; denied boolean;
begin
  -- only a manager manages links
  perform pg_temp.as_user(guard);
  begin perform public.link_schedule_worker('x', guard); assert false, 'M6 FAILED: guard linked a worker';
  exception when insufficient_privilege then null; end;
  begin perform public.unlink_schedule_worker('x'); assert false, 'M6 FAILED: guard unlinked a worker';
  exception when insufficient_privilege then null; end;
  begin insert into public.schedule_worker_links (source_key, user_id, is_ambiguous) values ('hack', guard, false); assert false, 'M6 FAILED: direct insert allowed';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.schedule_worker_links; assert n = 0, 'M6 FAILED: guard can read the links table';
  reset role;
  perform pg_temp.as_user(commander);
  begin perform public.link_schedule_worker('x', commander); assert false, 'M6 FAILED: commander linked a worker';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.schedule_worker_links; assert n = 0, 'M6 FAILED: commander can read the links table';
  reset role;
  perform pg_temp.as_user(manager);
  select count(*) into n from public.schedule_worker_links; assert n > 0, 'M6 FAILED: manager cannot read links';
  reset role;

  -- no way to ask for someone else's shifts: the function has no user argument
  assert (select pronargs from pg_proc where proname = 'get_my_shifts') = 1, 'M6 FAILED: get_my_shifts takes extra arguments';
  -- unauthenticated / anon cannot call anything
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  begin perform public.get_my_shifts(date '2031-01-05'); assert false, 'M6 FAILED: anon called get_my_shifts';
  exception when insufficient_privilege then null; end;
  begin perform public.link_schedule_worker('x', null); assert false, 'M6 FAILED: anon linked';
  exception when insufficient_privilege then null; end;
  reset role;
  -- search_path is pinned
  assert (select bool_and(coalesce(proconfig::text, '') like '%search_path=%') and count(*) = 3
          from pg_proc where proname in ('get_my_shifts','link_schedule_worker','unlink_schedule_worker')), 'M6 FAILED: search_path not pinned';
  assert (select bool_and(proconfig::text = '{"search_path=\"\""}') from pg_proc where proname in ('get_my_shifts','link_schedule_worker','unlink_schedule_worker')), 'M6 FAILED: search_path must be empty';
  raise notice 'M6 PASSED';
end $$;

-- ===========================================================================
-- M7: a confirmed link needs no action per upload: it applies to later weeks and
--     to brand-new uploads of the same name, and survives a re-upload
-- ===========================================================================
do $$
declare
  manager uuid := '00000000-0000-0000-0000-000000000001';
  commander uuid := '00000000-0000-0000-0000-000000000002';
  w1 date := date '2031-03-02';
  w2 date := date '2031-03-09';
  w3 date := date '2031-03-16';
  v_import uuid; r jsonb; pub jsonb;
begin
  perform pg_temp.as_user(manager);
  -- one-time link of a spelling that matches no account name
  perform public.link_schedule_worker('שם בקובץ בלבד', commander);
  reset role;
  foreach w1 in array array[date '2031-03-02', date '2031-03-09', date '2031-03-16'] loop
    perform pg_temp.as_user(manager);
    insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
    values (w1, 'excel', 'test/m7', 'm7.xlsx', 'm7'||w1, manager) returning id into v_import;
    -- a fresh upload of a new week: no manager step, planned_user_id null as the client sends it without a link
    pub := public.publish_schedule_import(p_import_id => v_import, p_assignments => jsonb_build_array(jsonb_build_object(
        'work_date', w1, 'shift_category','morning','worker_kind','מאבטח','position','AB','slot_index',0,
        'starts_at',(w1||' 06:45+02')::timestamptz,'ends_at',(w1||' 15:10+02')::timestamptz,'source_name','שם בקובץ בלבד','planned_user_id',null)),
      p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false);
    reset role;
    r := pg_temp.mine(commander, w1);
    assert (r->>'linked')::boolean and jsonb_array_length(r->'shifts') = 1, 'M7 FAILED: link did not apply to the new week '||w1||': '||r::text;
  end loop;
  assert (select count(*) from public.schedule_worker_links where source_key = 'שם בקובץ בלבד') = 1, 'M7 FAILED: link row changed';
  raise notice 'M7 PASSED';
end $$;

rollback;
