import type { ShiftAssignment } from '../scheduleImports'

export function weeklyCellKey(workDate: string, shiftCategory: string, position: string): string {
  return `${workDate}|${shiftCategory}|${position}`
}

/**
 * Published rows only, bucketed per (day, shift, position) and ordered by
 * slot so a two-guard post shows both names in a stable order. The viewing
 * screen reads what the file said (or the manual replacement), never the
 * account link, so unlinked names are shown like any other.
 */
export function bucketPublishedAssignments(assignments: ShiftAssignment[]): Map<string, ShiftAssignment[]> {
  const map = new Map<string, ShiftAssignment[]>()
  for (const a of assignments) {
    if (!a.published) continue
    const key = weeklyCellKey(a.work_date, a.shift_category, a.position)
    const bucket = map.get(key)
    if (bucket) bucket.push(a)
    else map.set(key, [a])
  }
  for (const bucket of map.values()) bucket.sort((x, y) => x.slot_index - y.slot_index)
  return map
}

/**
 * Guard positions present in published data for a shift but missing from the
 * known list. Without this a published row on an unexpected post would exist
 * in the database yet be invisible on the weekly screen.
 */
export function extraGuardPositions(
  assignments: ShiftAssignment[],
  category: string,
  knownPositions: string[],
): string[] {
  const known = new Set(knownPositions)
  const extra = new Set<string>()
  for (const a of assignments) {
    if (!a.published || a.shift_category !== category || a.worker_kind === 'אחמ"ש') continue
    if (!known.has(a.position)) extra.add(a.position)
  }
  return [...extra].sort((a, b) => a.localeCompare(b, 'he'))
}
