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

  it('classifies shift_category from the start hour per SHIFT_CATEGORIES boundaries', () => {
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
