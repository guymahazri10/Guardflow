import { describe, it, expect } from 'vitest'
import { planDatedWrites } from './rosterSave'
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
    updated_at: '2026-09-01T00:00:00Z',
    published: true,
    ...overrides,
  }
}

function named(name: string, user_id: string | null = null): GuardAssignment {
  return { name, user_id }
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
    expect(planDatedWrites(dated, { 'מאבטח 1': named('  איתמר אביטן  ', 'p1') })).toEqual([])
  })

  it('compares against the manual swap, not the imported plan, once a row was edited', () => {
    const dated = new Map([['מאבטח 1', assignment({ actual_name: 'פרנקי בראון' })]])

    // Matches actual_name -> nothing to write.
    expect(planDatedWrites(dated, { 'מאבטח 1': named('פרנקי בראון') })).toEqual([])
    // Reverting to the imported plan is a real change and must be written.
    expect(planDatedWrites(dated, { 'מאבטח 1': named('איתמר אביטן' ) })).toHaveLength(1)
  })

  it('saves the linked account even when its display name is unchanged', () => {
    const dated = new Map([['מאבטח 1', assignment()]])
    expect(planDatedWrites(dated, { 'מאבטח 1': named('איתמר אביטן', 'p2') })).toHaveLength(1)
  })

  it('ignores slots with no dated row — those stay pure guard_names', () => {
    expect(planDatedWrites(new Map(), { 'מאבטח 4': named('נעם סולומון') })).toEqual([])
  })
})
