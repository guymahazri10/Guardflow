import type { ShiftCategory } from './types'

/**
 * Maps a live roster board's guard SLOT ("מאבטח 3") to the named physical
 * position it corresponds to in the imported weekly schedule ("AB") — used
 * only to look up the dated shift_assignments row for that slot, never to
 * rename or restructure the board itself.
 *
 * This exists because the live board's columns ("מאבטח 1".."מאבטח 6") and
 * the imported schedule's positions ("AB", "לובי עליון", ...) are two
 * different, real, and both-correct data models that happen to describe
 * overlapping information:
 *
 * - roster_boards.cols/rows describe a DUTY ROTATION: guard slot N does a
 *   sequence of different tasks across the shift (checked directly against
 *   production data — "מאבטח 3" on the morning board rotates through
 *   "לובי עליון", "כונן", "הפסקת אוכל", "עמדת כיכר" etc. over the course of
 *   one shift). The slot label is a guard identity, not a fixed post.
 * - shift_assignments (from the weekly import) names WHO holds a given named
 *   physical POST for the whole shift period — "AB" gets one person for the
 *   entire morning, independent of what rotation task they're doing at any
 *   given half-hour.
 *
 * Renaming the board's columns to match the imported position names would
 * misrepresent the rotation (a slot isn't "AB" all shift — it only starts
 * there) and would require migrating every board's existing cols/rows/
 * guard_names keys in place, at real risk to data actively used every shift.
 * This mapping instead sits entirely outside both models: it only decides,
 * for the purpose of finding a dated assignment, which named post a given
 * slot's guard is nominally responsible for that shift.
 *
 * The order was provided directly by the manager (2026-09) for each shift
 * type; slot N maps to the Nth position in that shift's list, so a smaller
 * crew (fewer מאבטח slots than the list) simply gets the first N positions.
 * "חמוש" (armed) is a note on a specific slot in a specific shift, not part
 * of the physical position's own identity, so it's dropped for matching —
 * לובי עליון is the same position in every shift whether or not that
 * shift's manning happens to be armed.
 */
const MAAVTACH_POSITION_ORDER: Record<ShiftCategory, string[]> = {
  morning: ['לובי עליון', 'לובי תחתון', 'AB', 'CD', 'EFG', 'רכוב'],
  afternoon: ['AB', 'CD', 'EFG', 'רכוב'],
  night: ['לובי עליון', 'לובי תחתון'],
}

const SLOT_LABEL_PATTERN = /^מאבטח\s+(\d+)$/

function isKnownShiftCategory(value: string): value is ShiftCategory {
  return value === 'morning' || value === 'afternoon' || value === 'night'
}

/**
 * Returns the imported schedule's position name for a live-board slot
 * label, or null if the slot isn't one this mapping recognizes (an
 * unrecognized shift type, or a slot number beyond that shift's list —
 * callers should fall back to the legacy roster_boards.guard_names display
 * in that case, exactly as if the schedule-import feature didn't exist).
 */
export function getImportPositionForSlot(shiftType: string, slotLabel: string): string | null {
  const trimmed = slotLabel.trim()
  if (trimmed.replace(/["'׳״]/g, '"') === 'אחמ"ש') return 'אחמ"ש'

  if (!isKnownShiftCategory(shiftType)) return null

  const match = SLOT_LABEL_PATTERN.exec(trimmed)
  if (!match) return null

  const index = Number(match[1]) - 1
  return MAAVTACH_POSITION_ORDER[shiftType][index] ?? null
}
