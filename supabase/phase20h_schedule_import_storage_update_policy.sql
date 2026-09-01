-- supabase/phase20h_schedule_import_storage_update_policy.sql

-- phase20d created select/insert/delete policies on storage.objects for the
-- schedule-imports bucket, but not update. uploadScheduleFile() uses
-- upsert: true so that re-uploading an identical file (same week_start +
-- content_hash, which createScheduleImport resolves back to the same
-- import id and therefore the same storage_path) reuses the existing
-- object instead of erroring as a duplicate — but Supabase Storage's
-- upsert path performs an UPDATE of the existing storage.objects row, not
-- a blind insert, so any manager retrying/re-uploading a file onto an
-- already-used key hit Postgres's default-deny RLS with no matching
-- policy: "new row violates row-level security policy".
create policy "schedule-imports manager update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'schedule-imports' and public.get_my_role() = 'מנהל')
  with check (bucket_id = 'schedule-imports' and public.get_my_role() = 'מנהל');
