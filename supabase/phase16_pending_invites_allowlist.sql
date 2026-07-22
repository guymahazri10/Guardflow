-- GuardFlow Phase 16 — invite-only signup allow-list, for Google Sign-In
--
-- Adding "Sign in with Google" means anyone with a Google account could
-- otherwise create themselves a GuardFlow user. pending_invites is the
-- allow-list: invite-user populates it before creating the auth user, and a
-- BEFORE INSERT trigger on auth.users rejects any signup (password or
-- Google) for an email that was never invited.

create table public.pending_invites (
  email text primary key,
  app_role text not null,
  full_name text,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.pending_invites is 'Allow-list for auth.users inserts: an email must appear here (via invite-user) before anyone can sign up with it, by password or Google.';

alter table public.pending_invites enable row level security;
grant all on public.pending_invites to service_role;

-- 1) Block auth.users inserts for emails that were never invited — covers
--    both self-serve email/password signup and "Sign in with Google" for a
--    brand-new email nobody invited.
create or replace function public.check_invited_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.pending_invites where email = new.email) then
    raise exception 'ההרשמה פתוחה רק למי שהוזמן. פנה למנהל המערכת.';
  end if;
  return new;
end;
$$;

create trigger check_invited_email_before_insert
  before insert on auth.users
  for each row
  execute function public.check_invited_email();

-- 2) Once the row (and its profiles row, via the existing
--    on_auth_user_created trigger) exists, carry over the role the admin
--    intended when they sent the invite — a safety net for any future path
--    where a brand-new auth.users row gets created for a pre-invited email
--    without invite-user's own profiles.update() running. Named to sort
--    after on_auth_user_created alphabetically so the profile row is
--    guaranteed to exist first.
create or replace function public.apply_invited_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite record;
begin
  select app_role, full_name into invite from public.pending_invites where email = new.email;

  if found then
    update public.profiles
      set app_role = invite.app_role,
          full_name = coalesce(public.profiles.full_name, invite.full_name)
      where id = new.id;

    delete from public.pending_invites where email = new.email;
  end if;

  return new;
end;
$$;

create trigger zzz_apply_invited_role_after_insert
  after insert on auth.users
  for each row
  execute function public.apply_invited_role();
