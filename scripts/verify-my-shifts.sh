#!/usr/bin/env bash
# Runs scripts/verify-my-shifts.sql against the local Supabase stack (everything is rolled back).
set -euo pipefail
docker exec -i supabase_db_guardflow psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$(dirname "$0")/verify-my-shifts.sql" 2>&1 | grep -E "PASSED|FAILED|ERROR|ASSERT" || true
