import { createWorker } from 'tesseract.js'
import type { ParseResult, RawCell, RawGrid, ValidationWarning } from './types'

/**
 * OCR runs client-side (in the manager's browser), not server-side. A spike
 * confirmed tesseract.js cannot boot in Supabase's Deno edge runtime under
 * any import variant (its worker-spawn code always resolves to Node's
 * worker_threads, which Deno's compat layer doesn't implement) — unlike
 * pdfjs-dist, no edge-compatible drop-in was found. See
 * docs/superpowers/specs/2026-09-01-image-schedule-import-design.md.
 */

const LOW_CONFIDENCE_THRESHOLD = 60 // tesseract.js confidence is 0-100

// Row/column clustering tolerances scale with the OCR'd word sizes rather
// than using fixed pixel constants, so the same code works whether the
// screenshot is a small phone capture or a huge desktop one. Calibrated
// against a real screenshot of the user's actual source system
// (mishmarot.co.il, 2752px wide): median word height ~17px, median word
// width ~57px. Within one table cell, the "HH:MM-HH:MM" line and the name
// line below it sit ~2.0x the median word height apart; different table
// rows sit ~2.6x apart — ROW_HEIGHT_MULTIPLIER picks the midpoint of that
// window so cell-internal lines merge but distinct rows don't. Column
// centers sit ~300-400px apart in that real image while same-cell words
// (e.g. a two-word name) sit at most ~66px apart — COLUMN_WIDTH_MULTIPLIER
// is comfortably inside that gap. Still a heuristic, not a guarantee for
// every possible screenshot layout/zoom level — revisit if a differently
// laid out source system needs this.
const ROW_HEIGHT_MULTIPLIER = 2.3
const COLUMN_WIDTH_MULTIPLIER = 2.5
const MIN_ROW_TOLERANCE = 10
const MIN_COLUMN_TOLERANCE = 60

export type OcrWord = {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

async function ocrImage(bytes: Uint8Array, onProgress?: (progress: number) => void): Promise<OcrWord[]> {
  const worker = await createWorker(['heb', 'eng'], undefined, {
    logger: (msg) => {
      if (msg.status === 'recognizing text' && onProgress) onProgress(msg.progress)
    },
  })
  try {
    const blob = new Blob([bytes as unknown as BlobPart])
    const { data } = await worker.recognize(blob, {}, { blocks: true })
    const words: OcrWord[] = []
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const word of line.words) {
            words.push(word)
          }
        }
      }
    }
    return words.filter((w) => w.text.trim().length > 0)
  } finally {
    await worker.terminate()
  }
}

function yCenter(w: OcrWord): number {
  return (w.bbox.y0 + w.bbox.y1) / 2
}

function xCenter(w: OcrWord): number {
  return (w.bbox.x0 + w.bbox.x1) / 2
}

/**
 * Clusters OCR words into row bands (by Y), then within each row band into
 * column bands (by X). Columns are ordered right-to-left (X descending) to
 * match this Hebrew RTL table's convention of the position/label column
 * sitting on the right edge — normalizeSchedule expects row[0] to be the
 * label, and every other index to be a day column carrying its own header
 * text (order among those doesn't matter, since normalizeSchedule reads
 * each day's actual date from that column's own header cell).
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function clusterWordsIntoGrid(words: OcrWord[]): { grid: RawGrid; warnings: ValidationWarning[] } {
  const warnings: ValidationWarning[] = []
  if (words.length === 0) return { grid: { rows: [] }, warnings }

  const medianHeight = median(words.map((w) => w.bbox.y1 - w.bbox.y0))
  const medianWidth = median(words.map((w) => w.bbox.x1 - w.bbox.x0))
  const rowTolerance = Math.max(MIN_ROW_TOLERANCE, medianHeight * ROW_HEIGHT_MULTIPLIER)
  const columnTolerance = Math.max(MIN_COLUMN_TOLERANCE, medianWidth * COLUMN_WIDTH_MULTIPLIER)

  const sortedByY = [...words].sort((a, b) => yCenter(a) - yCenter(b))
  const rowBands: OcrWord[][] = []
  for (const word of sortedByY) {
    const lastBand = rowBands[rowBands.length - 1]
    const lastBandY = lastBand ? yCenter(lastBand[lastBand.length - 1]) : null
    if (lastBand && lastBandY !== null && Math.abs(yCenter(word) - lastBandY) <= rowTolerance) {
      lastBand.push(word)
    } else {
      rowBands.push([word])
    }
  }

  const rows: RawCell[][] = rowBands.map((rowWords, rowIndex) => {
    const sortedByX = [...rowWords].sort((a, b) => xCenter(b) - xCenter(a)) // right-to-left
    const columnBands: OcrWord[][] = []
    for (const word of sortedByX) {
      const lastBand = columnBands[columnBands.length - 1]
      const lastBandX = lastBand ? xCenter(lastBand[lastBand.length - 1]) : null
      if (lastBand && lastBandX !== null && Math.abs(xCenter(word) - lastBandX) <= columnTolerance) {
        lastBand.push(word)
      } else {
        columnBands.push([word])
      }
    }

    return columnBands.map((cellWords, colIndex) => {
      // Within a cell, sort top-to-bottom then left-to-right to reconstruct
      // stacked lines (e.g. "HH:MM-HH:MM" above a name) in reading order.
      const sorted = [...cellWords].sort((a, b) => {
        const dy = yCenter(a) - yCenter(b)
        if (Math.abs(dy) > rowTolerance / 2) return dy
        return xCenter(b) - xCenter(a)
      })
      const text = sorted.map((w) => w.text.trim()).join(' ')
      const avgConfidence = sorted.reduce((sum, w) => sum + w.confidence, 0) / sorted.length

      if (avgConfidence < LOW_CONFIDENCE_THRESHOLD && text.length > 0) {
        warnings.push({
          kind: 'low_confidence_ocr',
          message: `ביטחון קריאה נמוך בשורה ${rowIndex + 1}, עמודה ${colIndex + 1}: "${text}"`,
        })
      }

      return { text, entries: text ? [text] : [] }
    })
  })

  return { grid: { rows }, warnings }
}

/**
 * Merges multiple images' independently-clustered grids into one. Only the
 * first image's header row is kept as authoritative (multiple images are
 * expected to be the same week's table, just split across screenshots);
 * every image's non-header rows are concatenated after it.
 */
function mergeGrids(grids: RawGrid[]): RawGrid {
  if (grids.length === 0) return { rows: [] }
  const [first, ...rest] = grids
  const rows = [...first.rows]
  for (const g of rest) {
    rows.push(...g.rows.slice(1))
  }
  return { rows }
}

export async function parseImageSchedule(
  images: Uint8Array[],
  onProgress?: (info: { imageIndex: number; totalImages: number; progress: number }) => void,
): Promise<ParseResult> {
  if (images.length === 0) {
    return { supported: false, reason: 'לא נבחרו תמונות.' }
  }

  const grids: RawGrid[] = []
  const allWarnings: ValidationWarning[] = []

  for (let i = 0; i < images.length; i++) {
    const words = await ocrImage(images[i], (progress) =>
      onProgress?.({ imageIndex: i, totalImages: images.length, progress }),
    )
    const { grid, warnings } = clusterWordsIntoGrid(words)
    grids.push(grid)
    allWarnings.push(...warnings)
  }

  const merged = mergeGrids(grids)

  if (merged.rows.length === 0) {
    return {
      supported: false,
      reason: 'לא זוהה טקסט קריא בתמונה. יש לוודא שהתמונה ברורה וכוללת את הלוז המלא.',
    }
  }

  return { supported: true, grid: merged, warnings: allWarnings }
}
