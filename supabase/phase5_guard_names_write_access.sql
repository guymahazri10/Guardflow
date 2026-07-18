-- GuardFlow Phase 5 (build roadmap Phase 1) — guard_names write access for commander
--
-- roster_boards structure (cols/rows/shift_id/shift_type/notes/published) stays
-- manager-only, per the Phase 3A policies. Guard names must be writable by both
-- manager and commander (אחמ"ש) without granting either role structure access.
--
-- Approach: a SECURITY DEFINER RPC that only ever touches the guard_names
-- column. Row-level UPDATE policies can't express "this column only" on
-- their own, so the column restriction lives in the function body, not in a
-- new policy — the existing "roster_boards update manager" policy is untouched
-- and still governs direct table updates (e.g. from the roster editor).

create or replace function public.update_roster_board_guard_names(
  board_id uuid,
  new_guard_names jsonb
)
returns public.roster_boards
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.get_my_role();
  updated_row public.roster_boards;
begin
  if coalesce(caller_role, '') not in ('מנהל', 'אחמ"ש') then
    raise exception 'Not authorized to update guard names' using errcode = '42501';
  end if;

  if new_guard_names is null or jsonb_typeof(new_guard_names) <> 'object' then
    raise exception 'guard_names must be a JSON object' using errcode = '22023';
  end if;

  update public.roster_boards
  set guard_names = new_guard_names,
      updated_at = now()
  where id = board_id
  returning * into updated_row;

  if not found then
    raise exception 'Roster board not found' using errcode = 'P0002';
  end if;

  return updated_row;
end;
$$;

revoke all on function public.update_roster_board_guard_names(uuid, jsonb) from public;
grant execute on function public.update_roster_board_guard_names(uuid, jsonb) to authenticated;

comment on function public.update_roster_board_guard_names(uuid, jsonb) is
  'Updates only roster_boards.guard_names. Allowed for מנהל and אחמ"ש; structure fields (cols/rows/shift_id/shift_type/notes/published) remain manager-only via existing RLS policies and are never touched here.';
