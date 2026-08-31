#!/usr/bin/env bash
# scripts/verify-schedule-import-rpcs.sh
#
# Lightweight, documented, runnable regression check for the
# publish_schedule_import / replace_assignment_worker RPCs (supabase/phase20c_schedule_import_rpcs.sql).
# This is NOT a full test framework — Postgres RPCs with RLS + security
# definer + auth.uid() aren't easily unit-tested from Vitest, so this script
# runs the same kind of psql checks used during manual verification (Task 11
# Step 3 and the final-review fix pass) and asserts on the output, so future
# changes to these RPCs can be regression-checked with one command instead of
# re-deriving these checks by hand.
#
# Requires: the local Supabase stack running (`supabase_db_guardflow`
# container), with the phase20* migrations already applied.
#
# Usage: ./scripts/verify-schedule-import-rpcs.sh
# Exits non-zero on the first failed assertion.

set -euo pipefail

DB_CONTAINER="supabase_db_guardflow"
PSQL="docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA"

MANAGER_ID="00000000-0000-0000-0000-000000000001"
COMMANDER_ID="00000000-0000-0000-0000-000000000002"
GUARD_ID="00000000-0000-0000-0000-000000000003"

pass_count=0
fail_count=0

check() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  OK   - $description"
    pass_count=$((pass_count + 1))
  else
    echo "  FAIL - $description (expected [$expected], got [$actual])"
    fail_count=$((fail_count + 1))
  fi
}

echo "== Prerequisite: test users exist (created in Task 11 Step 3) =="
count=$($PSQL <<SQL
select count(*) from auth.users where id in ('${MANAGER_ID}', '${COMMANDER_ID}', '${GUARD_ID}');
SQL
)
check "3 test users present (manager/commander/guard)" "3" "$count"
if [ "$count" != "3" ]; then
  echo "Test users missing — run Task 11 Step 3's user creation first. Aborting."
  exit 1
fi

echo
echo "== 1. Non-manager cannot call publish_schedule_import (42501) =="
result=$( { $PSQL <<SQL
begin;
select set_config('request.jwt.claim.sub', '${GUARD_ID}', true);
select set_config('role', 'authenticated', true);
select public.publish_schedule_import(
  gen_random_uuid(),
  '[]'::jsonb,
  '{}'::jsonb,
  true
);
rollback;
SQL
} 2>&1 || true )
echo "$result" | grep -q "Only מנהל can publish" && check "guard rejected from publish_schedule_import" "yes" "yes" || check "guard rejected from publish_schedule_import" "yes" "no"

echo
echo "== 2. Idempotent re-publish of an identical import produces no new log entries =="
result=$($PSQL <<SQL
begin;
insert into public.schedule_imports (id, week_start, source_kind, storage_path, original_filename, content_hash, created_by)
values ('99999999-0000-0000-0000-000000000001', '2026-09-06', 'excel', 'verify/1.xlsx', 'v1.xlsx', 'verify-hash-1', '${MANAGER_ID}')
on conflict do nothing;

select set_config('request.jwt.claim.sub', '${MANAGER_ID}', true);
select set_config('role', 'authenticated', true);

select public.publish_schedule_import(
  '99999999-0000-0000-0000-000000000001'::uuid,
  '[{"work_date":"2026-09-06","shift_category":"morning","worker_kind":"מאבטח","position":"עמדת בדיקה","slot_index":0,"starts_at":"2026-09-06T04:00:00Z","ends_at":"2026-09-06T12:00:00Z","source_name":"בדיקה","planned_user_id":null}]'::jsonb,
  '{}'::jsonb,
  false
);
select public.publish_schedule_import(
  '99999999-0000-0000-0000-000000000001'::uuid,
  '[{"work_date":"2026-09-06","shift_category":"morning","worker_kind":"מאבטח","position":"עמדת בדיקה","slot_index":0,"starts_at":"2026-09-06T04:00:00Z","ends_at":"2026-09-06T12:00:00Z","source_name":"בדיקה","planned_user_id":null}]'::jsonb,
  '{}'::jsonb,
  false
);
select count(*) from public.staffing_change_log l
  join public.shift_assignments a on a.id = l.assignment_id
  where a.import_id = '99999999-0000-0000-0000-000000000001';
rollback;
SQL
)
log_count=$(echo "$result" | tail -1)
check "exactly one log entry after two identical publishes (2nd is a no-op)" "1" "$log_count"

echo
echo "== 3. A brand-new row logs 'import_insert' (not 'import_update') =="
result=$($PSQL <<SQL
begin;
insert into public.schedule_imports (id, week_start, source_kind, storage_path, original_filename, content_hash, created_by)
values ('99999999-0000-0000-0000-000000000002', '2026-09-06', 'excel', 'verify/2.xlsx', 'v2.xlsx', 'verify-hash-2', '${MANAGER_ID}')
on conflict do nothing;

select set_config('request.jwt.claim.sub', '${MANAGER_ID}', true);
select set_config('role', 'authenticated', true);

select public.publish_schedule_import(
  '99999999-0000-0000-0000-000000000002'::uuid,
  '[{"work_date":"2026-09-06","shift_category":"morning","worker_kind":"מאבטח","position":"עמדת בדיקה 2","slot_index":0,"starts_at":"2026-09-06T04:00:00Z","ends_at":"2026-09-06T12:00:00Z","source_name":"בדיקה","planned_user_id":null}]'::jsonb,
  '{}'::jsonb,
  false
);
select change_kind from public.staffing_change_log l
  join public.shift_assignments a on a.id = l.assignment_id
  where a.import_id = '99999999-0000-0000-0000-000000000002';
rollback;
SQL
)
change_kind=$(echo "$result" | tail -1)
check "new row logs import_insert" "import_insert" "$change_kind"

echo
echo "== 4. A manually-edited row survives re-upload unless resolution=revert_to_file =="
result=$($PSQL <<SQL
begin;
insert into public.schedule_imports (id, week_start, source_kind, storage_path, original_filename, content_hash, created_by)
values ('99999999-0000-0000-0000-000000000003', '2026-09-06', 'excel', 'verify/3.xlsx', 'v3.xlsx', 'verify-hash-3', '${MANAGER_ID}')
on conflict do nothing;
insert into public.shift_assignments (id, work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, actual_name, source, is_manually_edited, published)
values ('99999999-1111-0000-0000-000000000003', '2026-09-06', 'morning', 'מאבטח', 'עמדת בדיקה 3', 0, '2026-09-06T04:00:00Z', '2026-09-06T12:00:00Z', 'שם קובץ', 'שם ידני', 'excel', true, true);

select set_config('request.jwt.claim.sub', '${MANAGER_ID}', true);
select set_config('role', 'authenticated', true);

select public.publish_schedule_import(
  '99999999-0000-0000-0000-000000000003'::uuid,
  '[{"work_date":"2026-09-06","shift_category":"morning","worker_kind":"מאבטח","position":"עמדת בדיקה 3","slot_index":0,"starts_at":"2026-09-06T04:00:00Z","ends_at":"2026-09-06T12:00:00Z","source_name":"שם קובץ חדש","planned_user_id":null}]'::jsonb,
  '{}'::jsonb,
  false
);
select actual_name from public.shift_assignments where id = '99999999-1111-0000-0000-000000000003';
rollback;
SQL
)
actual_name=$(echo "$result" | tail -1)
check "manually-edited actual_name preserved (keep_manual default)" "שם ידני" "$actual_name"

echo
echo "== 5. Delete-sweep uses schedule_imports.week_start, not p_assignments[0] =="
result=$($PSQL <<SQL
begin;
insert into public.schedule_imports (id, week_start, source_kind, storage_path, original_filename, content_hash, created_by)
values ('99999999-0000-0000-0000-000000000004', '2026-09-06', 'excel', 'verify/4.xlsx', 'v4.xlsx', 'verify-hash-4', '${MANAGER_ID}')
on conflict do nothing;
insert into public.shift_assignments (work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, source, is_manually_edited, published)
values ('2026-09-06', 'afternoon', 'מאבטח', 'עמדה ישנה 4', 0, '2026-09-06T12:00:00Z', '2026-09-06T20:00:00Z', 'ישן', 'excel', false, true);

select set_config('request.jwt.claim.sub', '${MANAGER_ID}', true);
select set_config('role', 'authenticated', true);

-- First element's work_date (09-08) is NOT the week's Sunday (09-06).
select public.publish_schedule_import(
  '99999999-0000-0000-0000-000000000004'::uuid,
  '[{"work_date":"2026-09-08","shift_category":"morning","worker_kind":"מאבטח","position":"עמדה חדשה 4","slot_index":0,"starts_at":"2026-09-08T04:00:00Z","ends_at":"2026-09-08T12:00:00Z","source_name":"חדש","planned_user_id":null}]'::jsonb,
  '{}'::jsonb,
  false
);
select count(*) from public.shift_assignments where position = 'עמדה ישנה 4';
rollback;
SQL
)
remaining=$(echo "$result" | tail -1)
check "old non-manual row in the real week is swept" "0" "$remaining"

echo
echo "== 6. אחמ\"ש can only replace_assignment_worker on a currently-active assignment =="
result=$( { $PSQL <<SQL
begin;
insert into public.shift_assignments (id, work_date, shift_category, worker_kind, position, slot_index, starts_at, ends_at, source_name, source, is_manually_edited, published)
values ('99999999-2222-0000-0000-000000000005', current_date, 'morning', 'מאבטח', 'עמדה עתידית', 0, now() + interval '1 day', now() + interval '1 day 8 hours', 'עתידי', 'excel', false, true);

select set_config('request.jwt.claim.sub', '${COMMANDER_ID}', true);
select set_config('role', 'authenticated', true);

select public.replace_assignment_worker('99999999-2222-0000-0000-000000000005'::uuid, '${GUARD_ID}'::uuid, 'מחליף', 'בדיקה');
rollback;
SQL
} 2>&1 || true )
echo "$result" | grep -q 'יכול להחליף רק שיבוץ פעיל' && check "אחמ\"ש rejected from replacing a future (not-yet-active) assignment" "yes" "yes" || check "אחמ\"ש rejected from replacing a future (not-yet-active) assignment" "yes" "no"

echo
echo "=========================================="
echo "Passed: $pass_count   Failed: $fail_count"
echo "=========================================="
if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
