-- Local database only. Reuse existing accounts, with temporary boards rolled back at the end.
begin;
do $$
declare
  commander uuid; guard uuid; crew jsonb; three uuid; five uuid; a public.shift_assignments;
  version timestamptz; changes jsonb; d date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  select id into strict commander from public.profiles where app_role = 'אחמ"ש' limit 1;
  select id, jsonb_build_object('מאבטח 1', jsonb_build_object('name', full_name, 'user_id', id))
    into strict guard, crew from public.profiles where app_role = 'מאבטח' limit 1;
  insert into public.shift_types(id,category,guard_count,sort_order) values ('qa_three','morning',3,911),('qa_five','morning',5,912) on conflict (category,guard_count) do nothing;
  insert into public.roster_boards(shift_id, shift_type, cols, rows, published)
    select (select id from public.shift_types where category='morning' and guard_count=3),'morning','["מאבטח 1","מאבטח 2","מאבטח 3"]',rows,true
    from public.roster_boards where jsonb_array_length(rows)>0 limit 1 returning id into strict three;
  insert into public.roster_boards(shift_id, shift_type, cols, rows, published)
    select (select id from public.shift_types where category='morning' and guard_count=5),'morning',cols || '["מאבטח 4","מאבטח 5"]'::jsonb,rows,false
    from public.roster_boards where id=three returning id,updated_at into five,version;
  insert into public.shift_assignments(work_date,shift_category,worker_kind,position,starts_at,ends_at,published)
    values(d,'morning','מאבטח','QA setup',now()+interval '1 hour',now()+interval '2 hours',true) returning * into a;
  changes := jsonb_build_array(jsonb_build_object('id',a.id,'expected_at',a.updated_at,'name',crew->'מאבטח 1'->>'name','user_id',guard));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',commander,'role','authenticated')::text,true);
  set local role authenticated;
  perform public.save_shift_setup(five,version,crew,d,changes);
  assert (select published and guard_names=crew from public.roster_boards where id=five);
  assert not (select published from public.roster_boards where id=three);
  assert (select count(*)=1 from public.roster_boards where shift_type='morning' and published);
  assert (select actual_user_id=guard from public.shift_assignments where id=a.id);
  begin
    perform public.save_shift_setup(three,(select updated_at from public.roster_boards where id=three),crew,d,changes);
    raise exception 'stale change accepted';
  exception when serialization_failure then null; end;
  assert (select published from public.roster_boards where id=five);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',guard,'role','authenticated')::text,true);
  begin
    perform public.save_shift_setup(five,version,crew,d,'[]');
    raise exception 'guard write accepted';
  exception when insufficient_privilege then null; end;
  raise notice 'PASSED commander 3-to-5, future assignment, stale save rollback, guard read-only';
end $$;
rollback;
