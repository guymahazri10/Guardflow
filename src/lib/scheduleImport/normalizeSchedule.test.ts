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
        [cell('אחמ"ש'), cell('06:00-14:00 בדיקה־א׳'), cell('')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      work_date: '2026-09-06',
      worker_kind: 'אחמ"ש',
      position: 'אחמ"ש',
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
        [cell('AB'), cell('06:00-14:00 בדיקה־ג׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].position).toBe('AB')
    expect(assignments.some((a) => a.source_name === 'בדיקה־ב׳')).toBe(false)
  })

  it('leaves an empty cell as a skip, not an assignment', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('AB'), cell('')],
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
          cell('AB', []),
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
        [cell('אחמ"ש'), cell('09:30-12:15 בדיקה־ו׳')],
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
        [cell('AB'), cell('23:00-07:00 בדיקה־ז׳')],
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
        [cell('AB'), cell('07:00-15:00 בדיקה־ח׳')],
        [cell('CD'), cell('15:00-23:00 בדיקה־ט׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments.find((a) => a.position === 'AB')?.shift_category).toBe('morning')
    expect(assignments.find((a) => a.position === 'CD')?.shift_category).toBe('afternoon')
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
        [cell('לובי עליון'), cell('22:45-07:10 בדיקה־ו׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    const categoryOf = (position: string) =>
      assignments.find((a) => a.position === position)?.shift_category

    // All three אחמ"ש rows collapse to the single canonical "אחמ"ש" position
    // (see normalizeSchedule's coercion, matching the image/JSON path) — so
    // they're distinguished by shift_category, not position, here.
    const achmashCategories = assignments.filter((a) => a.position === 'אחמ"ש').map((a) => a.shift_category)
    expect(achmashCategories).toEqual(expect.arrayContaining(['morning', 'afternoon', 'night']))
    expect(categoryOf('לובי תחתון')).toBe('morning')
    expect(categoryOf('AB')).toBe('afternoon')
    expect(categoryOf('לובי עליון')).toBe('night')
  })

  it('classifies exceptional/partial shift start times into the right categories', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        // Late morning start, and a long morning shift running into evening
        [cell('AB'), cell('08:00-15:10 בדיקה־א׳')],
        [cell('CD'), cell('06:30-19:00 בדיקה־ב׳')],
        // Short afternoon shift ending early
        [cell('EFG'), cell('14:45-18:30 בדיקה־ג׳')],
        // Night shift starting unusually early
        [cell('רכוב'), cell('21:00-07:10 בדיקה־ד׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    const categoryOf = (position: string) =>
      assignments.find((a) => a.position === position)?.shift_category

    expect(categoryOf('AB')).toBe('morning')
    expect(categoryOf('CD')).toBe('morning')
    expect(categoryOf('EFG')).toBe('afternoon')
    expect(categoryOf('רכוב')).toBe('night')
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
    expect(assignments[0].position).toBe('אחמ"ש')
  })

  it('handles names with quotes, apostrophes, and extra spaces without corrupting them', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('AB'), cell("06:00-14:00 בדיקה  ד'ולי")],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments[0].source_name).toBe("בדיקה ד'ולי")
  })

  it('skips a row with an unrecognized מאבטח position, with a warning — not a new position value', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('עמדה שלא קיימת'), cell('06:00-14:00 בדיקה')],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('עמדה לא מוכרת')
  })

  it('skips an hour value outside 0-23/0-59, with a warning', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('AB'), cell('25:00-14:00 בדיקה')],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('שעה מחוץ לטווח')
  })

  it('treats a header date that is not a real calendar date as unparseable (same as no date at all)', () => {
    const grid: RawGrid = {
      // 31/2 (Feb 31) — passes the header regex's day/month range check but
      // does not exist; Date.UTC would otherwise silently roll it into March.
      rows: [
        [cell(''), cell('31/2')],
        [cell('מאבטח')],
        [cell('AB'), cell('06:00-14:00 בדיקה')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(0)
  })

  it('skips a zero-duration shift (identical start and end), with a warning', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('AB'), cell('08:00-08:00 בדיקה')],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('משך משמרת לא חיובי')
  })

  it('returns warnings alongside excludedSectionsSeen — neither replaces the other', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('היעדרויות')],
        [cell('שער ראשי'), cell('06:00-14:00 בדיקה')],
        [cell('מאבטח')],
        [cell('עמדה שלא קיימת'), cell('06:00-14:00 בדיקה')],
      ],
    }
    const { warnings, excludedSectionsSeen } = normalizeSchedule(grid, weekStart)
    expect(excludedSectionsSeen).toEqual(['היעדרויות'])
    expect(warnings).toHaveLength(1)
  })
})

// Real-file findings (verified 2026-10-19 against an actual mishmarot.co.il
// weekly export, anonymized here — synthetic names only, never real
// personnel). See the 2026-10-19 verification report for the full trace.
describe('normalizeSchedule — real export format (Findings A/B/C)', () => {
  it('parses hours and name on separate lines, the real export format, alongside the original same-line format', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('AB'), cell('06:45-15:10\nבדיקה־נפרד', ['06:45-15:10', 'בדיקה־נפרד'])],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({ position: 'AB', source_name: 'בדיקה־נפרד' })
  })

  it('still parses the original same-line "HH:MM-HH:MM name" format unchanged', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('AB'), cell('06:45-15:10 בדיקה־ישן')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].source_name).toBe('בדיקה־ישן')
  })

  it('produces two rows via slot_index for two workers stacked as separate-line pairs in one cell', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [
          cell('AB', []),
          cell('06:45-15:10\nבדיקה־ראשון\n06:45-15:10\nבדיקה־שני', [
            '06:45-15:10',
            'בדיקה־ראשון',
            '06:45-15:10',
            'בדיקה־שני',
          ]),
        ],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(2)
    expect(assignments.map((a) => a.slot_index).sort()).toEqual([0, 1])
    expect(assignments.map((a) => a.source_name).sort()).toEqual(['בדיקה־ראשון', 'בדיקה־שני'])
  })

  it('warns with location and reason for a non-empty line that is neither a time nor a name following one — never a silent skip', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [
          cell('AB', []),
          cell('שארית טקסט מוזרה\n06:00-14:00\nבדיקה־עובד', [
            'שארית טקסט מוזרה',
            '06:00-14:00',
            'בדיקה־עובד',
          ]),
        ],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].source_name).toBe('בדיקה־עובד')
    expect(
      warnings.some((w) => w.kind === 'low_confidence_ocr' && w.message.includes('שארית טקסט מוזרה')),
    ).toBe(true)
    expect(warnings.some((w) => w.position === 'AB')).toBe(true)
  })

  it('resolves every real composite מאבטח label to its canonical position via explicit token matching', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('בוקר מאבטח 06:45-15:10 לובי עליון - חמוש'), cell('06:45-15:10 בדיקה־א')],
        [cell('בוקר מאבטח 06:45-15:10 לובי תחתון'), cell('06:45-15:10 בדיקה־ב')],
        [cell('בוקר מאבטח AB 06:45-15:10'), cell('06:45-15:10 בדיקה־ג')],
        [cell('צהריים מאבטח CD 14:45-23:10'), cell('14:45-23:10 בדיקה־ד')],
        [cell('בוקר מאבטח EFG 06:45-15:10'), cell('06:45-15:10 בדיקה־ה')],
        [cell('מאבטח רכוב בוקר'), cell('06:45-15:10 בדיקה־ו')],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart)
    expect(assignments.map((a) => a.position).sort()).toEqual(['AB', 'CD', 'EFG', 'לובי עליון', 'לובי תחתון', 'רכוב'].sort())
    expect(warnings.filter((w) => w.kind === 'unresolved_position_mapping')).toHaveLength(0)
  })

  it('resolves "לילה מאבטח" directly — a role label, not a canonical post, with no warning in the supported (single-guard) case', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('לילה מאבטח'), cell('22:45-07:10\nבדיקה־לילה', ['22:45-07:10', 'בדיקה־לילה'])],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({ position: 'לילה מאבטח', source_name: 'בדיקה־לילה', shift_category: 'night' })
    expect(warnings.filter((w) => w.kind === 'unresolved_position_mapping' || w.kind === 'position_capacity_mismatch')).toHaveLength(0)
  })

  it('still rolls "לילה מאבטח" past midnight to the next calendar day, same as any other night row', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('לילה מאבטח'), cell('22:45-07:10\nבדיקה־לילה', ['22:45-07:10', 'בדיקה־לילה'])],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments[0].work_date).toBe('2026-09-06') // filed under the start date
    expect(assignments[0].starts_at.slice(0, 10)).toBe('2026-09-06')
    expect(assignments[0].ends_at.slice(0, 10)).toBe('2026-09-07') // rolled to the next day
  })

  function nightGuardGrid(names: string[]): RawGrid {
    const entries = names.flatMap((n) => ['22:45-07:10', n])
    return {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('לילה מאבטח', []), cell(entries.join('\n'), entries)],
      ],
    }
  }

  it('accepts one name under "לילה מאבטח" with no capacity warning', () => {
    const { assignments, warnings } = normalizeSchedule(nightGuardGrid(['בדיקה־ראשי']), weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].slot_index).toBe(0)
    expect(warnings.some((w) => w.kind === 'position_capacity_mismatch')).toBe(false)
  })

  it('accepts two names under "לילה מאבטח" as slot_index 0 and 1 with no capacity warning', () => {
    const { assignments, warnings } = normalizeSchedule(nightGuardGrid(['בדיקה־ראשי', 'בדיקה־נוסף']), weekStart)
    expect(assignments.map((a) => [a.source_name, a.slot_index])).toEqual([
      ['בדיקה־ראשי', 0],
      ['בדיקה־נוסף', 1],
    ])
    expect(assignments.every((a) => a.position === 'לילה מאבטח')).toBe(true)
    expect(warnings.some((w) => w.kind === 'position_capacity_mismatch')).toBe(false)
  })

  it('flags a THIRD name under "לילה מאבטח" as a capacity mismatch — never silently dropped', () => {
    const { assignments, warnings } = normalizeSchedule(
      nightGuardGrid(['בדיקה־א', 'בדיקה־ב', 'בדיקה־ג']),
      weekStart,
    )
    expect(assignments).toHaveLength(3) // surfaced, not omitted
    const mismatches = warnings.filter((w) => w.kind === 'position_capacity_mismatch')
    expect(mismatches).toHaveLength(1) // only the over-capacity name is flagged
    expect(mismatches[0].work_date).toBe('2026-09-06')
    expect(mismatches[0].message).toContain('(2)')
  })

  it('still blocks a different period+מאבטח label that is not the one supported role (not silently resolved)', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('בוקר מאבטח משני'), cell('06:00-14:00 בדיקה')],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].position).toBe('בוקר מאבטח משני')
    expect(warnings.some((w) => w.kind === 'unresolved_position_mapping')).toBe(true)
    expect(warnings.some((w) => w.kind === 'position_capacity_mismatch')).toBe(false)
  })

  it('still skips a genuinely unrecognized מאבטח label (not period+מאבטח) with the existing generic warning, not as unresolved-mapping', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('עמדה שלא קיימת'), cell('06:00-14:00 בדיקה')],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(0)
    expect(warnings.filter((w) => w.kind === 'unresolved_position_mapping')).toHaveLength(0)
    expect(warnings.some((w) => w.message.includes('עמדה לא מוכרת'))).toBe(true)
  })

  it('excludes a section-label row even when it carries its own inline data, right after a worker section (Finding C)', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('אחמ"ש')],
        [cell('אחמ"ש'), cell('06:00-14:00 בדיקה־מפקד')],
        // "קורס" is an excluded label, but this row ALSO carries real-looking
        // data (not a clean label-only row) — before the fix, the stricter
        // "all other cells empty" check missed this as a section transition
        // entirely, so currentSection stayed אחמ"ש and this data would have
        // leaked in as a fake אחמ"ש assignment (אחמ"ש's position is always
        // coerced to the bare canonical value regardless of row label).
        [cell('קורס'), cell('06:00-14:00 בדיקה־אסור')],
        [cell('מאבטח')],
        [cell('AB'), cell('06:00-14:00 בדיקה־עובד')],
      ],
    }
    const { assignments, excludedSectionsSeen } = normalizeSchedule(grid, weekStart)
    expect(assignments.map((a) => a.source_name).sort()).toEqual(['בדיקה־מפקד', 'בדיקה־עובד'])
    expect(assignments.some((a) => a.source_name === 'בדיקה־אסור')).toBe(false)
    expect(excludedSectionsSeen).toContain('קורס')
  })

  it('filters בקרה by row/section only — the same synthetic name elsewhere as אחמ"ש on another day still appears', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09'), cell('שני 07/09')],
        [cell('בקרה')],
        [cell('עמדה 1'), cell('06:00-14:00 בדיקה־שרון'), cell('')],
        [cell('אחמ"ש')],
        [cell('אחמ"ש'), cell(''), cell('06:00-14:00 בדיקה־שרון')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({ work_date: '2026-09-07', worker_kind: 'אחמ"ש', source_name: 'בדיקה־שרון' })
  })

  it('reads the real date row (month\\day, separate from the day-letter row) instead of guessing day\\month', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell("א'"), cell("ב'")],
        [cell('משמרות'), cell('10\\18'), cell('10\\19')], // month=10, day=18/19 — day\\month would be invalid (no month 18/19)
        [cell('מאבטח')],
        [cell('AB'), cell('06:45-15:10 בדיקה־א')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, new Date('2026-10-18T00:00:00.000Z'))
    expect(assignments).toHaveLength(1)
    expect(assignments[0].work_date).toBe('2026-10-18')
  })

  it('resolves an ambiguous D\\M vs M\\D header against the unambiguous day-letter anchor, without a warning', () => {
    // "6\9" is valid both as day=6/month=9 (Sep 6, matches the ו' anchor)
    // and as day=9/month=6 (Jun 9, doesn't) — the anchor disambiguates it.
    const grid: RawGrid = {
      rows: [
        [cell(''), cell("א' 6\\9")],
        [cell('מאבטח')],
        [cell('AB'), cell('06:00-14:00 בדיקה')],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart) // weekStart = Sunday 2026-09-06
    expect(assignments[0].work_date).toBe('2026-09-06')
    expect(warnings.filter((w) => w.kind === 'week_mismatch')).toHaveLength(0)
  })

  it('does not guess when a header date is genuinely ambiguous and disagrees with the day-letter anchor — falls back to the anchor and warns', () => {
    // "5\8" is valid both as Aug 5 and as May 8; the ג' anchor (Tuesday,
    // 2026-09-08) matches neither — must not silently pick one.
    const grid: RawGrid = {
      rows: [
        [cell(''), cell("ג' 5\\8")],
        [cell('מאבטח')],
        [cell('AB'), cell('06:00-14:00 בדיקה')],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, weekStart) // weekStart = Sunday 2026-09-06
    expect(assignments[0].work_date).toBe('2026-09-08') // ג' = Tuesday = weekStart + 2
    expect(warnings.some((w) => w.kind === 'week_mismatch')).toBe(true)
  })

  it('resolves a header date across a year boundary to the year closest to weekStart', () => {
    // "1\25" is only valid as day=25/month=1 (Jan 25) — month=1 as "day"
    // isn't itself invalid, but day=1/month=25 is (no month 25), so this is
    // unambiguous; the year isn't written in the file at all and must be
    // inferred as whichever year lands closest to weekStart.
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('1\\25')], // no day-letter at all — pure numeric column
        [cell('מאבטח')],
        [cell('AB'), cell('06:00-14:00 בדיקה')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, new Date('2026-12-27T00:00:00.000Z'))
    expect(assignments[0].work_date).toBe('2027-01-25')
  })
})
