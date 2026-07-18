-- GuardFlow Phase 6 (build roadmap Phase 5) — user management: manager visibility + role RPC
--
-- profiles RLS (Phase 2A) only lets a user read their own row, and its update
-- policy freezes app_role even for the owner. UserManagementPage needs a
-- manager to see every profile and change roles. Add a manager-wide SELECT
-- policy, and a SECURITY DEFINER RPC (same pattern as
-- update_roster_board_guard_names) that is the only path allowed to change
-- app_role — the existing self-update policy is untouched and still forbids
-- self-promotion.

drop policy if exists "profiles select own profile" on public.profiles;
create policy "profiles select own or manager"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id or public.get_my_role() = 'מנהל');

create or replace function public.set_user_app_role(
  target_user_id uuid,
  new_role text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.profiles;
begin
  if public.get_my_role() <> 'מנהל' then
    raise exception 'Not authorized to change roles' using errcode = '42501';
  end if;

  if new_role not in ('מנהל', 'אחמ"ש', 'מאבטח') then
    raise exception 'Invalid app_role value' using errcode = '22023';
  end if;

  update public.profiles
  set app_role = new_role,
      updated_at = now()
  where id = target_user_id
  returning * into updated_row;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return updated_row;
end;
$$;

revoke all on function public.set_user_app_role(uuid, text) from public;
grant execute on function public.set_user_app_role(uuid, text) to authenticated;

comment on function public.set_user_app_role(uuid, text) is
  'Updates only profiles.app_role. Manager-only; the ordinary profiles self-update policy still forbids self-role changes.';
