-- supabase/phase22_rollback.sql
--
-- READ THIS FIRST. Rolling the CODE back never needs this file: phase22 is purely additive
-- for the previous client. Everything that client calls is unchanged (the 4-parameter
-- replace_assignment_worker, publish_schedule_import, get_my_shifts with the same signature and
-- result shape), so after a Vercel rollback the app keeps working without touching the database.
--
-- What a code rollback does NOT undo — and why it is not automatically safe once the feature has
-- been used: the previous client does not know about cancelled shifts. A cancelled (or moved-away)
-- shift is an unpublished marker row; the previous Live and Setup screens, finding no shift for
-- that slot, fall back to the name written in the board template. Verified locally against the
-- previous client: a cancelled אחמ"ש showed the old template name again. That only affects users
-- for whom the weekly_schedule_import flag is on (today only the manager). So before rolling the
-- code back, run the read-only check below. If it returns rows, prefer a forward fix; otherwise
-- have the manager restore those shifts (or accept the stale display for those slots) first.
--
--   -- PRE-ROLLBACK CHECK (read-only)
--   select work_date, shift_category, position, slot_index
--   from public.shift_assignments
--   where not published and is_manually_edited
--   order by work_date, shift_category, position, slot_index;
--
-- This file RETIRES the manager-edit functions only after the code no longer calls them.
-- It deliberately does NOT revert get_my_shifts (the phase21 version would misattribute shifts
-- whose hours or post were edited) and does NOT drop shift_worker_replaced, the staffing_change_log
-- details column or the widened change_kind list (history written by the new RPCs must stay).
-- It deletes no assignment, no cancelled marker and no history, and refuses to run while any
-- exist unless you explicitly confirm:   set guardflow.confirm_phase22_retire = 'yes';

do $$
begin
  if coalesce(current_setting('guardflow.confirm_phase22_retire', true), '') <> 'yes'
     and (
       exists (select 1 from public.shift_assignments where not published and is_manually_edited)
       or exists (select 1 from public.staffing_change_log where change_kind in ('manual_edit', 'manual_add', 'manual_cancel', 'manual_restore', 'manual_move'))
     )
  then
    raise exception 'Cancelled shifts or manual-edit history exist. Roll the code back first, read the PRE-ROLLBACK CHECK in this file, then run: set guardflow.confirm_phase22_retire = ''yes'';';
  end if;
end $$;

drop function if exists public.restore_shift_assignment(uuid, timestamptz, text);
drop function if exists public.cancel_shift_assignment(uuid, timestamptz, text);
drop function if exists public.add_shift_assignment(jsonb, text);
drop function if exists public.edit_shift_assignment(uuid, timestamptz, jsonb, text);
drop function if exists public.replace_assignment_worker(uuid, uuid, text, text, timestamptz);
drop function if exists public.get_cancelled_slots(date);
drop function if exists public.bump_schedule_revision();
drop function if exists public.require_edit_reason(date, text);
drop function if exists public.validate_shift_fields(date, text, text, text, int, timestamptz, timestamptz);
drop table if exists public.schedule_revisions;
-- kept on purpose: assignment_snapshot, shift_worker_replaced, get_my_shifts, staffing_change_log.details,
-- shift_assignments.worker_set_by_manager (get_my_shifts reads it)
