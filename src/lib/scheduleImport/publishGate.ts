import type { ValidationWarning } from './types'
import { ACK_REQUIRED_WARNING_KINDS } from './types'

export type PublishBlocker =
  | 'stale_preview'
  | 'no_dry_run'
  | 'unconfirmed_deletes'
  | 'double_booked'
  | 'unresolved_position'
  | 'over_capacity'
  | 'unacknowledged_warnings'

/**
 * Everything that can stop a publish. Only structural problems are here: an
 * unresolved position, a night shift over capacity, a real double booking of
 * a linked account, unconfirmed deletions, or a stale/missing dry-run.
 *
 * Deliberately absent: a name with no linked user account (or only a
 * suggested one). The assignment exists and is shown with the name from the
 * file; linking is optional and never a condition for publishing.
 */
export function getPublishBlockers(input: {
  isDirty: boolean
  hasDryRun: boolean
  pendingDeleteCount: number
  confirmedDeleteCount: number
  overlapWarnings: ValidationWarning[]
  warnings: ValidationWarning[]
  isAcknowledged: (w: ValidationWarning) => boolean
}): PublishBlocker[] {
  const blockers: PublishBlocker[] = []
  if (input.isDirty) blockers.push('stale_preview')
  if (!input.hasDryRun) blockers.push('no_dry_run')
  if (input.pendingDeleteCount > input.confirmedDeleteCount) blockers.push('unconfirmed_deletes')
  if (input.overlapWarnings.some((w) => w.kind === 'double_booked')) blockers.push('double_booked')
  if (input.warnings.some((w) => w.kind === 'unresolved_position_mapping')) blockers.push('unresolved_position')
  if (input.warnings.some((w) => w.kind === 'position_capacity_mismatch')) blockers.push('over_capacity')
  if (
    input.warnings.some((w) => ACK_REQUIRED_WARNING_KINDS.includes(w.kind) && !input.isAcknowledged(w))
  ) {
    blockers.push('unacknowledged_warnings')
  }
  return blockers
}
