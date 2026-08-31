import * as pdfjsLib from 'pdfjs-dist'
import type { ParseResult, RawCell, RawGrid } from './types'

const MIN_TEXT_ITEMS_FOR_SUPPORTED = 4

type TextItem = { str: string; transform: number[] }

function clusterIntoGrid(items: TextItem[]): RawGrid {
  if (items.length === 0) return { rows: [] }

  // transform[5] is the Y position (PDF coordinate space, larger = higher on page).
  // Group items into rows by Y (rounded, since exact alignment varies slightly),
  // then sort each row left-to-right by X (transform[4]).
  const rowsByY = new Map<number, TextItem[]>()
  for (const item of items) {
    const y = Math.round(item.transform[5] / 5) * 5 // bucket to tolerate minor jitter
    const bucket = rowsByY.get(y) ?? []
    bucket.push(item)
    rowsByY.set(y, bucket)
  }

  const sortedYs = Array.from(rowsByY.keys()).sort((a, b) => b - a) // top of page first

  const rows: RawCell[][] = sortedYs.map((y) => {
    const rowItems = rowsByY.get(y)!.sort((a, b) => a.transform[4] - b.transform[4])
    return rowItems.map((item) => ({ text: item.str.trim(), entries: [item.str.trim()] }))
  })

  return { rows }
}

export async function parsePdfSchedule(bytes: Uint8Array): Promise<ParseResult> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes })
  const pdf = await loadingTask.promise

  const allItems: TextItem[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()
    for (const item of textContent.items as TextItem[]) {
      if (item.str && item.str.trim()) allItems.push(item)
    }
  }

  if (allItems.length < MIN_TEXT_ITEMS_FOR_SUPPORTED) {
    return { supported: false, reason: 'קובץ PDF סרוק — לא נתמך בשלב זה. יש להעלות כקובץ Excel.' }
  }

  return { supported: true, grid: clusterIntoGrid(allItems) }
}
