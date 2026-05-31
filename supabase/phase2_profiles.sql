-- GuardFlow Phase 2A profiles and role foundation

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  app_role text not null default 'מאבטח',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_app_role_check check (app_role in ('מנהל', 'אחמ"ש', 'מאבטח'))
);

comment on table public.profiles is 'Stores Supabase user profile details and GuardFlow app role.';
comment on column public.profiles.app_role is 'Allowed values: מנהל, אחמ"ש, מאבטח.';

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_profiles_updated_at();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user_profile();

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select app_role
  from public.profiles
  where id = auth.uid()
$$;

revoke all on function public.get_my_role() from public;
grant execute on function public.get_my_role() to authenticated;

revoke all on function public.handle_new_user_profile() from public;
revoke all on function public.set_profiles_updated_at() from public;

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "profiles select own profile" on public.profiles;
create policy "profiles select own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles update own non role fields" on public.profiles;
create policy "profiles update own non role fields"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and app_role = public.get_my_role()
  );

-- Phase 2A policy note:
-- Authenticated users may read their own profile and update only granted non-role fields.
-- Do not allow users to promote themselves or change app_role.
-- TODO Phase 2B: add manager-only role-management policies for updating app_role.

-- Final intended policy plan:
-- roster_boards:
-- read: authenticated
-- create/update/delete: manager only
--
-- shift_staffing:
-- read: authenticated
-- create/update: manager or shift commander
-- delete: manager only
--
-- Architecture rule:
-- guard_names must stay only in public.shift_staffing, never in public.roster_boards.
