import { describe, it, expect, vi } from 'vitest'
import { planDatedWrites, performRosterSave, type SaveDeps } from './rosterSave'
import type { GuardAssignment } from '../rosterBoards'
import type { ShiftAssignment } from '../scheduleImports'

function assignment(overrides: Partial<ShiftAssignment> = {}): ShiftAssignment {
  return {
    id: 'a1',
    work_date: '2026-09-07',
    shift_category: 'morning',
    worker_kind: 'מאבטח',
    position: 'לובי עליון',
    slot_index: 0,
    starts_at: '2026-09-07T04:00:00.000Z',
    ends_at: '2026-09-07T12:00:00.000Z',
    source_name: 'איתמר אביטן',
    planned_user_id: 'p1',
    actual_user_id: null,
    actual_name: null,
    source: 'image',
    import_id: 'i1',
    is_manually_edited: false,
    published: true,
    ...overrides,
  }
}

function named(name: string, user_id: string | null = null): GuardAssignment {
  return { name, user_id }
}

/** Records the order every dependency fired in, so ordering can be asserted. */
function trackedDeps(overrides: Partial<SaveDeps> = {}) {
  const calls: string[] = []
  const deps: SaveDeps = {
    saveGuardNames: vi.fn(async () => {
      calls.push('saveGuardNames')
    }),
    replaceAssignmentWorker: vi.fn(async () => {
      calls.push('replaceAssignmentWorker')
    }),
    invalidateAssignments: vi.fn(() => {
      calls.push('invalidateAssignments')
    }),
    ...overrides,
  }
  return { calls, deps }
}

describe('planDatedWrites', () => {
  it('routes an edited dated-backed slot to the dated layer, not just guard_names', () => {
    const dated = new Map([['מאבטח 1', assignment()]])
    const writes = planDatedWrites(dated, { 'מאבטח 1': named('דניאל שמש') })

    expect(writes).toHaveLength(1)
    expect(writes[0].role).toBe('מאבטח 1')
    expect(writes[0].edited.name).toBe('דניאל שמש')
  })

  it('leaves an unchanged slot alone, ignoring surrounding whitespace', () => {
    const dated = new Map([['מאבטח 1', assignment()]])
    expect(planDatedWrites(dated, { 'מאבטח 1': named('  איתמר אביטן  ') })).toEqual([])
  })

  it('compares against the manual swap, not the imported plan, once a row was edited', () => {
    const dated = new Map([['מאבטח 1', assignment({ actual_name: 'פרנקי בראון' })]])

    // Matches actual_name -> nothing to write.
    expect(planDatedWrites(dated, { 'מאבטח 1': named('פרנקי בראון') })).toEqual([])
    // Reverting to the imported plan is a real change and must be written.
    expect(planDatedWrites(dated, { 'מאבטח 1': named('איתמר אביטן' ) })).toHaveLength(1)
  })

  it('ignores slots with no dated row — those stay pure guard_names', () => {
    expect(planDatedWrites(new Map(), { 'מאבטח 4': named('נעם סולומון') })).toEqual([])
  })
})

describe('performRosterSave', () => {
  it('resolves only after every write has settled, so navigation cannot outrun the save', async () => {
    const { calls, deps } = trackedDeps()
    const datedWrites = planDatedWrites(new Map([['מאבטח 1', assignment()]]), {
      'מאבטח 1': named('דניאל שמש'),
    })

    const outcome = await performRosterSave({
      boardId: 'b1',
      guardNames: { 'מאבטח 1': named('דניאל שמש') },
      datedWrites,
      canWriteDated: true,
      deps,
    })

    expect(outcome).toEqual({ status: 'saved' })
    // guard_names first, then the dated row, then the cache drop — a 'saved'
    // result is never returned with a write still in flight.
    expect(calls).toEqual(['saveGuardNames', 'replaceAssignmentWorker', 'invalidateAssignments'])
  })

  it('drops the cached assignments query so the live screen shows the new data, not its stale copy', async () => {
    const { deps } = trackedDeps()
    const datedWrites = planDatedWrites(new Map([['מאבטח 1', assignment()]]), {
      'מאבטח 1': named('דניאל שמש'),
    })

    await performRosterSave({
      boardId: 'b1',
      guardNames: {},
      datedWrites,
      canWriteDated: true,
      deps,
    })

    expect(deps.invalidateAssignments).toHaveBeenCalledTimes(1)
  })

  it('reports a guard_names failure instead of swallowing it, and writes nothing further', async () => {
    const rlsError = new Error('new row violates row-level security policy')
    const { deps } = trackedDeps({
      saveGuardNames: vi.fn(async () => {
        throw rlsError
      }),
    })

    const outcome = await performRosterSave({
      boardId: 'b1',
      guardNames: {},
      datedWrites: planDatedWrites(new Map([['מאבטח 1', assignment()]]), {
        'מאבטח 1': named('דניאל שמש'),
      }),
      canWriteDated: true,
      deps,
    })

    // The underlying error is carried out, not discarded by a bare catch.
    expect(outcome).toEqual({ status: 'guard-names-failed', error: rlsError })
    expect(deps.replaceAssignmentWorker).not.toHaveBeenCalled()
  })

  it('reports a partial save when the dated write fails after guard_names succeeded', async () => {
    const rpcError = new Error('אחמ"ש יכול להחליף רק שיבוץ פעיל כעת')
    const { deps } = trackedDeps({
      replaceAssignmentWorker: vi.fn(async () => {
        throw rpcError
      }),
    })

    const outcome = await performRosterSave({
      boardId: 'b1',
      guardNames: {},
      datedWrites: planDatedWrites(new Map([['מאבטח 1', assignment()]]), {
        'מאבטח 1': named('דניאל שמש'),
      }),
      canWriteDated: true,
      deps,
    })

    expect(outcome).toEqual({ status: 'dated-write-failed', error: rpcError })
    expect(deps.saveGuardNames).toHaveBeenCalledTimes(1)
  })

  it('never reports success when dated writes were skipped for lack of permission', async () => {
    const { deps } = trackedDeps()

    const outcome = await performRosterSave({
      boardId: 'b1',
      guardNames: {},
      datedWrites: planDatedWrites(new Map([['מאבטח 1', assignment()]]), {
        'מאבטח 1': named('דניאל שמש'),
      }),
      canWriteDated: false,
      deps,
    })

    // Previously this path fell through to a plain success toast while the
    // live screen kept showing the old name.
    expect(outcome).toEqual({ status: 'dated-writes-skipped', roles: ['מאבטח 1'] })
    expect(deps.replaceAssignmentWorker).not.toHaveBeenCalled()
  })

  it('saves guard_names alone when no slot is backed by a dated row', async () => {
    const { calls, deps } = trackedDeps()

    const outcome = await performRosterSave({
      boardId: 'b1',
      guardNames: { 'מאבטח 4': named('נעם סולומון') },
      datedWrites: [],
      canWriteDated: true,
      deps,
    })

    expect(outcome).toEqual({ status: 'saved' })
    expect(calls).toEqual(['saveGuardNames'])
  })
})
