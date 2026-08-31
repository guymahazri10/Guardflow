import { describe, it, expect } from 'vitest'
import { matchNames } from './matchNames'
import type { NormalizedAssignment } from './types'

function assignment(sourceName: string | null): NormalizedAssignment {
  return {
    work_date: '2026-09-06',
    shift_category: 'morning',
    worker_kind: 'מאבטח',
    position: 'שער',
    slot_index: 0,
    starts_at: '2026-09-06T06:00:00.000Z',
    ends_at: '2026-09-06T14:00:00.000Z',
    source_name: sourceName,
  }
}

describe('matchNames', () => {
  const profiles = [
    { id: 'u1', full_name: 'בדיקה־א׳' },
    { id: 'u2', full_name: 'בדיקה ב' },
  ]

  it('matches an exact name', () => {
    const [result] = matchNames([assignment('בדיקה־א׳')], profiles)
    expect(result.planned_user_id).toBe('u1')
    expect(result.match_confidence).toBe('exact')
  })

  it('matches despite different quote characters and spacing', () => {
    const [result] = matchNames([assignment("בדיקה  א'")], profiles)
    expect(result.planned_user_id).toBe('u1')
    expect(result.match_confidence).toBe('exact')
  })

  it('suggests a fuzzy match for a small typo, never auto-confirmed as exact', () => {
    const [result] = matchNames([assignment('בדיקה ג')], profiles)
    expect(result.planned_user_id).toBe('u2')
    expect(result.match_confidence).toBe('fuzzy')
  })

  it('leaves an unresolvable name unmatched rather than guessing', () => {
    const [result] = matchNames([assignment('שם שלא קיים בכלל')], profiles)
    expect(result.planned_user_id).toBeNull()
    expect(result.match_confidence).toBe('none')
  })

  it('leaves a null source_name unmatched', () => {
    const [result] = matchNames([assignment(null)], profiles)
    expect(result.planned_user_id).toBeNull()
    expect(result.match_confidence).toBe('none')
  })
})
