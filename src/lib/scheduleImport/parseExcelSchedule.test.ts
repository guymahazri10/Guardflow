// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseExcelSchedule } from './parseExcelSchedule'

function buildTestWorkbookBytes(): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([
    ['', 'ראשון 06/09'],
    ['אחמ"ש'],
    ['שער ראשי', '06:00-14:00 בדיקה־א׳'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Uint8Array(out)
}

describe('parseExcelSchedule', () => {
  it('parses a real xlsx workbook into a RawGrid', () => {
    const bytes = buildTestWorkbookBytes()
    const grid = parseExcelSchedule(bytes, 'xlsx')
    expect(grid.rows[0][1].text).toContain('ראשון')
    expect(grid.rows[1][0].text).toBe('אחמ"ש')
    expect(grid.rows[2][1].text).toContain('בדיקה־א׳')
  })

  it('parses HTML-as-xls into the same RawGrid shape', () => {
    const html = `
      <html><body><table>
        <tr><td></td><td>ראשון 06/09</td></tr>
        <tr><td>אחמ"ש</td></tr>
        <tr><td>שער ראשי</td><td>06:00-14:00 בדיקה־ב׳</td></tr>
      </table></body></html>
    `
    const bytes = new TextEncoder().encode(html)
    const grid = parseExcelSchedule(bytes, 'xls-html')
    expect(grid.rows[0][1].text).toContain('ראשון')
    expect(grid.rows[2][1].text).toContain('בדיקה־ב׳')
  })

  it('splits multiple <br>-separated lines in one HTML cell into entries', () => {
    const html = `
      <table>
        <tr><td></td><td>ראשון 06/09</td></tr>
        <tr><td>מאבטח</td></tr>
        <tr><td>שער</td><td>06:00-14:00 בדיקה־ג׳<br>06:00-14:00 בדיקה־ד׳</td></tr>
      </table>
    `
    const bytes = new TextEncoder().encode(html)
    const grid = parseExcelSchedule(bytes, 'xls-html')
    expect(grid.rows[2][1].entries).toHaveLength(2)
    expect(grid.rows[2][1].entries[0]).toContain('בדיקה־ג׳')
    expect(grid.rows[2][1].entries[1]).toContain('בדיקה־ד׳')
  })

  it('respects HTML rowspan/colspan by leaving spanned cells empty rather than misaligning columns', () => {
    const html = `
      <table>
        <tr><td colspan="2">ראשון 06/09</td></tr>
        <tr><td>מאבטח</td></tr>
        <tr><td>שער</td><td>06:00-14:00 בדיקה־ה׳</td></tr>
      </table>
    `
    const bytes = new TextEncoder().encode(html)
    const grid = parseExcelSchedule(bytes, 'xls-html')
    expect(grid.rows[0][0].text).toContain('ראשון')
    expect(grid.rows[0][1].text).toBe('')
  })
})
