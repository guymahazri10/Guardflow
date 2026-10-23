#!/usr/bin/env bash
# Runs scripts/verify-schedule-edits.sql against the local Supabase stack (everything is rolled back).
set -uo pipefail
docker exec -i supabase_db_guardflow psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$(dirname "$0")/verify-schedule-edits.sql" 2>&1 | grep -E "PASSED|FAILED|ERROR|CONTEXT" | cut -c1-400
