import { describe, it, expect } from 'vitest'
import { normalizeExtractedAssignments, type ExtractedAssignment } from './normalizeExtracted'

function record(overrides: Partial<ExtractedAssignment> = {}): ExtractedAssignment {
  return {
    date: '2026-08-30',
    worker_kind: 'אחמ"ש',
    position: 'אחמ"ש',
    start: '06:30',
    end: '15:00',
    name: 'ניר כהן',
    ...overrides,
  }
}

// Pinned so the year-anchoring below is deterministic rather than depending
// on when the suite runs.
const REFERENCE = new Date('2026-08-30T00:00:00.000Z')

describe('normalizeExtractedAssignments', () => {
  it('builds an assignment with Israel-local hours converted to UTC', () => {
    const { assignments } = normalizeExtractedAssignments([record()], REFERENCE)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      work_date: '2026-08-30',
      worker_kind: 'אחמ"ש',
      position: 'אחמ"ש',
      shift_category: 'morning',
      slot_index: 0,
      source_name: 'ניר כהן',
    })
    // Aug 30 2026 is inside Israel DST (UTC+3), so 06:30 local is 03:30 UTC.
    expect(assignments[0].starts_at).toBe('2026-08-30T03:30:00.000Z')
    expect(assignments[0].ends_at).toBe('2026-08-30T12:00:00.000Z')
  })

  it('rolls a night shift end past midnight but keeps the start date as work_date', () => {
    const { assignments } = normalizeExtractedAssignments([
      record({ position: 'אחמ"ש', start: '22:30', end: '07:00' }),
    ], REFERENCE)
    expect(assignments[0].shift_category).toBe('night')
    expect(assignments[0].work_date).toBe('2026-08-30')
    expect(assignments[0].ends_at).toBe('2026-08-31T04:00:00.000Z')
  })

  it('assigns slot_index per date+category+position so a two-person post keeps both', () => {
    const { assignments } = normalizeExtractedAssignments([
      record({ worker_kind: 'מאבטח', position: 'AB', start: '06:45', end: '15:10', name: 'אסף' }),
      record({ worker_kind: 'מאבטח', position: 'AB', start: '06:45', end: '15:10', name: 'נועם' }),
      // Same position, different day — restarts at slot 0.
      record({
        date: '2026-08-31',
        worker_kind: 'מאבטח',
        position: 'AB',
        start: '06:45',
        end: '15:10',
        name: 'איתי',
      }),
    ], REFERENCE)
    expect(assignments.map((a) => [a.work_date, a.slot_index, a.source_name])).toEqual([
      ['2026-08-30', 0, 'אסף'],
      ['2026-08-30', 1, 'נועם'],
      ['2026-08-31', 0, 'איתי'],
    ])
  })

  // Regression: found live in production — 17 positions each got the exact
  // same name in both slot_index 0 and 1, always in 'morning', always
  // byte-identical hours. Traced to multiple uploaded images being
  // concatenated with no dedup (parseImageSchedule.ts): a follow-up image
  // uploaded to capture a cropped section can still fully re-cover an
  // earlier image's morning section, duplicating every record in it.
  it('collapses an exact duplicate record (same name+hours) into one assignment, with a warning', () => {
    const { assignments, warnings } = normalizeExtractedAssignments([
      record({ worker_kind: 'מאבטח', position: 'AB', start: '06:45', end: '15:10', name: 'עמית גינזבורג' }),
      // Same date/category/position/hours/name — an overlapping second image,
      // not a genuine second worker.
      record({ worker_kind: 'מאבטח', position: 'AB', start: '06:45', end: '15:10', name: 'עמית גינזבורג' }),
    ], REFERENCE)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].slot_index).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('duplicate_slot')
  })

  it('still keeps two genuinely different workers at the same position and hours', () => {
    const { assignments } = normalizeExtractedAssignments([
      record({ worker_kind: 'מאבטח', position: 'AB', start: '06:45', end: '15:10', name: 'עמית' }),
      record({ worker_kind: 'מאבטח', position: 'AB', start: '06:45', end: '15:10', name: 'רוי' }),
    ], REFERENCE)
    expect(assignments.map((a) => [a.slot_index, a.source_name])).toEqual([
      [0, 'עמית'],
      [1, 'רוי'],
    ])
  })

  it('keeps the same position in two different shifts apart via shift_category', () => {
    const { assignments } = normalizeExtractedAssignments([
      record({ worker_kind: 'מאבטח', position: 'AB', start: '06:45', end: '15:10', name: 'בוקר' }),
      record({ worker_kind: 'מאבטח', position: 'AB', start: '14:45', end: '23:10', name: 'ערב' }),
    ], REFERENCE)
    // Both are slot 0 — the category, not the slot, is what separates them.
    expect(assignments.map((a) => [a.shift_category, a.slot_index])).toEqual([
      ['morning', 0],
      ['afternoon', 0],
    ])
  })

  it('reads exceptional hours as given rather than defaulting to the row', () => {
    const { assignments } = normalizeExtractedAssignments([
      record({ start: '06:30', end: '19:00' }),
      record({ position: 'אחמ"ש', start: '14:45', end: '18:30' }),
    ], REFERENCE)
    expect(assignments[0].ends_at).toBe('2026-08-30T16:00:00.000Z') // 19:00 local
    expect(assignments[1].shift_category).toBe('afternoon')
  })

  // The whole point of the closed list: `position` is part of
  // shift_assignments' uniqueness key, so an invented label silently creates a
  // duplicate row on the next import instead of updating the existing one.
  it('rejects a position outside the canonical list, with a warning naming it', () => {
    const { assignments, warnings } = normalizeExtractedAssignments([
      record({ worker_kind: 'מאבטח', position: 'עמדה מומצאת' }),
    ], REFERENCE)
    expect(assignments).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('עמדה מומצאת')
  })

  it('rejects an excluded section leaking through as a worker kind', () => {
    const { assignments, warnings } = normalizeExtractedAssignments([
      record({ worker_kind: 'בקרה', position: 'בוקר בקרה 1' }),
    ], REFERENCE)
    expect(assignments).toHaveLength(0)
    expect(warnings[0].message).toContain('בקרה')
  })

  it('rejects malformed dates and times instead of dropping them silently', () => {
    const { assignments, warnings } = normalizeExtractedAssignments([
      record({ date: '30\\8' }),
      record({ start: 'בוקר' }),
      record({ start: '99:00' }),
    ], REFERENCE)
    expect(assignments).toHaveLength(0)
    expect(warnings).toHaveLength(3)
    expect(warnings.every((w) => w.message.includes('דולגה'))).toBe(true)
  })

  it('treats an unstaffed slot as normal, not as a warning', () => {
    const { assignments, warnings } = normalizeExtractedAssignments([record({ name: '   ' })], REFERENCE)
    expect(assignments).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })

  // Regression: the source table's headers carry no year ("30\8"), so the
  // model invents one — asked to read a schedule for late August 2026 it
  // returned 2024, which would file every assignment two years in the past
  // where the live page would never find them. Day and month are taken from
  // the image; the year is derived from the reference date instead.
  it('overrides a wrong year from the model, keeping the day and month', () => {
    const { assignments } = normalizeExtractedAssignments(
      [record({ date: '2024-08-30' })],
      REFERENCE,
    )
    expect(assignments[0].work_date).toBe('2026-08-30')
  })

  it('anchors to the nearest year across a New Year boundary', () => {
    const newYearReference = new Date('2026-12-30T00:00:00.000Z')
    const { assignments } = normalizeExtractedAssignments(
      [
        record({ date: '2020-12-31' }), // stays in 2026
        record({ date: '2020-01-02', position: 'אחמ"ש', start: '14:30', end: '23:00' }), // rolls to 2027
      ],
      newYearReference,
    )
    expect(assignments.map((a) => a.work_date)).toEqual(['2026-12-31', '2027-01-02'])
  })

  it('accepts a worker kind written with a different Hebrew quote mark', () => {
    const { assignments } = normalizeExtractedAssignments([record({ worker_kind: 'אחמ״ש' })], REFERENCE)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].worker_kind).toBe('אחמ"ש')
  })

  describe('coverage', () => {
    it('reports found and missing positions so a cropped screenshot is visible', () => {
      const { coverage } = normalizeExtractedAssignments([
        record(),
        record({ date: '2026-08-31' }),
      ], REFERENCE)
      expect(coverage.datesFound).toEqual(['2026-08-30', '2026-08-31'])
      expect(coverage.positionsFound).toEqual([
        { worker_kind: 'אחמ"ש', position: 'אחמ"ש', days: 2 },
      ])
      // Everything else in the canonical list is reported as missing.
      expect(coverage.positionsMissing.length).toBeGreaterThan(0)
      expect(coverage.positionsMissing.some((p) => p.position === 'AB')).toBe(true)
    })
  })
})
