-- supabase/phase20_schedule_import_schema.sql
-- Additive only. Does not modify roster_boards, profiles, shift_templates,
-- or shift_types. See docs/superpowers/specs/2026-08-31-weekly-schedule-import-design.md

create table public.schedule_imports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  source_kind text not null check (source_kind in ('excel', 'pdf', 'image')),
  storage_path text not null,
  original_filename text not null,
  content_hash text not null,
  status text not null default 'processing'
    check (status in ('processing', 'ready_for_review', 'published', 'failed', 'cancelled')),
  stats jsonb not null default '{}',
  parse_warnings jsonb not null default '[]',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start, content_hash)
);

comment on table public.schedule_imports is
  'One row per uploaded weekly schedule file. Publishing writes shift_assignments via the publish_schedule_import RPC; this table never itself holds staffing data.';

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift_category text not null check (shift_category in ('morning', 'afternoon', 'night')),
  worker_kind text not null check (worker_kind in ('אחמ"ש', 'מאבטח')),
  position text not null,
  slot_index int not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source_name text,
  planned_user_id uuid references public.profiles(id),
  actual_user_id uuid references public.profiles(id),
  actual_name text,
  source text not null default 'excel' check (source in ('excel', 'pdf', 'image', 'manual')),
  import_id uuid references public.schedule_imports(id),
  is_manually_edited boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_date, shift_category, position, slot_index)
);

comment on table public.shift_assignments is
  'Dated staffing layer, separate from roster_boards.guard_names (which stays non-dated and unchanged). Written only via publish_schedule_import and replace_assignment_worker — no direct client writes.';

create index shift_assignments_work_date_idx on public.shift_assignments (work_date);

create table public.staffing_change_log (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.shift_assignments(id) on delete cascade,
  from_user_id uuid references public.profiles(id),
  from_name text,
  to_user_id uuid references public.profiles(id),
  to_name text,
  reason text,
  change_kind text not null check (
    change_kind in ('manual_replace', 'import_insert', 'import_update', 'import_kept_manual', 'import_revert_to_file')
  ),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);

comment on table public.staffing_change_log is
  'Audit trail for shift_assignments.actual_* changes, written only by publish_schedule_import and replace_assignment_worker.';

create table public.app_feature_flags (
  id text primary key,
  enabled boolean not null default false,
  allowed_user_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.app_feature_flags is
  'Simple manager-controlled feature flags. weekly_schedule_import gates the entire schedule-import UI and its Live-page integration.';

insert into public.app_feature_flags (id, enabled, allowed_user_ids)
values ('weekly_schedule_import', false, '{}');
