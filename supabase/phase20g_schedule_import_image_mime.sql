-- supabase/phase20g_schedule_import_image_mime.sql
--
-- Adds image/png and image/jpeg to the schedule-imports bucket's allowed
-- MIME types, for the client-side OCR image import path (see
-- docs/superpowers/specs/2026-09-01-image-schedule-import-design.md). A new
-- migration rather than editing phase20d_schedule_import_storage.sql, since
-- that file's `insert ... on conflict do nothing` would silently no-op
-- against the bucket that already exists.

update storage.buckets
set allowed_mime_types = array[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/html',
  'application/pdf',
  'image/png',
  'image/jpeg'
]
where id = 'schedule-imports';
