-- supabase/phase21_schedule_worker_links.sql
--
-- "My shifts" needs to know which schedule name belongs to which account.
-- shift_assignments.planned_user_id / actual_user_id cannot answer that:
-- planned_user_id mixes exact matches, old fuzzy matches and manual links with
-- nothing recording which is which, and actual_user_id is filled for every row
-- (it mirrors planned_user_id) even when nobody was replaced. A replacement is
-- recorded only by shift_assignments.is_manually_edited (set by
-- replace_assignment_worker, cleared by revert_to_file).
--
-- This migration adds an explicit, manager-made decision per schedule name,
-- and a read RPC for the signed-in user. It does NOT modify shift_assignments,
-- publish_schedule_import or replace_assignment_worker, and it rewrites no
-- existing link.
--
-- Name key: lower(NFC, whitespace collapsed, trimmed). Deliberately
-- conservative — punctuation is NOT stripped, so different names are never
-- merged. A spelling the key does not unify is fixed by an explicit link.

create or replace function public.person_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(regexp_replace(normalize(coalesce(p_name, ''), NFC), '\s+', ' ', 'g')));
$$;

revoke all on function public.person_name_key(text) from public, anon, authenticated;

create table public.schedule_worker_links (
  source_key text primary key,
  -- null user_id = the manager decided this name must not be attributed to any
  -- account (two different people share it, or it is otherwise unknowable).
  user_id uuid references public.profiles(id) on delete cascade,
  is_ambiguous boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_worker_links_decision check ((user_id is null) = is_ambiguous),
  constraint schedule_worker_links_key_normalised check (source_key = public.person_name_key(source_key) and source_key <> '')
);

create index schedule_worker_links_user_id_idx on public.schedule_worker_links (user_id);

alter table public.schedule_worker_links enable row level security;

-- Managers read the table directly; there is no insert/update/delete policy,
-- writes go only through the security-definer RPCs below.
create policy "schedule_worker_links select manager"
  on public.schedule_worker_links for select
  to authenticated
  using (public.get_my_role() = 'מנהל');

revoke all on public.schedule_worker_links from anon, authenticated;
grant select on public.schedule_worker_links to authenticated;

-- ---------------------------------------------------------------------------

create or replace function public.link_schedule_worker(p_source_name text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text := public.person_name_key(p_source_name);
begin
  if coalesce(public.get_my_role(), '') <> 'מנהל' then
    raise exception 'Only מנהל can link schedule workers' using errcode = '42501';
  end if;
  if k = '' then
    raise exception 'Empty schedule name';
  end if;
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Account not found';
  end if;

  insert into public.schedule_worker_links (source_key, user_id, is_ambiguous, created_by)
  values (k, p_user_id, p_user_id is null, auth.uid())
  on conflict (source_key) do update
    set user_id = excluded.user_id,
        is_ambiguous = excluded.is_ambiguous,
        created_by = excluded.created_by,
        updated_at = now();
end;
$$;

create or replace function public.unlink_schedule_worker(p_source_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(public.get_my_role(), '') <> 'מנהל' then
    raise exception 'Only מנהל can unlink schedule workers' using errcode = '42501';
  end if;
  delete from public.schedule_worker_links where source_key = public.person_name_key(p_source_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- The signed-in user's own published shifts for one week (Sunday-anchored
-- window, a night shift sits on its start date). The user is always
-- auth.uid(); no user id can be passed in.
--
-- A row is "mine" when:
--   * it was manually replaced (is_manually_edited) and actual_user_id is me —
--     the replacement is an explicit choice of an account. A free-text
--     replacement has no account and belongs to nobody (not to the original
--     worker either); or
--   * it was not replaced, and its name resolves to me:
--       1. an explicit manager link for the name -> that account (an explicit
--          decision always beats automatic matching; a "no account" decision
--          means nobody), else
--       2. my profile name equals the row's name (conservative key), exactly
--          one profile carries that name, the name appears in a published
--          schedule. (No account is attributed when two accounts carry the name
--          or the manager marked the name as shared.)
--
-- Overlapping times never hide a shift. Each returned shift carries
-- `overlaps` = true when it overlaps another shift attributed to the same
-- person, so the client can warn "check with the shift commander". Overlap is
-- a sign to check, not a reason to withhold the shift and not a rule about
-- publishing (publish checks are unchanged).
--
-- planned_user_id / actual_user_id on un-replaced rows are ignored: they may
-- come from an old fuzzy match.
--
-- Returns { linked, link_kind, blocked_reason, shifts }. linked says
-- whether the account can be identified at all, so an empty week can be told
-- apart from "no link". blocked_reason ('shared_name' | 'duplicate_accounts')
-- explains why a name that looks like mine is not attributed.

create or replace function public.get_my_shifts(p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_key text;
  explicit_linked boolean;
  exact_ok boolean;
  shifts jsonb;
  blocked text;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_week_start is null then
    raise exception 'Week start required';
  end if;

  select public.person_name_key(full_name) into my_key from public.profiles where id = me;

  explicit_linked := exists (select 1 from public.schedule_worker_links where user_id = me);

  exact_ok := coalesce(my_key, '') <> ''
    and (select count(*) from public.profiles p where public.person_name_key(p.full_name) = my_key) = 1
    and not exists (select 1 from public.schedule_worker_links l where l.source_key = my_key)
    -- an exact name only counts as a link once it really appears in a published
    -- schedule (any week): a profile "גיא" while the file says "גיא מהצרי" has
    -- no link, and must be told so rather than "no shifts this week"
    and exists (
      select 1 from public.shift_assignments s
      where s.published and public.person_name_key(s.source_name) = my_key
    );

  with mine as (
    -- Shifts attributed to me over the week plus one day either side, so an
    -- overlap with a night shift that crosses the week boundary is still seen.
    select a.id, a.work_date, a.shift_category, a.worker_kind, a.position, a.slot_index,
           a.starts_at, a.ends_at, a.source_name, a.actual_name, a.is_manually_edited
    from public.shift_assignments a
    where a.published
      and a.work_date between p_week_start - 1 and p_week_start + 7
      and (
        (a.is_manually_edited and a.actual_user_id = me)
        or (
          not a.is_manually_edited
          and (
            exists (
              select 1 from public.schedule_worker_links l
              where l.source_key = public.person_name_key(a.source_name) and l.user_id = me
            )
            or (exact_ok and public.person_name_key(a.source_name) = my_key)
          )
        )
      )
  )
  select coalesce(jsonb_agg(
           to_jsonb(m) || jsonb_build_object('overlaps', exists (
             select 1 from mine o where o.id <> m.id and least(m.ends_at, o.ends_at) > greatest(m.starts_at, o.starts_at)
           ))
           order by m.starts_at, m.position, m.slot_index), '[]'::jsonb)
  into shifts
  from mine m
  where m.work_date between p_week_start and p_week_start + 6;

  -- Why a name that looks like mine is NOT attributed, so the client can say so
  -- instead of "no shifts": the manager marked the name as shared by several
  -- people, or two accounts carry it.
  if coalesce(my_key, '') <> '' then
    if exists (select 1 from public.schedule_worker_links l where l.source_key = my_key and l.is_ambiguous) then
      blocked := 'shared_name';
    elsif not explicit_linked and (select count(*) from public.profiles p where public.person_name_key(p.full_name) = my_key) > 1 then
      blocked := 'duplicate_accounts';
    end if;
  end if;

  return jsonb_build_object(
    'linked', explicit_linked or exact_ok,
    'link_kind', case when explicit_linked then 'explicit' when exact_ok then 'exact' else null end,
    'blocked_reason', blocked,
    'shifts', shifts
  );
end;
$$;

revoke execute on function public.link_schedule_worker(text, uuid) from public, anon;
revoke execute on function public.unlink_schedule_worker(text) from public, anon;
revoke execute on function public.get_my_shifts(date) from public, anon;
grant execute on function public.link_schedule_worker(text, uuid) to authenticated;
grant execute on function public.unlink_schedule_worker(text) to authenticated;
grant execute on function public.get_my_shifts(date) to authenticated;
