import { describe, it, expect } from 'vitest'
import { normalizeSchedule } from './normalizeSchedule'
import type { RawGrid } from './types'

function cell(text: string, entries: string[] = [text]) {
  return { text, entries: entries.filter((e) => e.trim().length > 0) }
}

const weekStart = new Date('2026-09-06T00:00:00.000Z') // a Sunday

describe('normalizeSchedule', () => {
  it('extracts a single morning אחמ"ש assignment with hours from the cell', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09'), cell('שני 07/09')],
        [cell('אחמ"ש')],
        [cell('שער ראשי'), cell('06:00-14:00 בדיקה־א׳'), cell('')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      work_date: '2026-09-06',
      worker_kind: 'אחמ"ש',
      position: 'שער ראשי',
      slot_index: 0,
      source_name: 'בדיקה־א׳',
    })
    // 06:00-14:00 is Israel local time; Sept 6 2026 is within Israel DST
    // (UTC+3), so the correct UTC instants are 3 hours earlier.
    expect(assignments[0].starts_at).toBe('2026-09-06T03:00:00.000Z')
    expect(assignments[0].ends_at).toBe('2026-09-06T11:00:00.000Z')
  })

  it('drops excluded sections entirely — not in output, no trace', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('היעדרויות')],
        [cell('שער ראשי'), cell('06:00-14:00 בדיקה־ב׳')],
        [cell('מאבטח')],
        [cell('שער צדדי'), cell('06:00-14:00 בדיקה־ג׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].position).toBe('שער צדדי')
    expect(assignments.some((a) => a.source_name === 'בדיקה־ב׳')).toBe(false)
  })

  it('leaves an empty cell as a skip, not an assignment', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער ראשי'), cell('')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(0)
  })

  it('produces two rows via slot_index for two workers stacked in one cell', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [
          cell('שער ראשי', []),
          cell('06:00-14:00 בדיקה־ד׳\n06:00-14:00 בדיקה־ה׳', [
            '06:00-14:00 בדיקה־ד׳',
            '06:00-14:00 בדיקה־ה׳',
          ]),
        ],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(2)
    expect(assignments.map((a) => a.slot_index).sort()).toEqual([0, 1])
    expect(assignments.map((a) => a.source_name).sort()).toEqual(['בדיקה־ד׳', 'בדיקה־ה׳'])
  })

  it('reads unusual/partial hours directly from the cell rather than defaulting', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('אחמ"ש')],
        [cell('שער ראשי'), cell('09:30-12:15 בדיקה־ו׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    // 09:30-12:15 Israel local time, converted through the Sept-2026 DST
    // (UTC+3) offset.
    expect(assignments[0].starts_at).toBe('2026-09-06T06:30:00.000Z')
    expect(assignments[0].ends_at).toBe('2026-09-06T09:15:00.000Z')
  })

  it('rolls ends_at to the next day for a night shift crossing midnight', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער ראשי'), cell('23:00-07:00 בדיקה־ז׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    // 23:00-07:00 Israel local time, converted through the Sept-2026 DST
    // (UTC+3) offset — still lands on work_date's UTC calendar day for
    // starts_at (20:00Z), and rolls to the next UTC day for ends_at (04:00Z).
    expect(assignments[0].starts_at).toBe('2026-09-06T20:00:00.000Z')
    expect(assignments[0].ends_at).toBe('2026-09-07T04:00:00.000Z')
    expect(assignments[0].shift_category).toBe('night')
  })

  it('classifies shift_category from the start hour', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('א'), cell('07:00-15:00 בדיקה־ח׳')],
        [cell('ב'), cell('15:00-23:00 בדיקה־ט׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments.find((a) => a.position === 'א')?.shift_category).toBe('morning')
    expect(assignments.find((a) => a.position === 'ב')?.shift_category).toBe('afternoon')
  })

  // Regression: classifyCategory originally reused src/constants/shifts.ts's
  // canonical clock boundaries (07:00/15:00/23:00), but every real shift
  // starts in the 30-minute handover buffer BEFORE those — so every single
  // row came out one category backwards. These are the actual start times
  // from the real weekly schedule, including the exceptional ones.
  it('classifies the real 06:30/14:30/22:30 start times into the right categories', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('אחמ"ש')],
        [cell('אחמ"ש בוקר'), cell('06:30-15:00 בדיקה־א׳')],
        [cell('אחמ"ש צהריים'), cell('14:30-23:00 בדיקה־ב׳')],
        [cell('אחמ"ש לילה'), cell('22:30-07:00 בדיקה־ג׳')],
        [cell('מאבטח')],
        [cell('לובי תחתון'), cell('06:45-15:10 בדיקה־ד׳')],
        [cell('AB'), cell('14:45-23:10 בדיקה־ה׳')],
        [cell('מאבטח לילה'), cell('22:45-07:10 בדיקה־ו׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    const categoryOf = (position: string) =>
      assignments.find((a) => a.position === position)?.shift_category

    expect(categoryOf('אחמ"ש בוקר')).toBe('morning')
    expect(categoryOf('אחמ"ש צהריים')).toBe('afternoon')
    expect(categoryOf('אחמ"ש לילה')).toBe('night')
    expect(categoryOf('לובי תחתון')).toBe('morning')
    expect(categoryOf('AB')).toBe('afternoon')
    expect(categoryOf('מאבטח לילה')).toBe('night')
  })

  it('classifies exceptional/partial shift start times into the right categories', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        // Late morning start, and a long morning shift running into evening
        [cell('א'), cell('08:00-15:10 בדיקה־א׳')],
        [cell('ב'), cell('06:30-19:00 בדיקה־ב׳')],
        // Short afternoon shift ending early
        [cell('ג'), cell('14:45-18:30 בדיקה־ג׳')],
        // Night shift starting unusually early
        [cell('ד'), cell('21:00-07:10 בדיקה־ד׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    const categoryOf = (position: string) =>
      assignments.find((a) => a.position === position)?.shift_category

    expect(categoryOf('א')).toBe('morning')
    expect(categoryOf('ב')).toBe('morning')
    expect(categoryOf('ג')).toBe('afternoon')
    expect(categoryOf('ד')).toBe('night')
  })

  // Regression: the real source system writes header dates with a BACKSLASH
  // ("30\8"), and abbreviates the day to a single letter + geresh ("א׳"),
  // not the full name. HEADER_DATE_PATTERN accepted only "." and "/", and the
  // day fallback only matched full names — so every column resolved to no
  // date and normalizeSchedule skipped every cell. A screenshot the model
  // read perfectly still yielded 0 assignments.
  it('parses real header cells that use a backslash date separator', () => {
    const grid: RawGrid = {
      rows: [
        [cell('משמרות'), cell("א' 30\\8"), cell("ב' 31\\8")],
        [cell('אחמ"ש')],
        [cell('אחמ"ש בוקר'), cell('06:30-15:00 ניר כהן'), cell('06:30-15:00 רן ברגרפרוינד')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, new Date('2026-08-30T00:00:00.000Z'))
    expect(assignments).toHaveLength(2)
    expect(assignments[0].work_date).toBe('2026-08-30')
    expect(assignments[1].work_date).toBe('2026-08-31')
  })

  it('falls back to a single-letter day abbreviation when no date is readable', () => {
    const grid: RawGrid = {
      rows: [
        // No numeric date at all in these headers — only the abbreviation.
        [cell('משמרות'), cell("א'"), cell("ג׳")],
        [cell('אחמ"ש')],
        [cell('אחמ"ש בוקר'), cell('06:30-15:00 בדיקה־א׳'), cell('06:30-15:00 בדיקה־ב׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(2)
    expect(assignments[0].work_date).toBe('2026-09-06') // Sunday = א
    expect(assignments[1].work_date).toBe('2026-09-08') // Tuesday = ג
  })

  it('does not mistake ordinary label text for a day abbreviation', () => {
    // "משמרות" contains both ו and ש; a naive single-letter match would give
    // column 0 a date and turn the position-label column into a day column.
    const grid: RawGrid = {
      rows: [
        [cell('משמרות'), cell("א' 30\\8")],
        [cell('אחמ"ש')],
        [cell('אחמ"ש בוקר'), cell('06:30-15:00 בדיקה־א׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, new Date('2026-08-30T00:00:00.000Z'))
    expect(assignments).toHaveLength(1)
    expect(assignments[0].position).toBe('אחמ"ש בוקר')
  })

  it('handles names with quotes, apostrophes, and extra spaces without corrupting them', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער'), cell("06:00-14:00 בדיקה  ד'ולי")],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments[0].source_name).toBe("בדיקה ד'ולי")
  })
})
