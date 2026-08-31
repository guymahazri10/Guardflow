import * as XLSX from 'xlsx'
import type { RawCell, RawGrid } from './types'

function splitEntries(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function parseRealWorkbook(bytes: Uint8Array): RawGrid {
  const workbook = XLSX.read(bytes, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })

  const rows: RawCell[][] = aoa.map((row) =>
    row.map((value) => {
      const text = String(value ?? '').trim()
      return { text, entries: splitEntries(text) }
    }),
  )

  return { rows }
}

function parseHtmlTable(bytes: Uint8Array): RawGrid {
  const html = new TextDecoder('utf-8').decode(bytes)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return { rows: [] }

  const trElements = Array.from(table.querySelectorAll('tr'))
  // Track colspan/rowspan occupancy so spanned cells don't shift later columns.
  const occupied: boolean[][] = []

  const rows: RawCell[][] = trElements.map((tr, rowIndex) => {
    occupied[rowIndex] = occupied[rowIndex] ?? []
    const cells: RawCell[] = []
    let colCursor = 0

    const tds = Array.from(tr.querySelectorAll('td, th'))
    for (const td of tds) {
      while (occupied[rowIndex]?.[colCursor]) colCursor += 1

      const rawHtml = td.innerHTML.replace(/<br\s*\/?>/gi, '\n')
      const tempDoc = new DOMParser().parseFromString(`<div>${rawHtml}</div>`, 'text/html')
      const text = (tempDoc.body.textContent ?? '').trim()

      cells[colCursor] = { text, entries: splitEntries(text) }

      const colspan = Number(td.getAttribute('colspan') ?? '1')
      const rowspan = Number(td.getAttribute('rowspan') ?? '1')
      for (let r = 0; r < rowspan; r++) {
        occupied[rowIndex + r] = occupied[rowIndex + r] ?? []
        for (let c = 0; c < colspan; c++) {
          occupied[rowIndex + r][colCursor + c] = true
        }
      }
      colCursor += colspan
    }

    const width = Math.max(cells.length, occupied[rowIndex]?.length ?? 0)
    return Array.from({ length: width }, (_, i) => cells[i] ?? { text: '', entries: [] })
  })

  return { rows }
}

export function parseExcelSchedule(bytes: Uint8Array, kind: 'xlsx' | 'xls-html'): RawGrid {
  if (kind === 'xlsx') return parseRealWorkbook(bytes)
  return parseHtmlTable(bytes)
}
