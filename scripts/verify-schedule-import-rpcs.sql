-- scripts/verify-schedule-import-rpcs.sql
--
-- Regression checks for publish_schedule_import's diff/safety behavior added
-- in phase20k_schedule_import_diff_and_safety.sql (dry-run diff correctness,
-- empty-array/week/delete-confirmation guards, manual-edit preservation,
-- the import_id-scoped delete sweep, and the actual_*/source correction on
-- non-manual re-uploads). Run by scripts/verify-schedule-import-rpcs.sh —
-- not meant to be run standalone against a database you care about, since it
-- calls set_config('role', ...) / SET LOCAL ROLE to impersonate different
-- callers.
--
-- All ten scenarios run inside ONE transaction that is rolled back at the
-- very end regardless of outcome (an uncaught exception aborts the whole
-- transaction too) — nothing here is meant to persist. Every RPC call uses
-- named parameters (p_import_id =>, p_assignments =>, ...) rather than
-- positional args, so a future reordering of publish_schedule_import's
-- parameters doesn't silently break these checks again the way phase20k's
-- p_confirmed_delete_ids insertion did to the older positional calls here.
begin;

do $$
declare
  test_week date;
begin
  select (date '2030-01-01' + ((7 - extract(dow from date '2030-01-01')::int) % 7)) into test_week;
  assert extract(dow from test_week) = 0, 'setup: test_week must be a Sunday';
  raise notice 'Using test week: %', test_week;
end $$;

-- ===========================================================================
-- T1: dry-run changes nothing (no shift_assignments writes, no status change)
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  test_week date := date '2030-01-06';
  v_import_id uuid;
  before_count int;
  after_count int;
  before_status text;
  after_status text;
  result jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t1', 't1.xlsx', 't1hash', manager_id)
  returning id into v_import_id;

  select count(*) into before_count from public.shift_assignments where import_id = v_import_id;
  select status into before_status from public.schedule_imports where id = v_import_id;

  result := public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(jsonb_build_object(
      'work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח',
      'position', 'AB', 'slot_index', 0,
      'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz,
      'source_name', 'בדיקה', 'planned_user_id', null
    )),
    p_resolutions => '{}'::jsonb,
    p_confirmed_delete_ids => '{}'::uuid[],
    p_dry_run => true
  );

  select count(*) into after_count from public.shift_assignments where import_id = v_import_id;
  select status into after_status from public.schedule_imports where id = v_import_id;

  assert before_count = 0 and after_count = 0, 'T1 FAILED: dry-run inserted a row';
  assert before_status = after_status, format('T1 FAILED: status changed from %s to %s on dry-run', before_status, after_status);
  assert (result -> 'to_insert') is not null and jsonb_array_length(result -> 'to_insert') = 1, 'T1 FAILED: expected 1 to_insert row in dry-run diff';
  raise notice 'T1 PASSED: dry-run wrote nothing, status unchanged (%), to_insert reported correctly', before_status;
end $$;

-- ===========================================================================
-- T2: to_insert / to_update / unchanged / to_keep_manual / to_delete /
-- conflicts all classified correctly across three publishes of the same week.
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  test_week date := date '2030-01-13';
  v_import_id uuid;
  result jsonb;
  existing_id_kept uuid;
  existing_id_gone uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t2a', 't2a.xlsx', 't2ahash', manager_id)
  returning id into v_import_id;

  -- First publish: two rows.
  result := public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(
      jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'עובד-נשאר', 'planned_user_id', null),
      jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'CD', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'עובד-ייעלם', 'planned_user_id', null)
    ),
    p_resolutions => '{}'::jsonb,
    p_confirmed_delete_ids => '{}'::uuid[],
    p_dry_run => false
  );
  assert jsonb_array_length(result -> 'to_insert') = 2, 'T2 setup FAILED: expected 2 inserts on first publish';

  select id into existing_id_kept from public.shift_assignments where import_id = v_import_id and position = 'AB';
  select id into existing_id_gone from public.shift_assignments where import_id = v_import_id and position = 'CD';

  -- Second publish (dry-run) with a new content_hash: AB unchanged, CD
  -- disappears from the file (should be deleted), EFG is new.
  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t2b', 't2b.xlsx', 't2bhash', manager_id)
  returning id into v_import_id;

  result := public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(
      jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'עובד-נשאר', 'planned_user_id', null),
      jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'EFG', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'עובד-חדש', 'planned_user_id', null)
    ),
    p_resolutions => '{}'::jsonb,
    p_confirmed_delete_ids => '{}'::uuid[],
    p_dry_run => true
  );

  assert jsonb_array_length(result -> 'to_insert') = 1, format('T2 FAILED: expected 1 to_insert (EFG), got %s', result -> 'to_insert');
  assert jsonb_array_length(result -> 'unchanged') = 1, format('T2 FAILED: expected 1 unchanged (AB), got %s', result -> 'unchanged');
  assert jsonb_array_length(result -> 'to_delete') = 1, format('T2 FAILED: expected 1 to_delete (CD), got %s', result -> 'to_delete');
  assert (result -> 'to_delete' -> 0 ->> 'id') = existing_id_gone::text, 'T2 FAILED: to_delete id does not match the CD row';

  -- Publish this dry-run's insert (EFG) for real, so the next round can
  -- exercise to_update against it, and mark it manually-edited to exercise
  -- to_keep_manual + conflicts together. AB must be included (unchanged) or
  -- a real publish would sweep it too — it's still absent-from-file
  -- otherwise. CD is still pending deletion from the earlier dry-run (round
  -- 2 never actually deleted it) — confirm it here so this real publish can
  -- go through.
  perform public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(
      jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'עובד-נשאר', 'planned_user_id', null),
      jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'EFG', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'עובד-חדש', 'planned_user_id', null)
    ),
    p_resolutions => '{}'::jsonb,
    p_confirmed_delete_ids => array[existing_id_gone],
    p_dry_run => false
  );
  -- Test fixture setup only (not exercising the RPC): shift_assignments has
  -- no UPDATE policy for any role, so this must run as the superuser
  -- (bypassing RLS) or it silently affects zero rows.
  reset role;
  update public.shift_assignments set is_manually_edited = true, actual_name = 'ידני-עדיין'
  where import_id = v_import_id and position = 'EFG';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);

  -- Third round: AB's hours change (to_update), EFG is manually-edited with
  -- file content that disagrees (conflicts, kept via to_keep_manual since no
  -- revert_to_file resolution is supplied).
  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t2c', 't2c.xlsx', 't2chash', manager_id)
  returning id into v_import_id;

  result := public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(
      jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
        'starts_at', (test_week || ' 07:00:00+02')::timestamptz, 'ends_at', (test_week || ' 15:00:00+02')::timestamptz, 'source_name', 'עובד-נשאר', 'planned_user_id', null),
      jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'EFG', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'שם-אחר-מהקובץ', 'planned_user_id', null)
    ),
    p_resolutions => '{}'::jsonb,
    p_confirmed_delete_ids => '{}'::uuid[],
    p_dry_run => true
  );

  assert jsonb_array_length(result -> 'to_update') = 1, format('T2 FAILED: expected 1 to_update (AB hours changed), got %s', result);
  assert (result -> 'to_update' -> 0 ->> 'position') = 'AB', 'T2 FAILED: to_update row is not AB';
  assert jsonb_array_length(result -> 'to_keep_manual') = 1, format('T2 FAILED: expected EFG in to_keep_manual, got %s', result);
  assert jsonb_array_length(result -> 'conflicts') = 1, format('T2 FAILED: expected EFG in conflicts (file disagrees with manual edit), got %s', result);

  raise notice 'T2 PASSED: to_insert/to_update/unchanged/to_keep_manual/to_delete/conflicts all classified correctly';
end $$;

-- ===========================================================================
-- T3: empty assignment array rejected, dry-run and real.
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  test_week date := date '2030-01-20';
  v_import_id uuid;
  threw boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t3', 't3.xlsx', 't3hash', manager_id)
  returning id into v_import_id;

  begin
    perform public.publish_schedule_import(
      p_import_id => v_import_id, p_assignments => '[]'::jsonb, p_resolutions => '{}'::jsonb,
      p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => true
    );
  exception when others then
    threw := true;
  end;
  assert threw, 'T3 FAILED: empty array did not raise on dry-run';

  threw := false;
  begin
    perform public.publish_schedule_import(
      p_import_id => v_import_id, p_assignments => '[]'::jsonb, p_resolutions => '{}'::jsonb,
      p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false
    );
  exception when others then
    threw := true;
  end;
  assert threw, 'T3 FAILED: empty array did not raise on real publish';

  raise notice 'T3 PASSED: empty array rejected in both modes';
end $$;

-- ===========================================================================
-- T4: a row outside the import's week is rejected.
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  test_week date := date '2030-01-27';
  v_import_id uuid;
  threw boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t4', 't4.xlsx', 't4hash', manager_id)
  returning id into v_import_id;

  begin
    perform public.publish_schedule_import(
      p_import_id => v_import_id,
      p_assignments => jsonb_build_array(jsonb_build_object(
        'work_date', test_week + 30, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'בדיקה', 'planned_user_id', null
      )),
      p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => true
    );
  exception when others then
    threw := true;
  end;
  assert threw, 'T4 FAILED: out-of-week date was not rejected';
  raise notice 'T4 PASSED: out-of-week row rejected';
end $$;

-- ===========================================================================
-- T5: a manually-edited assignment absent from the file is preserved
-- (appears in to_keep_manual, is not deleted).
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  test_week date := date '2030-02-03';
  v_import_id uuid;
  manual_row_id uuid;
  result jsonb;
  still_exists boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t5a', 't5a.xlsx', 't5ahash', manager_id)
  returning id into v_import_id;

  -- Publish once, then hand-edit the row to simulate a manual replacement
  -- (is_manually_edited = true), independent of any import.
  perform public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
      'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'מקורי', 'planned_user_id', null)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false
  );
  select id into manual_row_id from public.shift_assignments where import_id = v_import_id and position = 'AB';
  -- Test fixture setup only: same RLS note as above.
  reset role;
  update public.shift_assignments set is_manually_edited = true, actual_name = 'הוחלף-ידנית' where id = manual_row_id;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);

  -- Re-upload a file that no longer mentions the AB slot at all.
  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t5b', 't5b.xlsx', 't5bhash', manager_id)
  returning id into v_import_id;

  result := public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'CD', 'slot_index', 0,
      'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'אחר', 'planned_user_id', null)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => true
  );

  assert jsonb_array_length(result -> 'to_keep_manual') = 1, format('T5 FAILED: expected the manual AB row in to_keep_manual, got %s', result);
  assert (result -> 'to_keep_manual' -> 0 ->> 'id') = manual_row_id::text, 'T5 FAILED: to_keep_manual id mismatch';
  assert jsonb_array_length(result -> 'to_delete') = 0, 'T5 FAILED: the manually-edited row must never appear in to_delete';

  select exists(select 1 from public.shift_assignments where id = manual_row_id) into still_exists;
  assert still_exists, 'T5 FAILED: manual row was deleted by dry-run (should never happen)';

  raise notice 'T5 PASSED: manually-edited row absent from file preserved in to_keep_manual, not deleted';
end $$;

-- ===========================================================================
-- T6: a non-manual row with import_id IS NULL is never swept by the delete
-- pass, even though it matches every other delete criterion.
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  test_week date := date '2030-02-10';
  v_import_id uuid;
  orphan_id uuid;
  result jsonb;
  still_exists boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t6', 't6.xlsx', 't6hash', manager_id)
  returning id into v_import_id;

  -- A row with no import_id at all (e.g. hypothetically created some other
  -- way) must be immune to the delete-sweep regardless of is_manually_edited.
  -- Test fixture setup only: shift_assignments has no direct INSERT policy
  -- for any role (only the RPCs write), so this must run as the superuser.
  reset role;
  insert into public.shift_assignments (
    work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at,
    source_name, planned_user_id, actual_user_id, actual_name, source, import_id, is_manually_edited, published
  ) values (
    test_week, 'morning', 'מאבטח', 'AB', 0, (test_week || ' 06:00:00+02')::timestamptz, (test_week || ' 14:00:00+02')::timestamptz,
    'ללא-מקור-ייבוא', null, null, null, 'manual', null, false, true
  ) returning id into orphan_id;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);

  result := public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'CD', 'slot_index', 0,
      'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'אחר', 'planned_user_id', null)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => true
  );

  assert jsonb_array_length(result -> 'to_delete') = 0, format('T6 FAILED: the import_id IS NULL row must not be swept, got %s', result -> 'to_delete');
  select exists(select 1 from public.shift_assignments where id = orphan_id) into still_exists;
  assert still_exists, 'T6 FAILED: import_id IS NULL row must never be deleted';

  raise notice 'T6 PASSED: import_id IS NULL row immune to delete-sweep';
end $$;

-- ===========================================================================
-- T7: an unconfirmed deletion causes the ENTIRE publish to abort atomically —
-- no inserts/updates from the same call survive either.
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  test_week date := date '2030-02-17';
  v_import_id uuid;
  existing_id uuid;
  new_row_count_before int;
  threw boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t7a', 't7a.xlsx', 't7ahash', manager_id)
  returning id into v_import_id;

  perform public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
      'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'יימחק', 'planned_user_id', null)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false
  );
  select id into existing_id from public.shift_assignments where import_id = v_import_id and position = 'AB';

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t7b', 't7b.xlsx', 't7bhash', manager_id)
  returning id into v_import_id;

  select count(*) into new_row_count_before from public.shift_assignments where import_id = v_import_id;
  assert new_row_count_before = 0, 'T7 setup FAILED';

  -- Real publish with a brand-new insert (CD) AND the AB deletion pending,
  -- but confirmed_delete_ids is empty — must reject the whole call, and CD
  -- must NOT have been inserted either.
  begin
    perform public.publish_schedule_import(
      p_import_id => v_import_id,
      p_assignments => jsonb_build_array(jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'CD', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'חדש', 'planned_user_id', null)),
      p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false
    );
  exception when others then
    threw := true;
  end;
  assert threw, 'T7 FAILED: unconfirmed deletion did not raise';

  -- Atomicity check: neither the CD insert nor the AB deletion should have
  -- taken effect.
  assert exists(select 1 from public.shift_assignments where id = existing_id), 'T7 FAILED: AB row was deleted despite the abort (not atomic)';
  assert not exists(select 1 from public.shift_assignments where import_id = v_import_id and position = 'CD'), 'T7 FAILED: CD row was inserted despite the abort (not atomic)';

  raise notice 'T7 PASSED: unconfirmed deletion aborted the entire publish atomically';
end $$;

-- ===========================================================================
-- T8: publishing with a stale/incomplete confirmed-delete set (missing a row
-- the RPC recomputes as pending deletion) blocks the whole call — the same
-- guard that protects against a genuine race between dry-run and publish.
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  test_week date := date '2030-02-24';
  v_import_id uuid;
  ab_id uuid;
  result jsonb;
  confirmed uuid[];
  threw boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t8a', 't8a.xlsx', 't8ahash', manager_id)
  returning id into v_import_id;

  perform public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
      'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'א', 'planned_user_id', null)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false
  );
  select id into ab_id from public.shift_assignments where import_id = v_import_id and position = 'AB';

  -- New import, dry-run computes to_delete = [AB] (file has nothing).
  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t8b', 't8b.xlsx', 't8bhash', manager_id)
  returning id into v_import_id;

  result := public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(jsonb_build_object(
      'work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'ZZ_placeholder', 'slot_index', 0,
      'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'placeholder', 'planned_user_id', null
    )),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => true
  );
  assert jsonb_array_length(result -> 'to_delete') = 1, 'T8 setup FAILED: expected AB in to_delete';

  -- The manager publishes for real with an EMPTY confirmed-delete set —
  -- simulating a stale/incomplete confirmation from the client (e.g. the
  -- checkbox state got out of sync with the dry-run that was actually
  -- shown) — while AB is still a real pending deletion the RPC recomputes
  -- live at publish time. The mismatch between "confirmed" and "actually
  -- pending" must block the whole call, exactly as it would for a genuine
  -- race where a new deletion appeared after the manager's last dry-run.
  confirmed := '{}'::uuid[];

  begin
    perform public.publish_schedule_import(
      p_import_id => v_import_id,
      p_assignments => jsonb_build_array(jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'ZZ_placeholder', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'placeholder', 'planned_user_id', null)),
      p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => confirmed, p_dry_run => false
    );
  exception when others then
    threw := true;
  end;
  assert threw, 'T8 FAILED: a to_delete row missing from the confirmed set did not block publish';
  assert exists(select 1 from public.shift_assignments where id = ab_id), 'T8 FAILED: AB should not have been deleted (unconfirmed)';

  raise notice 'T8 PASSED: unconfirmed to_delete row blocks publish';
end $$;

-- ===========================================================================
-- T9: a non-manager (authenticated) and anon cannot publish at all.
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  guard_id uuid := '00000000-0000-0000-0000-000000000003';
  test_week date := date '2030-03-03';
  v_import_id uuid;
  threw boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t9', 't9.xlsx', 't9hash', manager_id)
  returning id into v_import_id;

  -- Non-manager (guard) — internal role check should reject.
  perform set_config('request.jwt.claims', json_build_object('sub', guard_id, 'role', 'authenticated')::text, true);
  begin
    perform public.publish_schedule_import(
      p_import_id => v_import_id,
      p_assignments => jsonb_build_array(jsonb_build_object(
        'work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'x', 'planned_user_id', null
      )),
      p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => true
    );
  exception when others then
    threw := true;
  end;
  assert threw, 'T9 FAILED: guard (non-manager) was able to call publish_schedule_import';

  -- anon — DB-level EXECUTE grant should reject before the function body runs.
  threw := false;
  set local role anon;
  begin
    perform public.publish_schedule_import(
      p_import_id => v_import_id,
      p_assignments => jsonb_build_array(jsonb_build_object(
        'work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
        'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'x', 'planned_user_id', null
      )),
      p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => true
    );
  exception when others then
    threw := true;
  end;
  assert threw, 'T9 FAILED: anon was able to call publish_schedule_import';
  reset role;

  raise notice 'T9 PASSED: non-manager and anon both rejected';
end $$;

-- ===========================================================================
-- T10: a corrected re-upload updates planned_*, actual_*, source and
-- import_id for a non-manually-edited row.
-- ===========================================================================
do $$
declare
  manager_id uuid := '00000000-0000-0000-0000-000000000001';
  guard_id uuid := '00000000-0000-0000-0000-000000000003';
  commander_id uuid := '00000000-0000-0000-0000-000000000002';
  test_week date := date '2030-03-10';
  v_import_id uuid;
  row_id uuid;
  row_after public.shift_assignments;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', manager_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'image', 'test/t10a', 't10a.png', 't10ahash', manager_id)
  returning id into v_import_id;

  -- First publish: wrong worker (guard), sourced from an image import.
  perform public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
      'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'שם-שגוי', 'planned_user_id', guard_id)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false
  );
  select id into row_id from public.shift_assignments where import_id = v_import_id and position = 'AB';

  -- Corrected re-upload via a different source_kind (excel), same slot, real worker.
  insert into public.schedule_imports (week_start, source_kind, storage_path, original_filename, content_hash, created_by)
  values (test_week, 'excel', 'test/t10b', 't10b.xlsx', 't10bhash', manager_id)
  returning id into v_import_id;

  perform public.publish_schedule_import(
    p_import_id => v_import_id,
    p_assignments => jsonb_build_array(jsonb_build_object('work_date', test_week, 'shift_category', 'morning', 'worker_kind', 'מאבטח', 'position', 'AB', 'slot_index', 0,
      'starts_at', (test_week || ' 06:00:00+02')::timestamptz, 'ends_at', (test_week || ' 14:00:00+02')::timestamptz, 'source_name', 'שם-נכון', 'planned_user_id', commander_id)),
    p_resolutions => '{}'::jsonb, p_confirmed_delete_ids => '{}'::uuid[], p_dry_run => false
  );

  select * into row_after from public.shift_assignments where id = row_id;

  assert row_after.planned_user_id = commander_id, 'T10 FAILED: planned_user_id not updated';
  assert row_after.actual_user_id = commander_id, 'T10 FAILED: actual_user_id not updated to match the correction';
  assert row_after.actual_name = 'שם-נכון', 'T10 FAILED: actual_name not updated';
  assert row_after.source = 'excel', format('T10 FAILED: source not updated to the new import''s source_kind, got %s', row_after.source);
  assert row_after.import_id = v_import_id, 'T10 FAILED: import_id not updated to the latest import';

  raise notice 'T10 PASSED: corrected re-upload updated planned_*/actual_*/source/import_id correctly';
end $$;

do $$
begin
  raise notice '=== ALL phase20k SCENARIOS PASSED ===';
end $$;

rollback;
