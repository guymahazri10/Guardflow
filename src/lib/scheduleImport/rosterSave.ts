import type { GuardAssignment } from '../rosterBoards'
import type { ShiftAssignment } from '../scheduleImports'
import { effectiveAssignmentName, effectiveAssignmentUserId } from './boardDatedSync'

export type DatedWrite = {
  role: string
  assignment: ShiftAssignment
  edited: GuardAssignment
}

/**
 * The dated rows whose displayed name no longer matches what the manager typed.
 *
 * A slot backed by a published dated assignment must be written to that
 * assignment: the live screen reads the dated row for that slot, so writing
 * only guard_names would save successfully and then never be displayed.
 */
export function planDatedWrites(
  datedBySlot: Map<string, ShiftAssignment>,
  guardNames: Record<string, GuardAssignment>,
): DatedWrite[] {
  const writes: DatedWrite[] = []
  for (const [role, assignment] of datedBySlot) {
    const edited = guardNames[role] ?? { name: '', user_id: null }
    if (edited.name.trim() === effectiveAssignmentName(assignment).trim() && edited.user_id === effectiveAssignmentUserId(assignment)) continue
    writes.push({ role, assignment, edited })
  }
  return writes
}
