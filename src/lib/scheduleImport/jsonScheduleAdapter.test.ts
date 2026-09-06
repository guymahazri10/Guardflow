import { describe, it, expect } from 'vitest'
import { looksLikeDayGroupedSchedule, adaptDayGroupedSchedule } from './jsonScheduleAdapter'

describe('looksLikeDayGroupedSchedule', () => {
  it('recognizes an object with a days array', () => {
    expect(looksLikeDayGroupedSchedule({ days: [] })).toBe(true)
  })

  it('rejects a flat array (the other accepted shape) and anything else', () => {
    expect(looksLikeDayGroupedSchedule([])).toBe(false)
    expect(looksLikeDayGroupedSchedule({ days: 'not an array' })).toBe(false)
    expect(looksLikeDayGroupedSchedule(null)).toBe(false)
    expect(looksLikeDayGroupedSchedule('a string')).toBe(false)
  })
})

describe('adaptDayGroupedSchedule', () => {
  it('converts a commander (אחמ"ש) row regardless of the period suffix in role', () => {
    const { records, warnings } = adaptDayGroupedSchedule(
      {
        days: [
          {
            date: '09-06',
            assignments: [
              { area: 'אחמ״ש', role: 'אחמ״ש בוקר', start: '06:30', end: '15:10', employee: 'רן ברגרפרוינד' },
            ],
          },
        ],
      },
      2026,
    )
    expect(warnings).toHaveLength(0)
    expect(records).toEqual([
      { date: '2026-09-06', worker_kind: 'אחמ"ש', position: 'אחמ"ש', start: '06:30', end: '15:10', name: 'רן ברגרפרוינד' },
    ])
  })

  it('finds the canonical מאבטח position anywhere in inconsistently-ordered role text', () => {
    const { records, warnings } = adaptDayGroupedSchedule(
      {
        days: [
          {
            date: '09-06',
            assignments: [
              { area: 'מאבטח', role: 'בוקר מאבטח לובי עליון - חמוש', start: '06:45', end: '15:10', employee: 'א' },
              { area: 'מאבטח', role: 'צהריים מאבטח AB', start: '14:45', end: '23:10', employee: 'ב' },
              { area: 'מאבטח', role: 'מאבטח רכוב בוקר', start: '06:45', end: '15:10', employee: 'ג' },
              { area: 'מאבטח', role: 'מאבטח רכוב צהריים', start: '14:45', end: '23:10', employee: 'ד' },
            ],
          },
        ],
      },
      2026,
    )
    expect(warnings).toHaveLength(0)
    expect(records.map((r) => r.position)).toEqual(['לובי עליון', 'AB', 'רכוב', 'רכוב'])
  })

  it('expands an employees[] array into one record per person', () => {
    const { records } = adaptDayGroupedSchedule(
      {
        days: [
          {
            date: '09-06',
            assignments: [
              { area: 'מאבטח', role: 'צהריים מאבטח EFG', start: '14:45', end: '23:10', employees: ['א', 'ב'] },
            ],
          },
        ],
      },
      2026,
    )
    expect(records).toHaveLength(2)
    expect(records.map((r) => r.name)).toEqual(['א', 'ב'])
    expect(records.every((r) => r.position === 'EFG')).toBe(true)
  })

  it('skips a null/unstaffed slot without a warning', () => {
    const { records, warnings } = adaptDayGroupedSchedule(
      {
        days: [
          {
            date: '09-11',
            assignments: [{ area: 'מאבטח', role: 'בוקר מאבטח AB', start: null, end: null, employee: null }],
          },
        ],
      },
      2026,
    )
    expect(records).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })

  // Regression: the real file a manager uploaded uses "לילה מאבטח" as one
  // undifferentiated role for two guards, with no per-person position —
  // our canonical list only has לובי עליון/לובי תחתון for night, not a
  // catch-all "לילה" position. Best-effort assigns by array order and
  // always flags it, since it's a guess, not a resolved fact.
  it('guesses לובי עליון/לובי תחתון by order for the ambiguous "לילה מאבטח" role, with a warning', () => {
    const { records, warnings } = adaptDayGroupedSchedule(
      {
        days: [
          {
            date: '09-06',
            assignments: [
              {
                area: 'מאבטח',
                role: 'לילה מאבטח',
                start: '22:45',
                end: '07:10',
                employees: ['נדב מלכו', 'ציון יממה'],
              },
            ],
          },
        ],
      },
      2026,
    )
    expect(records).toEqual([
      { date: '2026-09-06', worker_kind: 'מאבטח', position: 'לובי עליון', start: '22:45', end: '07:10', name: 'נדב מלכו' },
      { date: '2026-09-06', worker_kind: 'מאבטח', position: 'לובי תחתון', start: '22:45', end: '07:10', name: 'ציון יממה' },
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('לילה')
  })

  it('warns and skips a role with no recognizable position and no "לילה" fallback', () => {
    const { records, warnings } = adaptDayGroupedSchedule(
      {
        days: [
          {
            date: '09-06',
            assignments: [{ area: 'מאבטח', role: 'משהו לא ידוע', start: '06:45', end: '15:10', employee: 'א' }],
          },
        ],
      },
      2026,
    )
    expect(records).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('לא זוהתה עמדה')
  })

  it('warns and skips a day with an invalid date instead of throwing', () => {
    const { records, warnings } = adaptDayGroupedSchedule(
      { days: [{ date: 'not-a-date', assignments: [] }] },
      2026,
    )
    expect(records).toHaveLength(0)
    expect(warnings).toHaveLength(1)
  })

  it('warns on an unrecognized worker kind rather than silently dropping it', () => {
    const { records, warnings } = adaptDayGroupedSchedule(
      {
        days: [
          {
            date: '09-06',
            assignments: [{ area: 'בקרה', role: 'בוקר בקרה', start: '06:45', end: '15:10', employee: 'א' }],
          },
        ],
      },
      2026,
    )
    expect(records).toHaveLength(0)
    expect(warnings[0]).toContain('לא מזוהה')
  })
})
