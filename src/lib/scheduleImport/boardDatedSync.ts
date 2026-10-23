import { SHIFT_CATEGORIES, type ShiftCategory } from '../../constants/shifts'
import { toLocalDateIso, addDaysIso } from '../israelTime'
import type { ShiftAssignment } from '../scheduleImports'
import { getImportSlotTargets, guardCountFromCols, type ImportSlotTarget } from './liveBoardPositions'

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
  const guardCount = guardCountFromCols(cols)
  for (const role of cols) {
    const match = findDatedForSlot(
      assignments,
      getImportSlotTargets(shiftType, role, guardCount),
      workDate,
      shiftType,
    )
    if (match) bySlot.set(role, match)
  }
  return bySlot
}

/** First published assignment matching any of a slot's targets, in priority
 *  order. Shared with the live screen so both resolve a slot identically. */
export function findDatedForSlot(
  assignments: ShiftAssignment[],
  targets: ImportSlotTarget[],
  workDate: string,
  category: string,
): ShiftAssignment | undefined {
  for (const target of targets) {
    const match = assignments.find(
      (a) =>
        a.work_date === workDate &&
        a.shift_category === category &&
        a.position === target.position &&
        (target.slotIndex === undefined || a.slot_index === target.slotIndex) &&
        a.published,
    )
    if (match) return match
  }
  return undefined
}

/** What every role is told about a cancelled shift (see get_cancelled_slots). */
export type CancelledSlotRef = { work_date: string; shift_category: string; position: string; slot_index: number }

/** A cancelled shift on one of a slot's targets, when no live shift is there. The slot
 *  must then show as empty — never fall back to the name written in the board template
 *  (roster_boards.guard_names), which is stale by definition. Works from the minimal
 *  cancelled-slot list, because a non-manager cannot read the cancelled row itself. */
export function findCancelledForSlot(
  cancelled: CancelledSlotRef[],
  liveAssignments: ShiftAssignment[],
  targets: ImportSlotTarget[],
  workDate: string,
  category: string,
): CancelledSlotRef | undefined {
  if (findDatedForSlot(liveAssignments, targets, workDate, category)) return undefined
  for (const target of targets) {
    const match = cancelled.find(
      (c) =>
        c.work_date === workDate &&
        c.shift_category === category &&
        c.position === target.position &&
        (target.slotIndex === undefined || c.slot_index === target.slotIndex),
    )
    if (match) return match
  }
  return undefined
}

/** Board slots whose dated shift is cancelled (see findCancelledForSlot). */
export function indexCancelledBySlot(
  cancelled: CancelledSlotRef[],
  liveAssignments: ShiftAssignment[],
  cols: string[],
  shiftType: string,
  workDate: string,
): Map<string, CancelledSlotRef> {
  const bySlot = new Map<string, CancelledSlotRef>()
  const guardCount = guardCountFromCols(cols)
  for (const role of cols) {
    const match = findCancelledForSlot(cancelled, liveAssignments, getImportSlotTargets(shiftType, role, guardCount), workDate, shiftType)
    if (match) bySlot.set(role, match)
  }
  return bySlot
}

/** guard_names to save: a slot whose shift is cancelled keeps its template value
 *  untouched (the template is not part of a dated cancellation). */
export function keepTemplateNamesForSlots<T>(
  guardNames: Record<string, T>,
  template: Record<string, T> | null | undefined,
  slots: Iterable<string>,
): Record<string, T> {
  const next = { ...guardNames }
  for (const role of slots) {
    if (template && role in template) next[role] = template[role]
    else delete next[role]
  }
  return next
}

/** The name a dated assignment should display/seed with — a manual swap
 *  (actual_*) wins over the imported plan (source_name/planned_user_id). */
export function effectiveAssignmentName(assignment: ShiftAssignment): string {
  return assignment.actual_name ?? assignment.source_name ?? ''
}

export function effectiveAssignmentUserId(assignment: ShiftAssignment): string | null {
  return assignment.actual_user_id ?? assignment.planned_user_id ?? null
}

/**
 * The board slots an אחמ"ש may NOT edit on the setup screen: every slot backed
 * by a dated (imported) assignment. Only a מנהל writes dated rows from there;
 * for an אחמ"ש, a save would store legacy guard_names the live screen never
 * reads and look successful while changing nothing that is displayed. They
 * replace a worker on the active shift from the live screen instead.
 */
export function lockedSlotsForSetup(input: {
  isAdmin: boolean
  isCommander: boolean
  importEnabled: boolean
  datedBySlot: ReadonlyMap<string, unknown>
  /** Slots whose shift was cancelled: shown empty and read-only for everyone. */
  cancelledBySlot?: ReadonlyMap<string, unknown>
}): Set<string> {
  if (!input.importEnabled) return new Set()
  const locked = new Set<string>(input.cancelledBySlot?.keys() ?? [])
  if (!input.isAdmin && input.isCommander) for (const k of input.datedBySlot.keys()) locked.add(k)
  return locked
}
