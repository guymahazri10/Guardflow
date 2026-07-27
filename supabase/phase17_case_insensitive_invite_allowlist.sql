-- GuardFlow Phase 17 — case-insensitive pending_invites matching
--
-- Supabase always stores auth.users.email lowercase, but pending_invites.email
-- kept whatever case the invite form sent. A mixed-case address (e.g.
-- "JozefBlue@gmail.com") would insert into pending_invites fine, then the
-- BEFORE INSERT trigger's exact-string compare against the lowercased
-- new.email would fail, blocking the very invite that was just issued —
-- surfaced to the admin as "Database error saving new user". invite-user now
-- lowercases before writing, but the trigger comparisons are made
-- case-insensitive too as defense in depth against any other write path.

create or replace function public.check_invited_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.pending_invites where lower(email) = lower(new.email)) then
    raise exception 'ההרשמה פתוחה רק למי שהוזמן. פנה למנהל המערכת.';
  end if;
  return new;
end;
$$;

create or replace function public.apply_invited_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite record;
begin
  select app_role, full_name into invite from public.pending_invites where lower(email) = lower(new.email);

  if found then
    update public.profiles
      set app_role = invite.app_role,
          full_name = coalesce(public.profiles.full_name, invite.full_name)
      where id = new.id;

    delete from public.pending_invites where lower(email) = lower(new.email);
  end if;

  return new;
end;
$$;
