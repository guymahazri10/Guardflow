import { describe, it, expect } from 'vitest'
import {
  workDateForCategory,
  weekStartIsoFor,
  indexDatedBySlot,
  effectiveAssignmentName,
  effectiveAssignmentUserId,
} from './boardDatedSync'
import type { ShiftAssignment } from '../scheduleImports'

function assignment(overrides: Partial<ShiftAssignment> = {}): ShiftAssignment {
  return {
    id: 'a1',
    work_date: '2026-09-02',
    shift_category: 'night',
    worker_kind: 'מאבטח',
    position: 'לובי עליון',
    slot_index: 0,
    starts_at: '2026-09-02T20:00:00.000Z',
    ends_at: '2026-09-03T04:00:00.000Z',
    source_name: 'נדב מלקו',
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

describe('workDateForCategory', () => {
  // A night shift stays filed under the day it started, so at 03:00 the crew
  // on duty is still yesterday's row even though the date already rolled.
  it('resolves an in-progress night shift to the previous day before the night end hour', () => {
    const at3am = new Date(2026, 8, 3, 3, 9) // 2026-09-03 03:09 local
    expect(workDateForCategory('night', at3am)).toBe('2026-09-02')
  })

  it('resolves a night shift to today once past the night end hour', () => {
    const at23 = new Date(2026, 8, 3, 23, 30)
    expect(workDateForCategory('night', at23)).toBe('2026-09-03')
  })

  it('uses calendar today for the day shifts', () => {
    const at3am = new Date(2026, 8, 3, 3, 9)
    expect(workDateForCategory('morning', at3am)).toBe('2026-09-03')
    expect(workDateForCategory('afternoon', at3am)).toBe('2026-09-03')
  })
})

describe('weekStartIsoFor', () => {
  it('anchors to the preceding Sunday', () => {
    // 2026-09-03 is a Thursday; the week's Sunday is 2026-08-30.
    expect(weekStartIsoFor(new Date(2026, 8, 3, 12))).toBe('2026-08-30')
  })

  it('returns the same day when it is already Sunday', () => {
    expect(weekStartIsoFor(new Date(2026, 7, 30, 12))).toBe('2026-08-30')
  })
})

describe('indexDatedBySlot', () => {
  const cols = ['אחמ"ש', 'מאבטח 1', 'מאבטח 2']

  it('keys the night board slots by their mapped positions', () => {
    const rows = [
      assignment({ id: 'cmd', position: 'אחמ"ש', worker_kind: 'אחמ"ש', source_name: 'גיא מהצרי' }),
      assignment({ id: 'upper', position: 'לובי עליון', source_name: 'נדב מלקו' }),
      assignment({ id: 'lower', position: 'לובי תחתון', source_name: 'פרנקי בראון' }),
    ]
    const bySlot = indexDatedBySlot(rows, cols, 'night', '2026-09-02')

    expect(bySlot.get('אחמ"ש')?.id).toBe('cmd')
    expect(bySlot.get('מאבטח 1')?.id).toBe('upper')
    expect(bySlot.get('מאבטח 2')?.id).toBe('lower')
  })

  it('ignores rows for a different date, category, or unpublished state', () => {
    const rows = [
      assignment({ id: 'wrong-date', work_date: '2026-09-01' }),
      assignment({ id: 'wrong-category', shift_category: 'morning' }),
      assignment({ id: 'unpublished', published: false }),
    ]
    expect(indexDatedBySlot(rows, cols, 'night', '2026-09-02').size).toBe(0)
  })

  it('leaves a slot unmapped when the shift has no such position', () => {
    // Night only maps two מאבטח slots; a third has no imported position.
    const rows = [assignment({ position: 'לובי עליון' })]
    const bySlot = indexDatedBySlot(rows, [...cols, 'מאבטח 3'], 'night', '2026-09-02')
    expect(bySlot.has('מאבטח 3')).toBe(false)
  })
})

describe('effective assignment identity', () => {
  it('uses the imported plan when there has been no manual swap', () => {
    const a = assignment()
    expect(effectiveAssignmentName(a)).toBe('נדב מלקו')
    expect(effectiveAssignmentUserId(a)).toBe('p1')
  })

  // A swap must win, otherwise the setup screen would re-seed from the
  // original plan and a manager saving unrelated slots would silently revert
  // someone else's swap.
  it('prefers a manual swap over the imported plan', () => {
    const a = assignment({ actual_name: 'מחליף', actual_user_id: 'p2', is_manually_edited: true })
    expect(effectiveAssignmentName(a)).toBe('מחליף')
    expect(effectiveAssignmentUserId(a)).toBe('p2')
  })
})
