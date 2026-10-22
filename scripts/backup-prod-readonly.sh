#!/usr/bin/env bash
# Read-only production backup via pg_dump (run inside the Postgres image from Docker).
# Credentials come from ~/.guardflow/prod.env (chmod 600), passed with --env-file:
# never on the command line, never printed, never in git.
set -euo pipefail

ENV_FILE="${GUARDFLOW_PROD_ENV:-$HOME/.guardflow/prod.env}"
IMAGE="${PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.165}"
OUT="${1:-$HOME/guardflow-prod-backup-pgdump/$(date -u +%Y%m%dT%H%M%SZ)}"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
[ "$(stat -f %Lp "$ENV_FILE")" = "600" ] || { echo "chmod 600 $ENV_FILE first"; exit 1; }
grep -Eq '^PGHOST=.+' "$ENV_FILE" && grep -Eq '^PGPASSWORD=.+' "$ENV_FILE" \
  || { echo "PGHOST / PGPASSWORD not filled in $ENV_FILE"; exit 1; }

mkdir -p "$OUT"; chmod 700 "$OUT"
# Every session is read-only on the server side.
run() { docker run --rm --env-file "$ENV_FILE" -e PGOPTIONS='-c default_transaction_read_only=on' \
          -v "$OUT":/out "$IMAGE" "$@"; }

echo "== server version"
run psql -X -At -c "select version()" | tee "$OUT/server_version.txt"

echo "== 1. public schema: structure + data, ONE transaction/snapshot (functions, constraints, ACLs, policies, data)"
run pg_dump -Fc --no-owner --schema=public --serializable-deferrable \
    --file=/out/public.dump

echo "== 2. plain-SQL structure of public (human-readable: functions, grants, policies)"
run pg_dump --no-owner --schema=public --schema-only --file=/out/public_schema.sql

echo "== 3. outside the public schema (not in the dump above)"
run psql -X -At -c "\copy (select policyname, tablename, cmd, roles, qual, with_check from pg_policies where schemaname='storage' order by 1,2) to '/out/storage_policies.tsv'"
run psql -X -At -c "\copy (select proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1, p.oid) to '/out/public_function_defs.tsv'"
run psql -X -At -c "\copy (select id from auth.users order by id) to '/out/auth_user_ids.csv'"   # UUIDs only: lets the test restore satisfy FKs

echo "== 4. per-table count + content digest (same SQL is re-run on the restored copy)"
run psql -X -At -c "
 select format('%s|%s', t.table_name,
   (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text)
 from information_schema.tables t where t.table_schema='public' and t.table_type='BASE TABLE' order by 1" \
  > "$OUT/counts_source.txt"

(cd "$OUT" && shasum -a 256 public.dump public_schema.sql > SHA256SUMS)
echo "done -> $OUT"; ls -la "$OUT"
