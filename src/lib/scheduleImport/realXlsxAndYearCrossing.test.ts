import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { detectFileKind } from './detectFileKind'
import { parseExcelSchedule } from './parseExcelSchedule'
import { normalizeSchedule } from './normalizeSchedule'
import { normalizeExtractedAssignments } from './normalizeExtracted'

// A real .xlsx binary (zip container, not HTML): group headers are merged
// across the table, the date header row holds real date cells, and each
// worker is "hours\nname" in a wrapped cell — the shapes Excel itself writes.
function buildRealWorkbook(startDate: Date, days: number): Uint8Array {
  const dates = Array.from({ length: days }, (_, i) => new Date(startDate.getTime() + i * 86_400_000))
  const letters = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"]
  const aoa: unknown[][] = [
    ['', ...dates.map((_, i) => letters[i % 7])],
    ['משמרות', ...dates],
    ['אחמ"ש'],
    ['אחמ"ש בוקר06:30-15:10', ...dates.map((_, i) => `06:30-15:00\nמנהל ${i}`)],
    ['בקרה'],
    ['בוקר בקרה 1', ...dates.map((_, i) => `06:45-15:10\nבקר ${i}`)],
    ['מאבטח'],
    ['לילה מאבטח', ...dates.map((_, i) => (i === 0 ? '22:45-07:10\nשומר א\n22:45-07:10\nשומר ב' : `22:45-07:10\nשומר ${i}`))],
    ['היעדרויות'],
    ['קורס', '08:00-18:00\nחניך'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
  for (let c = 1; c <= days; c++) ws[XLSX.utils.encode_cell({ r: 1, c })].z = 'dd/mm/yyyy'
  ws['!merges'] = [2, 4, 6, 8].map((r) => ({ s: { r, c: 0 }, e: { r, c: days } }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'סידור')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }))
}

describe('real .xlsx workbook', () => {
  const bytes = buildRealWorkbook(new Date(Date.UTC(2026, 9, 18)), 7)

  it('is a zip container, detected as xlsx', () => {
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b])
    expect(detectFileKind(bytes)).toBe('xlsx')
  })

  it('imports guards and אחמ"ש, excludes control and absence, reads date cells and two-line cells', () => {
    const grid = parseExcelSchedule(bytes, 'xlsx')
    const { assignments, summary, warnings } = normalizeSchedule(grid, new Date(Date.UTC(2026, 9, 18)))
    expect(assignments.filter((a) => a.worker_kind === 'אחמ"ש')).toHaveLength(7)
    expect(assignments.every((a) => a.worker_kind !== undefined && !a.position.includes('בקרה'))).toBe(true)
    expect(assignments.map((a) => a.work_date).sort()[0]).toBe('2026-10-18')
    expect(new Set(assignments.map((a) => a.work_date)).size).toBe(7)
    // two guards stacked in the first night cell
    const night = assignments.filter((a) => a.position === 'לילה מאבטח' && a.work_date === '2026-10-18')
    expect(night.map((a) => [a.slot_index, a.source_name])).toEqual([[0, 'שומר א'], [1, 'שומר ב']])
    expect(summary.excluded).toEqual([
      { section: 'בקרה', reason: 'קבוצת בקרה — לא נכללת בסידור', count: 7 },
      { section: 'קורס', reason: 'היעדרות (קורס) — לא נכללת בסידור', count: 1 },
    ])
    expect(warnings.some((w) => w.kind === 'unknown_section' || w.kind === 'week_mismatch')).toBe(false)
  })

  it('reads a merged group header as spanning the table, so an unknown group is surfaced', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['', "א'"],
      ['משמרות', new Date(Date.UTC(2026, 9, 18))],
      ['צוות חדש'],
      ['בוקר אחר', '07:00-15:00\nמישהו'],
    ], { cellDates: true })
    ws['!merges'] = [{ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const out = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }))
    const { assignments, warnings } = normalizeSchedule(parseExcelSchedule(out, 'xlsx'), new Date(Date.UTC(2026, 9, 18)))
    expect(assignments).toHaveLength(0)
    expect(warnings.some((w) => w.kind === 'unknown_section' && w.position === 'צוות חדש')).toBe(true)
  })
})

describe('week crossing a year boundary', () => {
  it('gives the right year to every column of a week from 27/12 to 2/1 (headers carry no year)', () => {
    const grid = parseExcelSchedule(buildRealWorkbook(new Date(Date.UTC(2026, 11, 27)), 7), 'xlsx')
    const { assignments } = normalizeSchedule(grid, new Date(Date.UTC(2026, 11, 27)))
    const dates = [...new Set(assignments.map((a) => a.work_date))].sort()
    expect(dates).toEqual([
      '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ])
  })

  it('resolves month\\day headers without a year (the real export format) across the boundary', () => {
    const grid = {
      rows: [
        [{ text: '', entries: [] }, ...["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"].map((t) => ({ text: t, entries: [t] }))],
        [{ text: 'משמרות', entries: [] }, ...['12\\27', '12\\28', '12\\29', '12\\30', '12\\31', '1\\1', '1\\2'].map((t) => ({ text: t, entries: [t] }))],
        [{ text: 'אחמ"ש', entries: [], colspan: 8 }, ...Array(7).fill({ text: '', entries: [] })],
        [
          { text: 'אחמ"ש לילה22:30-07:10', entries: [] },
          ...Array.from({ length: 7 }, (_, i) => ({ text: `22:30-07:00\nמנהל ${i}`, entries: ['22:30-07:00', `מנהל ${i}`] })),
        ],
      ],
    }
    const { assignments, warnings } = normalizeSchedule(grid, new Date(Date.UTC(2026, 11, 27)))
    expect(assignments.map((a) => a.work_date)).toEqual([
      '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ])
    // the ambiguous "1\2" (Jan 2 or Feb 1) is settled by its day letter, with no warning
    expect(warnings.some((w) => w.kind === 'week_mismatch')).toBe(false)
    // the night shift of 31/12 belongs to 31/12 and ends on 1/1
    const nye = assignments.find((a) => a.work_date === '2026-12-31')!
    expect(nye.shift_category).toBe('night')
    expect(nye.ends_at.slice(0, 10)).toBe('2027-01-01')
    // the last night starts 2/1 and ends 3/1, still filed under 2/1
    const last = assignments.find((a) => a.work_date === '2027-01-02')!
    expect(last.ends_at.slice(0, 10)).toBe('2027-01-03')
  })

  it('does the same for a week that starts in the previous December relative to the reference (28/12/2025)', () => {
    const grid = parseExcelSchedule(buildRealWorkbook(new Date(Date.UTC(2025, 11, 28)), 7), 'xlsx')
    const { assignments } = normalizeSchedule(grid, new Date(Date.UTC(2025, 11, 28)))
    expect([...new Set(assignments.map((a) => a.work_date))].sort()).toEqual([
      '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03',
    ])
  })

  it('image / JSON path: year is anchored per column to the reference week', () => {
    const rec = (date: string, name: string) => ({
      date, worker_kind: 'אחמ"ש', position: 'אחמ"ש', start: '06:30', end: '15:00', name, shift: 'בוקר',
    })
    // the model guesses an arbitrary year; only day and month are trusted
    const { assignments } = normalizeExtractedAssignments(
      [rec('2024-12-30', 'א'), rec('2024-01-02', 'ב')],
      new Date(Date.UTC(2026, 11, 27)),
    )
    expect(assignments.map((a) => a.work_date)).toEqual(['2026-12-30', '2027-01-02'])
  })
})
