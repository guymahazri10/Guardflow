-- supabase/phase20d_schedule_import_storage.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'schedule-imports',
  'schedule-imports',
  false,
  26214400, -- 25 MB
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/html',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

create policy "schedule-imports manager read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'schedule-imports' and public.get_my_role() = 'מנהל');

create policy "schedule-imports manager write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'schedule-imports' and public.get_my_role() = 'מנהל');

create policy "schedule-imports manager delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'schedule-imports' and public.get_my_role() = 'מנהל');
