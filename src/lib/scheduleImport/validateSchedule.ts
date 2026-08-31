import type { MatchedAssignment, ValidatedSchedule, ValidationWarning } from './types'

export type ExistingAssignmentSummary = {
  work_date: string
  shift_category: string
  position: string
  slot_index: number
  is_manually_edited: boolean
}

function identityKey(a: { work_date: string; shift_category: string; position: string; slot_index: number }): string {
  return `${a.work_date}|${a.shift_category}|${a.position}|${a.slot_index}`
}

export function validateSchedule(
  assignments: MatchedAssignment[],
  existing: ExistingAssignmentSummary[],
): ValidatedSchedule {
  const warnings: ValidationWarning[] = []
  const seenKeys = new Map<string, number>()
  const existingByKey = new Map(existing.map((e) => [identityKey(e), e]))
  const conflicts: MatchedAssignment[] = []

  let unmatchedCount = 0

  for (const assignment of assignments) {
    const key = identityKey(assignment)
    seenKeys.set(key, (seenKeys.get(key) ?? 0) + 1)

    if (assignment.match_confidence === 'none') {
      unmatchedCount += 1
      warnings.push({
        kind: 'unmatched_name',
        message: `שם לא זוהה: ${assignment.source_name ?? '(ריק)'}`,
        work_date: assignment.work_date,
        position: assignment.position,
      })
    }

    const existingRow = existingByKey.get(key)
    if (existingRow?.is_manually_edited) {
      conflicts.push(assignment)
      warnings.push({
        kind: 'conflict_with_existing',
        message: `שיבוץ זה נערך ידנית ולא יידרס אוטומטית: ${assignment.position} ${assignment.work_date}`,
        work_date: assignment.work_date,
        position: assignment.position,
      })
    }
  }

  for (const [key, count] of seenKeys) {
    if (count > 1) {
      const [work_date, , position] = key.split('|')
      warnings.push({
        kind: 'duplicate_slot',
        message: `כפילות בקובץ: ${position} ${work_date}`,
        work_date,
        position,
      })
    }
  }

  return {
    assignments,
    warnings,
    conflicts,
    stats: {
      imported: assignments.length,
      skipped: 0,
      unmatched_names: unmatchedCount,
    },
  }
}
