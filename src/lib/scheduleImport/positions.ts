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
 * label itself doesn't need the shift baked into it.
 *
 * בקרה is intentionally absent — that section is never imported.
 */
export const CANONICAL_POSITIONS: Record<WorkerKind, string[]> = {
  'אחמ"ש': ['אחמ"ש בוקר', 'אחמ"ש צהריים', 'אחמ"ש לילה'],
  מאבטח: ['לובי עליון - חמוש', 'לובי תחתון', 'AB', 'CD', 'EFG', 'רכוב', 'לילה'],
}

export function isKnownPosition(workerKind: WorkerKind, position: string): boolean {
  return CANONICAL_POSITIONS[workerKind]?.includes(position) ?? false
}

/** Total number of distinct (worker kind, position) slots a complete week
 *  should cover — used for the preview's coverage report. */
export function totalCanonicalPositions(): number {
  return Object.values(CANONICAL_POSITIONS).reduce((sum, list) => sum + list.length, 0)
}
