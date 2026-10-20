// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { detectFileKind } from './detectFileKind'
import { parseExcelSchedule } from './parseExcelSchedule'
import { normalizeSchedule } from './normalizeSchedule'

// A reduced, anonymized copy of the source system's real HTML-as-.xls export:
// per-worker <div class="oved-wrap"> blocks (hours spans + name span), group
// header rows with colspan, script tags and old commented-out markup inside
// the cells, and two workers stacked in one cell.
function worker(id: string, start: string, end: string, name: string, title: string): string {
  return `<div class="oved-wrap ">
    <span class="shift-hours" id="hours_${id}"><span class="shiftsTime">${start}</span>-<span class="shiftsTime">${end}</span></span>
    <div class="oved-name " id="${id}">
      <!--removed by dev - onclick="handle_click(this,1)"-->
      <span title="${title}"><span title="${title}">${name}</span></span></div>
    <!--<input value="${name}">!-->
  </div>`
}

const cellScript = '<script type="text/javascript">holder_row[1]="ombo-1-1-1";</script>'
const html = `${String.fromCharCode(0xfeff)}<html><head><meta charset="windows-1252"><style>td{}</style></head><body><table id="mytable1">
<thead><tr><th></th><th>א'</th><th>ב'</th></tr>
<tr><th>משמרות</th><th>10\\18</th><th>10\\19</th></tr></thead><tbody>
<tr><td colspan="3">אחמ"ש</td></tr>
<tr><td>אחמ"ש בוקר06:30-15:10</td><td>${cellScript}${worker('a1', '06:30', '15:00', 'מנהל א', 'אחמ"ש בוקר')}</td><td>${worker('a2', '06:30', '19:00', 'מנהל ב', 'אחמ"ש בוקר')}</td></tr>
<tr><td colspan="3">בקרה</td></tr>
<tr><td>בוקר בקרה 1</td><td>${worker('c1', '06:45', '15:10', 'בקר א', 'בקרה')}</td><td></td></tr>
<tr><td colspan="3">מאבטח</td></tr>
<tr><td>בוקר מאבטח 06:45-15:10 לובי עליון - חמוש</td><td>${worker('g1', '06:45', '15:10', 'שומר א', 't')}${worker('g2', '06:45', '15:10', 'שומר ב', 't')}</td><td></td></tr>
<tr><td>לילה מאבטח</td><td>${worker('n1', '22:45', '07:10', 'לילי א', 't')}</td><td>${worker('n2', '22:45', '07:10', 'לילי ב', 't')}${worker('n3', '22:45', '07:10', 'לילי ג', 't')}</td></tr>
<tr><td colspan="3">היעדרויות</td></tr>
<tr><td>קורס</td><td>${worker('k1', '00:00', '00:00', 'חניך', 'קורס')}</td><td></td></tr>
</tbody></table></body></html>`

describe('real export format', () => {
  const bytes = new TextEncoder().encode(html)
  const weekStart = new Date(Date.UTC(2026, 9, 18))

  it('is detected as HTML-as-xls', () => {
    expect(detectFileKind(bytes)).toBe('xls-html')
  })

  it('imports guards and אחמ"ש, excludes control and absences, and reads every worker of a stacked cell', () => {
    const { assignments, summary, warnings } = normalizeSchedule(parseExcelSchedule(bytes, 'xls-html'), weekStart)
    expect(assignments.map((a) => [a.work_date, a.shift_category, a.position, a.slot_index, a.source_name])).toEqual([
      ['2026-10-18', 'morning', 'אחמ"ש', 0, 'מנהל א'],
      ['2026-10-19', 'morning', 'אחמ"ש', 0, 'מנהל ב'],
      ['2026-10-18', 'morning', 'לובי עליון', 0, 'שומר א'],
      ['2026-10-18', 'morning', 'לובי עליון', 1, 'שומר ב'],
      ['2026-10-18', 'night', 'לילה מאבטח', 0, 'לילי א'],
      ['2026-10-19', 'night', 'לילה מאבטח', 0, 'לילי ב'],
      ['2026-10-19', 'night', 'לילה מאבטח', 1, 'לילי ג'],
    ])
    expect(summary.excluded).toEqual([
      { section: 'בקרה', reason: 'קבוצת בקרה — לא נכללת בסידור', count: 1 },
      { section: 'קורס', reason: 'היעדרות (קורס) — לא נכללת בסידור', count: 1 },
    ])
    // three night guards across two days: one and two — never a capacity warning
    expect(warnings.some((w) => w.kind === 'position_capacity_mismatch')).toBe(false)
    // the 06:30-19:00 morning shift is kept as read and flagged
    const unusual = warnings.filter((w) => w.kind === 'unusual_shift_hours')
    expect(unusual).toHaveLength(1)
    expect(unusual[0].original_hours).toBe('06:30-19:00')
    // no script text or markup leaked into any name
    expect(assignments.every((a) => !/holder_row|<|>/.test(a.source_name ?? ''))).toBe(true)
  })
})
