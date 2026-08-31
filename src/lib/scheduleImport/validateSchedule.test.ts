import { describe, it, expect } from 'vitest'
import { validateSchedule } from './validateSchedule'
import type { MatchedAssignment } from './types'

function matched(overrides: Partial<MatchedAssignment> = {}): MatchedAssignment {
  return {
    work_date: '2026-09-06',
    shift_category: 'morning',
    worker_kind: 'מאבטח',
    position: 'שער',
    slot_index: 0,
    starts_at: '2026-09-06T06:00:00.000Z',
    ends_at: '2026-09-06T14:00:00.000Z',
    source_name: 'בדיקה־א׳',
    planned_user_id: 'u1',
    match_confidence: 'exact',
    ...overrides,
  }
}

describe('validateSchedule', () => {
  it('counts a clean import with no warnings', () => {
    const result = validateSchedule([matched()], [])
    expect(result.stats).toEqual({ imported: 1, skipped: 0, unmatched_names: 0 })
    expect(result.warnings).toHaveLength(0)
  })

  it('flags an unmatched name as a warning and counts it', () => {
    const result = validateSchedule([matched({ planned_user_id: null, match_confidence: 'none' })], [])
    expect(result.stats.unmatched_names).toBe(1)
    expect(result.warnings.some((w) => w.kind === 'unmatched_name')).toBe(true)
  })

  it('flags a duplicate identity key within the same file', () => {
    const dup = matched()
    const result = validateSchedule([dup, { ...dup }], [])
    expect(result.warnings.some((w) => w.kind === 'duplicate_slot')).toBe(true)
  })

  it('flags a conflict when an existing manually-edited row would be overwritten', () => {
    const result = validateSchedule(
      [matched()],
      [
        {
          work_date: '2026-09-06',
          shift_category: 'morning',
          position: 'שער',
          slot_index: 0,
          is_manually_edited: true,
        },
      ],
    )
    expect(result.conflicts).toHaveLength(1)
    expect(result.warnings.some((w) => w.kind === 'conflict_with_existing')).toBe(true)
  })

  it('does not flag a conflict against a non-manually-edited existing row', () => {
    const result = validateSchedule(
      [matched()],
      [
        {
          work_date: '2026-09-06',
          shift_category: 'morning',
          position: 'שער',
          slot_index: 0,
          is_manually_edited: false,
        },
      ],
    )
    expect(result.conflicts).toHaveLength(0)
  })
})
