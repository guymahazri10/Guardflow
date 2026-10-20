import type { ShiftCategory } from './types'
import { NIGHT_GUARD_LABEL, NIGHT_GUARD_ROLE } from './positions'

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
export const MAAVTACH_POSITION_ORDER: Record<ShiftCategory, string[]> = {
  morning: ['לובי עליון', 'לובי תחתון', 'AB', 'CD', 'EFG', 'רכוב'],
  afternoon: ['AB', 'CD', 'EFG', 'רכוב'],
  night: ['לובי עליון', 'לובי תחתון'],
}

/**
 * Per-category list above, for the night category specifically, describes
 * the two-guard board's two fixed לובי posts — it does NOT apply to the
 * one-guard night variant, whose sole slot is a rotating role (see
 * positions.ts's NIGHT_GUARD_LABEL), not a post that list already
 * covers. Overriding MAAVTACH_POSITION_ORDER.night itself for this would
 * retroactively change what the two-guard board's existing "מאבטח 1" slot
 * resolves to — this table instead holds *additional*, narrower overrides
 * keyed by (category, guard_count), consulted only when the caller knows
 * which variant it's asking about; the category-wide table above remains
 * the fallback for every variant with no override here, unchanged.
 *
 * guard_count, not shift_id, is the key: create_shift_type_variant derives
 * shift_id deterministically AS `${category}_${guard_count}` server-side
 * (supabase/phase19_shift_types.sql) and guarantees exactly one variant per
 * (category, guard_count) — so guard_count is the real stable fact an id
 * string is already just an encoding of, and it's available for free from
 * a board's own `cols` (see guardCountFromCols) without depending on the
 * id's exact slug format or fetching shift_types separately.
 */
const VARIANT_POSITION_ORDER_OVERRIDES: Partial<Record<string, string[]>> = {
  [variantOverrideKey('night', 1)]: [NIGHT_GUARD_LABEL],
}

function variantOverrideKey(category: ShiftCategory, guardCount: number): string {
  return `${category}:${guardCount}`
}

const SLOT_LABEL_PATTERN = /^מאבטח\s+(\d+)$/
const COMMANDER_LABEL_PATTERN = /^אחמ["'׳״]ש$/

function isKnownShiftCategory(value: string): value is ShiftCategory {
  return value === 'morning' || value === 'afternoon' || value === 'night'
}

/** Guard headcount implied by a board's own `cols` — every template's cols
 *  are exactly one אחמ"ש column plus N "מאבטח <k>" columns (see every
 *  phase19/phase20 template seed), so this never needs a separate
 *  shift_types lookup at a call site that already has the board. */
export function guardCountFromCols(cols: string[]): number {
  return cols.filter((c) => !COMMANDER_LABEL_PATTERN.test(c.trim())).length
}

/**
 * Returns the imported schedule's position name for a live-board slot
 * label, or null if the slot isn't one this mapping recognizes (an
 * unrecognized shift type, or a slot number beyond that shift's list —
 * callers should fall back to the legacy roster_boards.guard_names display
 * in that case, exactly as if the schedule-import feature didn't exist).
 * `guardCount`, when supplied, picks a variant-specific override over the
 * category-wide default — omit it (or pass the category's own default
 * headcount) to get the unchanged, pre-existing behavior.
 */
export function getImportPositionForSlot(shiftType: string, slotLabel: string, guardCount?: number): string | null {
  const trimmed = slotLabel.trim()
  if (COMMANDER_LABEL_PATTERN.test(trimmed)) return 'אחמ"ש'

  if (!isKnownShiftCategory(shiftType)) return null

  const match = SLOT_LABEL_PATTERN.exec(trimmed)
  if (!match) return null

  const index = Number(match[1]) - 1
  const override = guardCount !== undefined ? VARIANT_POSITION_ORDER_OVERRIDES[variantOverrideKey(shiftType, guardCount)] : undefined
  const order = override ?? MAAVTACH_POSITION_ORDER[shiftType]
  return order[index] ?? null
}

/** All positions that can ever appear for a category across every variant
 *  (the category-wide default list plus every variant override's own
 *  labels) — for read-only summary views (WeeklySchedulePage) that list
 *  every known position regardless of which variant happens to be live,
 *  not one specific board's slots. */
export function allKnownPositionsForCategory(category: ShiftCategory): string[] {
  const overrideLabels = Object.entries(VARIANT_POSITION_ORDER_OVERRIDES)
    .filter(([key]) => key.startsWith(`${category}:`))
    .flatMap(([, labels]) => labels ?? [])
  return [...new Set([...MAAVTACH_POSITION_ORDER[category], ...overrideLabels])]
}

/** Where a board slot's name lives in the dated layer. `slotIndex` is set
 *  only where the position alone can't identify the row (the night guard
 *  role, whose two guards are slot_index 0 and 1 under one label); for a
 *  physical post it is left undefined and the first row at that position
 *  matches, exactly as before. */
export type ImportSlotTarget = { position: string; slotIndex?: number }

/**
 * Every dated-assignment identity a board slot may be backed by, in priority
 * order. Position-only lookup (getImportPositionForSlot) can't express the
 * night guards, which the source files list as one "לילה מאבטח" row holding
 * one or two names: slot "מאבטח k" is that role's slot_index k-1, as long as
 * k does not exceed the role's maxCapacity. The legacy position target (the
 * לובי posts from earlier image imports) is kept first so rows that already
 * exist keep displaying exactly as they did; the role target is the
 * fallback. A slot with no matching row anywhere falls back to the legacy
 * guard_names — a single-guard night never invents a second person.
 */
export function getImportSlotTargets(shiftType: string, slotLabel: string, guardCount?: number): ImportSlotTarget[] {
  const legacy = getImportPositionForSlot(shiftType, slotLabel, guardCount)
  const targets: ImportSlotTarget[] = []
  if (legacy) targets.push(legacy === NIGHT_GUARD_LABEL ? { position: legacy, slotIndex: 0 } : { position: legacy })

  if (shiftType === 'night') {
    const match = SLOT_LABEL_PATTERN.exec(slotLabel.trim())
    const slotIndex = match ? Number(match[1]) - 1 : -1
    if (slotIndex >= 0 && slotIndex < NIGHT_GUARD_ROLE.maxCapacity && !targets.some((t) => t.position === NIGHT_GUARD_LABEL)) {
      targets.push({ position: NIGHT_GUARD_LABEL, slotIndex })
    }
  }
  return targets
}
