import type { GuardAssignment } from '../rosterBoards'
import type { ShiftAssignment } from '../scheduleImports'
import { effectiveAssignmentName } from './boardDatedSync'

/**
 * The save flow behind ShiftSetupPage's "שמור ועבור לתצוגה", lifted out of the
 * component so its ordering and its failure modes can be tested directly —
 * the component itself can't be rendered under this project's node-environment
 * vitest setup, and the ordering ("did the write finish before we navigated?")
 * is exactly the part that was going wrong.
 */

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
    if (edited.name.trim() === effectiveAssignmentName(assignment).trim()) continue
    writes.push({ role, assignment, edited })
  }
  return writes
}

export type SaveDeps = {
  /** Writes roster_boards.guard_names. */
  saveGuardNames: (input: { id: string; guardNames: Record<string, GuardAssignment> }) => Promise<unknown>
  /** Calls replace_assignment_worker for one dated row. */
  replaceAssignmentWorker: (input: {
    assignmentId: string
    newUserId: string | null
    newName: string
    reason: string
  }) => Promise<unknown>
  /**
   * Drops the cached ['shift-assignments', weekStart] query so the live screen
   * renders this save rather than the copy it already had. ShiftLivePage's own
   * swap flow does this for the same reason: the acting user's screen must not
   * depend on Realtime's health to show their own change.
   */
  invalidateAssignments: () => void | Promise<void>
}

export type SaveOutcome =
  | { status: 'saved' }
  /** guard_names was written; some dated rows were not. Never reported as success. */
  | { status: 'dated-write-failed'; error: unknown }
  /**
   * guard_names was written, but dated rows this caller isn't allowed to touch
   * were left alone. Surfaced rather than silently dropped — the manager needs
   * to know the live screen still shows the old name.
   */
  | { status: 'dated-writes-skipped'; roles: string[] }
  | { status: 'guard-names-failed'; error: unknown }

/**
 * Runs the whole save and resolves only once every write has settled, so the
 * caller can navigate strictly afterwards. Never resolves 'saved' while any
 * intended write was skipped or rejected.
 */
export async function performRosterSave(input: {
  boardId: string
  guardNames: Record<string, GuardAssignment>
  datedWrites: DatedWrite[]
  /** Only a מנהל may bulk-edit dated rows here; an אחמ"ש is limited by
   *  replace_assignment_worker to an assignment in progress, which this
   *  bulk screen has no per-slot notion of. */
  canWriteDated: boolean
  deps: SaveDeps
}): Promise<SaveOutcome> {
  const { boardId, guardNames, datedWrites, canWriteDated, deps } = input

  try {
    await deps.saveGuardNames({ id: boardId, guardNames })
  } catch (error) {
    return { status: 'guard-names-failed', error }
  }

  if (datedWrites.length === 0) return { status: 'saved' }

  if (!canWriteDated) {
    return { status: 'dated-writes-skipped', roles: datedWrites.map((w) => w.role) }
  }

  try {
    for (const { assignment, edited } of datedWrites) {
      await deps.replaceAssignmentWorker({
        assignmentId: assignment.id,
        newUserId: edited.user_id,
        newName: edited.name,
        reason: 'עדכון ידני דרך מסך שיבוץ',
      })
    }
  } catch (error) {
    // The guard_names write above genuinely succeeded, so this is a partial
    // save, not a rollback — saying so is more useful than a blanket success
    // toast the live screen would then contradict.
    await deps.invalidateAssignments()
    return { status: 'dated-write-failed', error }
  }

  await deps.invalidateAssignments()
  return { status: 'saved' }
}
