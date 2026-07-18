-- GuardFlow Phase 9 — manager-only rename of another user's display name
--
-- profiles' self-update policy (Phase 2A) already lets a user edit their own
-- full_name. UserManagementPage needs a manager to rename *other* users too.
-- Same pattern as set_user_app_role: a SECURITY DEFINER RPC that only ever
-- touches full_name, manager-only.

create or replace function public.set_user_full_name(
  target_user_id uuid,
  new_full_name text
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
    raise exception 'Not authorized to change user names' using errcode = '42501';
  end if;

  update public.profiles
  set full_name = nullif(trim(new_full_name), ''),
      updated_at = now()
  where id = target_user_id
  returning * into updated_row;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return updated_row;
end;
$$;

revoke all on function public.set_user_full_name(uuid, text) from public;
grant execute on function public.set_user_full_name(uuid, text) to authenticated;

comment on function public.set_user_full_name(uuid, text) is
  'Updates only profiles.full_name for any user. Manager-only; distinct from the self-update policy which only covers your own row.';
