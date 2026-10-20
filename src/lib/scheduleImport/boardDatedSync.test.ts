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

  // The one-guard night variant — this is the exact lookup both Setup
  // (ShiftSetupPage via this function) and Live (ShiftLivePage directly)
  // perform, each from their own copy of the same board's cols; proving it
  // here proves they can never disagree, since both call the same function
  // with the same (cols, shiftType) derived from the same board.
  it('keys the one-guard night board\'s sole slot to the night solo-guard assignment, with אחמ"ש kept separate', () => {
    const soloNightCols = ['אחמ"ש', 'מאבטח 1']
    const rows = [
      assignment({ id: 'cmd', position: 'אחמ"ש', worker_kind: 'אחמ"ש', source_name: 'בדיקה־מפקד' }),
      assignment({ id: 'guard', position: 'לילה מאבטח', source_name: 'בדיקה־שומר' }),
    ]
    const bySlot = indexDatedBySlot(rows, soloNightCols, 'night', '2026-09-02')

    expect(bySlot.get('אחמ"ש')?.id).toBe('cmd')
    expect(bySlot.get('מאבטח 1')?.id).toBe('guard')
    expect(bySlot.size).toBe(2) // no duplication onto a second slot — there isn't one
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

describe('indexDatedBySlot — night guard role with one or two guards', () => {
  const cols = ['אחמ"ש', 'מאבטח 1', 'מאבטח 2']
  const role = (slot_index: number, name: string, id: string) =>
    assignment({ id, position: 'לילה מאבטח', slot_index, source_name: name, work_date: '2026-10-18' })

  it('seats both guards by slot_index', () => {
    const map = indexDatedBySlot([role(0, 'ראשון', 'g0'), role(1, 'שני', 'g1')], cols, 'night', '2026-10-18')
    expect(map.get('מאבטח 1')?.source_name).toBe('ראשון')
    expect(map.get('מאבטח 2')?.source_name).toBe('שני')
  })

  it('leaves the second slot empty when only one guard is imported — no invented person, no duplicate', () => {
    const map = indexDatedBySlot([role(0, 'יחיד', 'g0')], cols, 'night', '2026-10-18')
    expect(map.get('מאבטח 1')?.source_name).toBe('יחיד')
    expect(map.has('מאבטח 2')).toBe(false)
  })

  it('does not read slot_index 1 into the first slot', () => {
    const map = indexDatedBySlot([role(1, 'שני בלבד', 'g1')], cols, 'night', '2026-10-18')
    expect(map.has('מאבטח 1')).toBe(false)
    expect(map.get('מאבטח 2')?.source_name).toBe('שני בלבד')
  })

  it('still shows existing לובי rows from earlier imports', () => {
    const legacy = assignment({ id: 'l1', work_date: '2026-10-18', position: 'לובי עליון', source_name: 'ישן' })
    expect(indexDatedBySlot([legacy], cols, 'night', '2026-10-18').get('מאבטח 1')?.source_name).toBe('ישן')
  })
})
