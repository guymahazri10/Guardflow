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

  // Regression: found live in production. Many real profiles in this app are
  // registered under a first name only, while the schedule image always
  // carries a full name — full-string Levenshtein distance between "ניר" and
  // "ניר כהן" is 4, far past any sane fuzzy threshold, so every first-name-
  // only profile went permanently unmatched (87 of 113 names in one real
  // import). Word-coverage matching fixes this: a profile matches once every
  // one of *its own* words is found, closely, somewhere in the source name.
  describe('first-name-only profiles against full extracted names', () => {
    const realProfiles = [
      { id: 'nir', full_name: 'ניר' },
      { id: 'rom', full_name: 'רום' },
      { id: 'gia', full_name: 'גיא' },
      { id: 'gia-manor', full_name: 'גיא מנור' },
      { id: 'daniel', full_name: 'דניאל וינר' },
    ]

    it('matches a full extracted name to a first-name-only profile', () => {
      const [result] = matchNames([assignment('ניר כהן')], realProfiles)
      expect(result.planned_user_id).toBe('nir')
      expect(result.match_confidence).toBe('fuzzy')
    })

    // The last name in the image may be misread/differently spelled — the
    // whole point is that it doesn't matter when the profile has no last
    // name to compare against in the first place.
    it('matches regardless of how an unregistered last name is spelled', () => {
      const [result] = matchNames([assignment('רום אוקסהורן')], realProfiles)
      expect(result.planned_user_id).toBe('rom')
      expect(result.match_confidence).toBe('fuzzy')
    })

    it('prefers the more specific two-word profile when both words are present', () => {
      const [result] = matchNames([assignment('גיא מנור')], realProfiles)
      expect(result.planned_user_id).toBe('gia-manor')
    })

    it('falls back to the one-word profile when the second word is absent', () => {
      const [result] = matchNames([assignment('גיא לוי')], realProfiles)
      expect(result.planned_user_id).toBe('gia')
    })

    it('tolerates a single misread letter in a registered last name', () => {
      // Real case: profile "דניאל וינר" vs the image's "דניאל ויינר".
      const [result] = matchNames([assignment('דניאל ויינר')], realProfiles)
      expect(result.planned_user_id).toBe('daniel')
    })
  })
})
