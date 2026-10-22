# Restoring the production `public` schema from a `backup-prod-readonly.sh` dump

No data, secrets or personal information in this file. Backups live outside the repo (`~/guardflow-prod-backup-pgdump/<timestamp>/`).

## What the backup contains / does not contain
Contains: `public` data, tables, constraints, indexes, functions, grants, RLS policies (`public.dump`, readable copy in `public_schema.sql`); `storage_policies.tsv`; `auth_user_ids.csv` (UUIDs only).
Does NOT contain: auth users (emails/passwords), Storage files, Edge Functions, secrets/Vault, cron jobs, other schemas.

## Procedure (verified on an isolated container, 2026-10-22)
1. Target must already have `auth.users` rows for every UUID in `auth_user_ids.csv` (real project: users exist; test container: insert the ids).
2. Do NOT `drop schema public`. The dump's `CREATE SCHEMA public` fails with "already exists" — harmless. Dropping and recreating the schema loses its owner (`pg_database_owner`) and the PUBLIC USAGE grant, which is a restore-procedure artifact, not a backup gap.
3. Restore as the role that must own the objects. Production owner is `postgres`:
   `pg_restore --no-owner -d <db> public.dump` connected as `postgres`.
   (Connecting as `supabase_admin` makes `supabase_admin` the owner; grants then name it as grantor.)
4. Expected, ignorable messages: `schema "public" already exists`, and `permission denied to change default privileges` for `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` (the defaults already exist on a Supabase project).
5. Verify with the same SQL on both sides: per-table count + md5, function-definition md5, and the ACL/RLS listing (`acl_query.sql` in the backup folder).

## Verified differences, restored vs production (all explained)
- Object owner `supabase_admin` vs `postgres` — from step 3, mapping them makes tables, functions, ACLs (incl. EXECUTE for PUBLIC / anon / authenticated), RLS flags and all 17 policies identical.
- Policy text `uid()` vs `auth.uid()` — display only (search_path of the viewing session); identical with `set search_path = public`.
- Schema `public` owner/ACL — only after dropping the schema (see step 2).
- Default ACLs for the `cron` schema exist in production but not in the Docker image (pg_cron absent) — outside `public`.
