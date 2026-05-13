-- GuardFlow Phase 1 schema draft

create table if not exists public.roster_boards (
  id uuid primary key default gen_random_uuid(),
  shift_id text not null,
  shift_type text not null,
  cols jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  notes text,
  published boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.roster_boards is 'Stores schedule structure only. Never store guard names here.';

create table if not exists public.shift_staffing (
  id uuid primary key default gen_random_uuid(),
  shift_id text not null,
  shift_date date not null,
  guard_names jsonb not null default '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_id, shift_date)
);