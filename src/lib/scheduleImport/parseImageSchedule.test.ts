import { describe, it, expect, vi } from 'vitest'
import { parseImageSchedule } from './parseImageSchedule'

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
