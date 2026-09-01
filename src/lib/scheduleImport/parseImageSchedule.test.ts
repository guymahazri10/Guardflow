import { describe, it, expect, vi } from 'vitest'
import { parseImageSchedule, clusterWordsIntoGrid } from './parseImageSchedule'

function word(text: string, x0: number, y0: number, confidence = 95) {
  return { text, confidence, bbox: { x0, y0, x1: x0 + 40, y1: y0 + 15 } }
}

// tesseract.js's real recognize({blocks:true}) result nests words under
// blocks -> paragraphs -> lines -> words. This helper wraps a flat word
// list into that shape (one block/paragraph/line per word) since the
// clustering logic under test only cares about the flattened word list,
// not the block/paragraph/line grouping tesseract itself would produce.
function wordsAsBlocks(words: ReturnType<typeof word>[]) {
  return words.map((w) => ({
    paragraphs: [{ lines: [{ words: [w] }] }],
  }))
}

vi.mock('tesseract.js', () => {
  return {
    createWorker: async () => ({
      recognize: async () => ({
        data: {
          blocks: wordsAsBlocks([
            // header row (top, y~10): position label on the right, one day column to its left
            word('משמרות', 400, 10),
            word('06/09', 200, 10),
            word('ראשון', 200, 25),
            // section row: אחמ"ש
            word('אחמ"ש', 400, 60),
            // data row: position label + one cell "HH:MM-HH:MM name"
            word('שער', 400, 100),
            word('06:00-14:00', 200, 95),
            word('בדיקה־א׳', 200, 110),
          ]),
        },
      }),
      terminate: async () => {},
    }),
  }
})

describe('parseImageSchedule', () => {
  it('extracts a RawGrid from a clean screenshot image', async () => {
    const result = await parseImageSchedule([new Uint8Array([0xff, 0xd8, 0xff])])
    expect(result.supported).toBe(true)
    if (result.supported) {
      const flatText = result.grid.rows.flat().map((c) => c.text).join(' ')
      expect(flatText).toContain('בדיקה־א׳')
      expect(flatText).toContain('אחמ"ש')
    }
  })

  it('flags a low-confidence cell as a warning without dropping it', async () => {
    vi.resetModules()
    vi.doMock('tesseract.js', () => ({
      createWorker: async () => ({
        recognize: async () => ({
          data: {
            blocks: wordsAsBlocks([
              word('משמרות', 400, 10),
              word('06/09', 200, 10, 95),
              word('אחמ"ש', 400, 60, 95),
              word('שער', 400, 100, 95),
              word('06:00-14:00', 200, 95, 30), // low confidence
              word('בדיקה־ב׳', 200, 110, 30),
            ]),
          },
        }),
        terminate: async () => {},
      }),
    }))
    const { parseImageSchedule: freshParse } = await import('./parseImageSchedule')
    const result = await freshParse([new Uint8Array([0xff, 0xd8, 0xff])])
    expect(result.supported).toBe(true)
    if (result.supported) {
      expect(result.warnings?.some((w) => w.kind === 'low_confidence_ocr')).toBe(true)
      // still present in the grid, not silently dropped
      const flatText = result.grid.rows.flat().map((c) => c.text).join(' ')
      expect(flatText).toContain('בדיקה־ב׳')
    }
  })

  it('concatenates multiple images into one merged grid, keeping only the first header', async () => {
    vi.resetModules()
    let call = 0
    vi.doMock('tesseract.js', () => ({
      createWorker: async () => ({
        recognize: async () => {
          call += 1
          if (call === 1) {
            return {
              data: {
                blocks: wordsAsBlocks([
                  word('משמרות', 400, 10),
                  word('06/09', 200, 10),
                  word('אחמ"ש', 400, 60),
                  word('שער א', 400, 100),
                  word('06:00-14:00', 200, 95),
                  word('בדיקה־א׳', 200, 110),
                ]),
              },
            }
          }
          return {
            data: {
              blocks: wordsAsBlocks([
                // second image's own (redundant) header, should be dropped
                word('משמרות', 400, 10),
                word('06/09', 200, 10),
                word('מאבטח', 400, 60),
                word('שער ב', 400, 100),
                word('07:00-15:00', 200, 95),
                word('בדיקה־ג׳', 200, 110),
              ]),
            },
          }
        },
        terminate: async () => {},
      }),
    }))
    const { parseImageSchedule: freshParse } = await import('./parseImageSchedule')
    const result = await freshParse([
      new Uint8Array([0xff, 0xd8, 0xff]),
      new Uint8Array([0xff, 0xd8, 0xff]),
    ])
    expect(result.supported).toBe(true)
    if (result.supported) {
      const flatText = result.grid.rows.flat().map((c) => c.text).join(' ')
      expect(flatText).toContain('בדיקה־א׳')
      expect(flatText).toContain('בדיקה־ג׳')
      // only one header row survives — the merged grid's row 0 is the first image's header only
      expect(result.grid.rows[0].some((c) => c.text.includes('06/09'))).toBe(true)
    }
  })

  it('reports unsupported when no images are provided', async () => {
    const result = await parseImageSchedule([])
    expect(result.supported).toBe(false)
  })

  it('reports unsupported when no readable text is found', async () => {
    vi.resetModules()
    vi.doMock('tesseract.js', () => ({
      createWorker: async () => ({
        recognize: async () => ({ data: { blocks: [] } }),
        terminate: async () => {},
      }),
    }))
    const { parseImageSchedule: freshParse } = await import('./parseImageSchedule')
    const result = await freshParse([new Uint8Array([0xff, 0xd8, 0xff])])
    expect(result.supported).toBe(false)
  })
})

describe('clusterWordsIntoGrid — row/column tolerance calibration', () => {
  // Regression test for a real bug: on an actual mishmarot.co.il screenshot,
  // a table cell's "HH:MM-HH:MM" line and its name line beneath it sit
  // ~2x the median word height apart, while two genuinely different table
  // rows sit ~2.6-3x apart. A fixed 20px row tolerance split every cell's
  // own two lines into separate (garbage) rows. Tolerances now scale with
  // the OCR'd word height instead — this locks that calibration in.
  it('merges a stacked time-line and name-line into one row (same cell)', () => {
    const words = [
      { text: '06:30-15:00', confidence: 95, bbox: { x0: 200, y0: 655, x1: 300, y1: 670 } }, // height 15
      { text: 'ניר', confidence: 93, bbox: { x0: 220, y0: 687, x1: 260, y1: 702 } }, // ~32px below — same cell
      { text: 'כהן', confidence: 93, bbox: { x0: 180, y0: 690, x1: 220, y1: 705 } },
    ]
    const { grid } = clusterWordsIntoGrid(words)
    expect(grid.rows).toHaveLength(1)
    expect(grid.rows[0][0].text).toContain('06:30-15:00')
    expect(grid.rows[0][0].text).toContain('ניר')
  })

  it('keeps two genuinely different table rows separate', () => {
    const words = [
      { text: '06:30-15:00', confidence: 95, bbox: { x0: 200, y0: 655, x1: 300, y1: 670 } },
      { text: 'שם', confidence: 93, bbox: { x0: 220, y0: 687, x1: 260, y1: 702 } },
      // next logical row starts ~44px below the first row's time-line — must NOT merge
      { text: '14:30-23:00', confidence: 95, bbox: { x0: 200, y0: 731, x1: 300, y1: 746 } },
      { text: 'אחר', confidence: 93, bbox: { x0: 220, y0: 764, x1: 260, y1: 779 } },
    ]
    const { grid } = clusterWordsIntoGrid(words)
    expect(grid.rows).toHaveLength(2)
    expect(grid.rows[0][0].text).toContain('06:30-15:00')
    expect(grid.rows[1][0].text).toContain('14:30-23:00')
  })

  it('groups words within one ~330px-wide column, keeping adjacent columns separate', () => {
    const words = [
      { text: 'אפרים', confidence: 92, bbox: { x0: 690, y0: 845, x1: 730, y1: 860 } },
      { text: 'מלסה', confidence: 88, bbox: { x0: 625, y0: 844, x1: 665, y1: 859 } }, // 66px away — same cell
      { text: 'רועי', confidence: 93, bbox: { x0: 392, y0: 846, x1: 432, y1: 861 } }, // ~300px away — different column
    ]
    const { grid } = clusterWordsIntoGrid(words)
    expect(grid.rows).toHaveLength(1)
    expect(grid.rows[0]).toHaveLength(2)
  })
})
