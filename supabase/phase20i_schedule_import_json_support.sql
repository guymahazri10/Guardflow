-- supabase/phase20i_schedule_import_json_support.sql
--
-- Adds a third schedule-import input path alongside Excel and image: a
-- manager-prepared JSON file. Gemini's image reading is not always accurate
-- enough (reported directly), so a manager who wants guaranteed-correct
-- data can convert a screenshot to JSON themselves (with any AI tool of
-- their choice, given the documented schema) and upload that instead —
-- the JSON still goes through the exact same normalizeExtractedAssignments
-- validation/dedup/coverage pipeline as the image path (same shape:
-- {date, worker_kind, position, start, end, name}[]), just skipping the
-- vision-model step entirely. Additive only.

alter table public.schedule_imports
  drop constraint schedule_imports_source_kind_check;

alter table public.schedule_imports
  add constraint schedule_imports_source_kind_check
  check (source_kind in ('excel', 'pdf', 'image', 'json'));

-- shift_assignments.source is left untouched (still 'excel'|'pdf'|'image'|
-- 'manual') — publish_schedule_import already hardcodes 'excel' there for
-- every import regardless of source_kind (a pre-existing gap, not something
-- this migration introduces), so a JSON-sourced row will continue to be
-- written as 'excel' there, same as an image-sourced row already is today.

update storage.buckets
set allowed_mime_types = array[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/html',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/json'
]
where id = 'schedule-imports';
