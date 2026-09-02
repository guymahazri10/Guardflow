import type { WorkerKind } from './types'

/**
 * The canonical position list for the weekly schedule.
 *
 * The source table's structure is fixed week to week — only the names in the
 * cells change — so the positions can be a closed set rather than free text.
 * That matters for more than tidiness: `position` is part of
 * shift_assignments' uniqueness key (work_date, shift_category, position,
 * slot_index), so a position label that drifts between imports ("AB" one
 * week, "בוקר מאבטח AB 06:45-15:10" the next) stops updating the existing row
 * and silently inserts a duplicate instead. Free-text labels read off an
 * image drift exactly like that — observed directly, with the same row coming
 * back as "בוקר מאבטח AB" on one run and "בוקר מאבטח -06:45-AB\n15:10" on
 * another.
 *
 * This list is the single source of truth: it is sent to the parse function
 * to constrain what the model may return, and used again on the way back to
 * validate the response and to report coverage. Deliberately not duplicated
 * into the edge function — the client passes it in.
 *
 * The same label can legitimately appear under two shifts (AB runs both
 * morning and afternoon); shift_category keeps those rows distinct, so the
 * label itself doesn't need the shift baked into it. This is also why
 * "אחמ"ש" has a single bare entry rather than "אחמ"ש בוקר"/"אחמ"ש צהריים"/
 * "אחמ"ש לילה" — the shift period is already captured by shift_category,
 * baking it into the position too was pure redundancy, and it broke the
 * live board's lookup: the live board's dated-assignment matching
 * (liveBoardPositions.ts) needs one stable "אחמ"ש" position that exists
 * regardless of which shift's board is asking.
 *
 * The מאבטח list (לובי עליון/לובי תחתון/AB/CD/EFG/רכוב) is the union across
 * all three shift periods — a given shift only ever fills some of them
 * (night fills just the two לובי positions, afternoon skips לובי, morning
 * fills all six) — and is exactly the same list liveBoardPositions.ts maps
 * live-board guard slots onto, so a position extracted from an image and a
 * position looked up from the live board always compare as equal strings.
 * "חמוש" (armed) is a per-shift note on a slot, not part of a position's own
 * identity — לובי עליון is the same physical post whether or not that
 * shift's assignment happens to be armed — so it's dropped from the label
 * entirely rather than kept as "לובי עליון - חמוש".
 *
 * בקרה is intentionally absent — that section is never imported.
 */
export const CANONICAL_POSITIONS: Record<WorkerKind, string[]> = {
  'אחמ"ש': ['אחמ"ש'],
  מאבטח: ['לובי עליון', 'לובי תחתון', 'AB', 'CD', 'EFG', 'רכוב'],
}

export function isKnownPosition(workerKind: WorkerKind, position: string): boolean {
  return CANONICAL_POSITIONS[workerKind]?.includes(position) ?? false
}

/** Total number of distinct (worker kind, position) slots a complete week
 *  should cover — used for the preview's coverage report. */
export function totalCanonicalPositions(): number {
  return Object.values(CANONICAL_POSITIONS).reduce((sum, list) => sum + list.length, 0)
}
