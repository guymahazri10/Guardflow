import { describe, expect, it } from 'vitest'
import type { ShiftAssignment } from '../scheduleImports'
import { bucketPublishedAssignments, extraGuardPositions, weeklyCellKey } from './weeklyView'

function row(over: Partial<ShiftAssignment>): ShiftAssignment {
  return {
    id: 'id', work_date: '2026-09-06', shift_category: 'morning', worker_kind: 'מאבטח', position: 'CD',
    slot_index: 0, starts_at: '2026-09-06T03:45:00+00:00', ends_at: '2026-09-06T12:10:00+00:00',
    source_name: 'שם', planned_user_id: null, actual_user_id: null, actual_name: null, source: 'excel',
    import_id: null, is_manually_edited: false, published: true, created_at: '', updated_at: '',
    ...over,
  } as ShiftAssignment
}

describe('weekly view', () => {
  it('shows unlinked names (no account link needed) and orders two slots', () => {
    const map = bucketPublishedAssignments([
      row({ id: 'b', slot_index: 1, source_name: 'ב' }),
      row({ id: 'a', slot_index: 0, source_name: 'א' }),
    ])
    expect(map.get(weeklyCellKey('2026-09-06', 'morning', 'CD'))?.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('never includes unpublished rows', () => {
    expect(bucketPublishedAssignments([row({ published: false })]).size).toBe(0)
  })

  it('surfaces published guard posts that are not in the known list', () => {
    const rows = [row({ position: 'עמדה חדשה' }), row({ position: 'CD' }), row({ position: 'x', published: false })]
    expect(extraGuardPositions(rows, 'morning', ['CD'])).toEqual(['עמדה חדשה'])
  })
})
