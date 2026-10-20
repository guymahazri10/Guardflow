import type { PublishDiffRow } from '../scheduleImports'
import type { ValidationWarning } from './types'

/**
 * Flags a worker scheduled in two overlapping shifts after publish.
 *
 * Runs on the *effective* post-publish schedule — the union of a dry-run's
 * to_insert/to_update/unchanged/to_keep_manual rows (never to_delete, which
 * won't exist after publish) — not on the raw uploaded rows. A manually-
 * edited assignment that's absent from the file entirely still occupies the
 * worker's time after publish (it lands in to_keep_manual), so it has to be
 * considered here too, or a double-booking against it would go undetected.
 *
 * Identity uses actual_user_id ?? planned_user_id (falling back to the raw
 * name only when neither id is known): a manually-replaced assignment's
 * planned_user_id is who the file originally said, not who is actually
 * working it, so grouping by planned_user_id alone would miss a real
 * conflict involving the replacement worker.
 */
export function detectOverlaps(rows: PublishDiffRow[]): ValidationWarning[] {
  const groups = new Map<string, PublishDiffRow[]>()

  for (const row of rows) {
    const identity = row.actual_user_id ?? row.planned_user_id ?? `name:${row.actual_name ?? row.source_name ?? ''}`
    if (!identity || identity === 'name:') continue
    const group = groups.get(identity) ?? []
    group.push(row)
    groups.set(identity, group)
  }

  const warnings: ValidationWarning[] = []

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]
        if (b.starts_at >= a.ends_at) break // sorted by starts_at — no later row can overlap once this one starts after a ends
        const name = a.actual_name ?? a.source_name ?? '?'
        warnings.push({
          kind: 'double_booked',
          message: `שיבוץ כפול: ${name} משובץ בו-זמנית ל-${a.position} (${a.work_date}) ול-${b.position} (${b.work_date}).`,
          work_date: a.work_date,
          position: a.position,
        })
      }
    }
  }

  return warnings
}
