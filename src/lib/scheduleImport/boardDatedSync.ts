import { SHIFT_CATEGORIES, type ShiftCategory } from '../../constants/shifts'
import { toLocalDateIso, addDaysIso } from '../israelTime'
import type { ShiftAssignment } from '../scheduleImports'
import { getImportPositionForSlot } from './liveBoardPositions'

/**
 * The work date a given shift category's currently-relevant board maps to.
 *
 * A night shift stays filed under the day it *started* (see
 * normalizeSchedule.ts), so between local midnight and the night category's
 * end hour the crew actually on duty is still yesterday's row even though
 * the wall clock has already rolled the calendar date over. Shared by the
 * live screen and the setup screen so they can never disagree about which
 * row is "the current one" — a divergence there would put the two screens
 * back to editing and displaying different assignments.
 */
export function workDateForCategory(category: ShiftCategory, now: Date): string {
  const todayIso = toLocalDateIso(now)
  return category === 'night' && now.getHours() < SHIFT_CATEGORIES.night.endHour
    ? addDaysIso(todayIso, -1)
    : todayIso
}

/** Sunday-anchored week start, matching fetchShiftAssignmentsForWeek's window. */
export function weekStartIsoFor(now: Date): string {
  const d = new Date(now)
  d.setDate(d.getDate() - d.getDay())
  return toLocalDateIso(d)
}

/**
 * Indexes the published dated assignments backing a board's slots, keyed by
 * the board's own slot label ("מאבטח 1"), via the slot -> imported position
 * map.
 *
 * Exists because the setup screen and the live screen were reading two
 * different sources for the same thing: setup showed
 * roster_boards.guard_names while the live screen, once schedule import
 * started matching, showed the dated shift_assignments row instead. They
 * genuinely disagreed in production — the night board's guard_names still
 * said "אורן"/"דניאל וינר" while the live screen showed "נדב מלקו"/
 * "פרנקי בראון" from the published import — so a manager "fixing the
 * schedule" in setup was editing names nothing displayed any more, and the
 * save looked like it did nothing. Confirmed against the live database:
 * every shift_assignments row had is_manually_edited=false and
 * staffing_change_log held zero manual_replace entries, so no edit from
 * that screen had ever reached the dated layer.
 */
export function indexDatedBySlot(
  assignments: ShiftAssignment[],
  cols: string[],
  shiftType: string,
  workDate: string,
): Map<string, ShiftAssignment> {
  const bySlot = new Map<string, ShiftAssignment>()
  for (const role of cols) {
    const position = getImportPositionForSlot(shiftType, role)
    if (!position) continue
    const match = assignments.find(
      (a) =>
        a.work_date === workDate &&
        a.shift_category === shiftType &&
        a.position === position &&
        a.published,
    )
    if (match) bySlot.set(role, match)
  }
  return bySlot
}

/** The name a dated assignment should display/seed with — a manual swap
 *  (actual_*) wins over the imported plan (source_name/planned_user_id). */
export function effectiveAssignmentName(assignment: ShiftAssignment): string {
  return assignment.actual_name ?? assignment.source_name ?? ''
}

export function effectiveAssignmentUserId(assignment: ShiftAssignment): string | null {
  return assignment.actual_user_id ?? assignment.planned_user_id ?? null
}
