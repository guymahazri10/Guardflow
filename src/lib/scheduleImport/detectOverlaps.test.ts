import { describe, it, expect } from 'vitest'
import { detectOverlaps } from './detectOverlaps'
import type { PublishDiffRow } from '../scheduleImports'

function row(overrides: Partial<PublishDiffRow>): PublishDiffRow {
  return {
    id: null,
    work_date: '2026-09-06',
    shift_category: 'morning',
    worker_kind: 'מאבטח',
    position: 'AB',
    slot_index: 0,
    starts_at: '2026-09-06T03:00:00.000Z',
    ends_at: '2026-09-06T11:00:00.000Z',
    source_name: 'שם',
    planned_user_id: 'u1',
    actual_user_id: 'u1',
    actual_name: 'שם',
    ...overrides,
  }
}

describe('detectOverlaps', () => {
  it('flags two overlapping shifts for the same actual_user_id in different positions', () => {
    const rows = [
      row({ position: 'AB', starts_at: '2026-09-06T03:00:00.000Z', ends_at: '2026-09-06T11:00:00.000Z' }),
      row({ position: 'CD', starts_at: '2026-09-06T09:00:00.000Z', ends_at: '2026-09-06T17:00:00.000Z' }),
    ]
    expect(detectOverlaps(rows)).toHaveLength(1)
  })

  it('does not flag back-to-back shifts that only touch at the boundary', () => {
    const rows = [
      row({ position: 'AB', starts_at: '2026-09-06T03:00:00.000Z', ends_at: '2026-09-06T11:00:00.000Z' }),
      row({ position: 'CD', starts_at: '2026-09-06T11:00:00.000Z', ends_at: '2026-09-06T19:00:00.000Z' }),
    ]
    expect(detectOverlaps(rows)).toHaveLength(0)
  })

  it('does not flag two different workers with identical hours', () => {
    const rows = [
      row({ planned_user_id: 'u1', actual_user_id: 'u1', position: 'AB' }),
      row({ planned_user_id: 'u2', actual_user_id: 'u2', position: 'CD' }),
    ]
    expect(detectOverlaps(rows)).toHaveLength(0)
  })

  it('uses actual_user_id, not planned_user_id, when a manual replacement diverges', () => {
    // Row A was manually replaced: actual_user_id (u9) differs from
    // planned_user_id (u1). Row B is a fresh import row planned for u9 with
    // overlapping hours — the real conflict is between the two u9 shifts,
    // not visible if grouping only used planned_user_id.
    const rows = [
      row({ planned_user_id: 'u1', actual_user_id: 'u9', position: 'AB' }),
      row({ planned_user_id: 'u9', actual_user_id: 'u9', position: 'CD' }),
    ]
    expect(detectOverlaps(rows)).toHaveLength(1)
  })

  it('does not flag a false overlap when actual_user_id differs but planned_user_id happens to match', () => {
    const rows = [
      row({ planned_user_id: 'u1', actual_user_id: 'u9', position: 'AB' }),
      row({ planned_user_id: 'u1', actual_user_id: 'u2', position: 'CD' }),
    ]
    expect(detectOverlaps(rows)).toHaveLength(0)
  })

  it('groups an unidentified worker by name, falling back from missing ids', () => {
    const rows = [
      row({
        planned_user_id: null,
        actual_user_id: null,
        source_name: 'לא מזוהה',
        actual_name: 'לא מזוהה',
        position: 'AB',
      }),
      row({
        planned_user_id: null,
        actual_user_id: null,
        source_name: 'לא מזוהה',
        actual_name: 'לא מזוהה',
        position: 'CD',
        starts_at: '2026-09-06T05:00:00.000Z',
        ends_at: '2026-09-06T13:00:00.000Z',
      }),
    ]
    expect(detectOverlaps(rows)).toHaveLength(1)
  })

  it('includes a to_keep_manual row (absent from the file) in the overlap check', () => {
    // Simulates the effective post-publish set: one insert/update row plus
    // one manually-edited row the file never mentioned, both for the same
    // worker with overlapping hours.
    const rows = [
      row({ position: 'AB', starts_at: '2026-09-06T03:00:00.000Z', ends_at: '2026-09-06T11:00:00.000Z' }),
      row({ position: 'EFG', starts_at: '2026-09-06T08:00:00.000Z', ends_at: '2026-09-06T16:00:00.000Z' }),
    ]
    expect(detectOverlaps(rows)).toHaveLength(1)
  })
})
