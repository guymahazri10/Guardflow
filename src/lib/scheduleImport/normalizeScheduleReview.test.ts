import { describe, it, expect } from 'vitest'
import { normalizeSchedule } from './normalizeSchedule'
import { categoryFromRowLabel, checkShiftEnvelope } from './assignmentTime'
import type { RawCell, RawGrid } from './types'

const weekStart = new Date(Date.UTC(2026, 9, 18))

function cell(text: string, extra: Partial<RawCell> = {}): RawCell {
  return { text, entries: text.split('\n').map((l) => l.trim()).filter(Boolean), ...extra }
}

const header: RawCell[][] = [
  [cell(''), cell("א'")],
  [cell('משמרות'), cell('10\\18')],
]

function grid(...rows: RawCell[][]): RawGrid {
  return { rows: [...header, ...rows] }
}

const section = (label: string) => [cell(label, { colspan: 2 }), cell('')]

describe('categoryFromRowLabel', () => {
  it('reads the period from the title, including glued-on hours', () => {
    expect(categoryFromRowLabel('אחמ"ש בוקר06:30-15:10')).toBe('morning')
    expect(categoryFromRowLabel('צהריים מאבטח AB 14:45-23:10 חמוש')).toBe('afternoon')
    expect(categoryFromRowLabel('לילה מאבטח')).toBe('night')
    expect(categoryFromRowLabel('מאבטח רכוב צהריים')).toBe('afternoon')
  })
  it('returns null when the title names no period or several', () => {
    expect(categoryFromRowLabel('AB')).toBeNull()
    expect(categoryFromRowLabel('בוקר צהריים')).toBeNull()
  })
})

describe('checkShiftEnvelope', () => {
  it('accepts normal, early-start, late-end and partial shifts', () => {
    expect(checkShiftEnvelope('morning', 6, 30, 15, 10).outsideWindow).toBe(false)
    expect(checkShiftEnvelope('afternoon', 14, 45, 19, 0).outsideWindow).toBe(false)
    expect(checkShiftEnvelope('night', 22, 45, 7, 10).outsideWindow).toBe(false)
  })
  it('flags a morning shift that runs to 19:00 and a night starting at 21:00', () => {
    expect(checkShiftEnvelope('morning', 6, 30, 19, 0).outsideWindow).toBe(true)
    expect(checkShiftEnvelope('night', 21, 0, 7, 10).outsideWindow).toBe(true)
  })
})

describe('normalizeSchedule — title decides the category, hours are kept', () => {
  it('keeps a morning-titled row in morning even when it starts before 07:00, and keeps exact hours', () => {
    const { assignments } = normalizeSchedule(
      grid(section('אחמ"ש'), [cell('אחמ"ש בוקר06:30-15:10'), cell('06:30-15:00\nמנהל-א')]),
      weekStart,
    )
    expect(assignments).toHaveLength(1)
    expect(assignments[0].shift_category).toBe('morning')
    expect(assignments[0].starts_at).toBe('2026-10-18T03:30:00.000Z') // 06:30 Israel (UTC+3)
    expect(assignments[0].ends_at).toBe('2026-10-18T12:00:00.000Z')
  })

  it('keeps an afternoon-titled row in afternoon when it starts before 15:00, and keeps a partial shift as read', () => {
    const { assignments, warnings } = normalizeSchedule(
      grid(section('אחמ"ש'), [cell('אחמ"ש צהריים14:30-23:10'), cell('14:45-19:00\nמנהל-ב')]),
      weekStart,
    )
    expect(assignments[0].shift_category).toBe('afternoon')
    expect(assignments[0].ends_at).toBe('2026-10-18T16:00:00.000Z') // 19:00, not padded to 23:00
    expect(warnings.some((w) => w.kind === 'unusual_shift_hours')).toBe(false)
  })

  it('files a night shift under its start date and ends it the next day', () => {
    const { assignments } = normalizeSchedule(
      grid(section('אחמ"ש'), [cell('אחמ"ש לילה22:30-07:10'), cell('22:30-07:00\nמנהל-ג')]),
      weekStart,
    )
    expect(assignments[0].shift_category).toBe('night')
    expect(assignments[0].work_date).toBe('2026-10-18')
    expect(assignments[0].ends_at.slice(0, 10)).toBe('2026-10-19')
  })

  it('warns, with the original hours, on a 06:30-19:00 morning shift and does not change it', () => {
    const { assignments, warnings } = normalizeSchedule(
      grid(section('אחמ"ש'), [cell('אחמ"ש בוקר06:30-15:10'), cell('06:30-19:00\nמנהל-א')]),
      weekStart,
    )
    expect(assignments[0].shift_category).toBe('morning')
    expect(assignments[0].ends_at).toBe('2026-10-18T16:00:00.000Z')
    const hours = warnings.filter((w) => w.kind === 'unusual_shift_hours')
    const duration = warnings.filter((w) => w.kind === 'unusual_shift_duration')
    expect(hours).toHaveLength(1)
    expect(hours[0].original_hours).toBe('06:30-19:00')
    expect(duration).toHaveLength(1)
  })

  it('flags a category guessed from hours when the title names no period', () => {
    const { assignments, warnings } = normalizeSchedule(
      grid(section('מאבטח'), [cell('AB'), cell('06:45-15:10\nדני')]),
      weekStart,
    )
    expect(assignments[0].shift_category).toBe('morning')
    expect(warnings.some((w) => w.kind === 'category_guessed_from_hours')).toBe(true)
  })

  it('extracts two workers in one cell as separate slot_index records', () => {
    const { assignments } = normalizeSchedule(
      grid(section('מאבטח'), [
        cell('בוקר מאבטח 06:45-15:10 לובי עליון - חמוש'),
        cell('06:45-15:10\nאומנהל-א\n06:45-15:10\nשומר-ב'),
      ]),
      weekStart,
    )
    expect(assignments.map((a) => [a.source_name, a.slot_index, a.position])).toEqual([
      ['אומנהל-א', 0, 'לובי עליון'],
      ['שומר-ב', 1, 'לובי עליון'],
    ])
  })
})

describe('normalizeSchedule — exclusion with counts and reasons', () => {
  const rows = (): RawCell[][] => [
    section('אחמ"ש'),
    [cell('אחמ"ש בוקר06:30-15:10'), cell('06:30-15:00\nמנהל-ב')],
    section('בקרה'),
    [cell('בוקר בקרה 1'), cell('06:45-15:10\nמנהל-ב')], // same person as the אחמ"ש above
    [cell('לילה בקרה 22:45-07:10'), cell('22:45-07:10\nבקר-ג')],
    section('היעדרויות'),
    [cell('חופש'), cell('')],
    [cell('קורס'), cell('08:00-18:00\nאיתי')],
  ]

  it('excludes control and absence rows by group, counts them with the reason, and keeps the same name in the אחמ"ש group', () => {
    const { assignments, summary, excludedSectionsSeen } = normalizeSchedule(grid(...rows()), weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({ worker_kind: 'אחמ"ש', source_name: 'מנהל-ב' })
    expect(summary.included).toBe(1)
    expect(summary.excluded).toEqual([
      { section: 'בקרה', reason: 'קבוצת בקרה — לא נכללת בסידור', count: 2 },
      { section: 'קורס', reason: 'היעדרות (קורס) — לא נכללת בסידור', count: 1 },
    ])
    expect(excludedSectionsSeen).toEqual(expect.arrayContaining(['בקרה', 'קורס']))
  })

  it('excludes every absence row (חופש, מחלה, מילואים, קורס, לימודים, תגבור) with its own count, and control', () => {
    const { assignments, summary } = normalizeSchedule(
      grid(
        section('אחמ"ש'),
        [cell('אחמ"ש בוקר06:30-15:10'), cell('06:30-15:00\nגיא')],
        section('בקרה'),
        [cell('בוקר בקרה 2'), cell('06:45-15:10\nא')],
        section('היעדרויות'),
        [cell('חופש'), cell('00:00-00:00\nב')],
        [cell('מחלה'), cell('08:00-18:00\nג')],
        [cell('מילואים'), cell('08:00-18:00\nד')],
        [cell('קורס'), cell('08:00-18:00\nה')],
        [cell('לימודים'), cell('08:00-18:00\nו')],
        [cell('תגבור'), cell('08:00-18:00\nז')],
      ),
      weekStart,
    )
    expect(assignments).toHaveLength(1)
    expect(summary.excluded.map((g) => [g.section, g.count])).toEqual([
      ['בקרה', 1], ['חופש', 1], ['מחלה', 1], ['מילואים', 1], ['קורס', 1], ['לימודים', 1], ['תגבור', 1],
    ])
  })

  it('counts empty cells instead of dropping them silently', () => {
    const { summary } = normalizeSchedule(
      grid(section('מאבטח'), [cell('בוקר מאבטח AB 06:45-15:10'), cell('')]),
      weekStart,
    )
    expect(summary.emptyCells).toBe(1)
  })

  it('surfaces an unrecognized group instead of classifying it', () => {
    const { assignments, warnings, summary } = normalizeSchedule(
      grid(section('אחמ"ש'), section('צוות חדש'), [cell('בוקר אחר'), cell('07:00-15:00\nמישהו')]),
      weekStart,
    )
    expect(assignments).toHaveLength(0)
    expect(warnings.some((w) => w.kind === 'unknown_section' && w.position === 'צוות חדש')).toBe(true)
    expect(summary.excluded[0]).toMatchObject({ section: 'צוות חדש', count: 1 })
  })

  it('does not mistake an empty position row for a group header', () => {
    const { warnings } = normalizeSchedule(
      grid(section('מאבטח'), [cell('בוקר מאבטח AB 06:45-15:10'), cell('')]),
      weekStart,
    )
    expect(warnings.some((w) => w.kind === 'unknown_section')).toBe(false)
  })
})
