import { describe, it, expect, vi } from 'vitest'
import { parseImageSchedule } from './parseImageSchedule'

const invokeMock = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}))

describe('parseImageSchedule', () => {
  it('extracts a RawGrid from a clean screenshot image via the edge function', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        supported: true,
        grid: {
          rows: [
            [{ text: 'משמרות', entries: ['משמרות'] }, { text: '06/09', entries: ['06/09'] }],
            [{ text: 'אחמ"ש', entries: [] }, { text: '', entries: [] }],
            [
              { text: 'שער', entries: ['שער'] },
              { text: '06:00-14:00 בדיקה־א׳', entries: ['06:00-14:00 בדיקה־א׳'] },
            ],
          ],
        },
        warnings: [],
      },
      error: null,
    })

    const result = await parseImageSchedule([new Uint8Array([0xff, 0xd8, 0xff])], undefined, ['image/png'])
    expect(result.supported).toBe(true)
    if (result.supported) {
      const flatText = result.grid.rows.flat().map((c) => c.text).join(' ')
      expect(flatText).toContain('בדיקה־א׳')
      expect(flatText).toContain('אחמ"ש')
    }

    expect(invokeMock).toHaveBeenCalledWith(
      'parse-schedule-image',
      expect.objectContaining({ body: expect.objectContaining({ mimeType: 'image/png' }) }),
    )
  })

  it('flags a low-confidence cell as a warning without dropping it', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        supported: true,
        grid: {
          rows: [
            [{ text: 'משמרות', entries: [] }, { text: '06/09', entries: [] }],
            [
              { text: 'שער', entries: ['שער'] },
              { text: '06:00-14:00 בדיקה־ב׳', entries: ['06:00-14:00 בדיקה־ב׳'] },
            ],
          ],
        },
        warnings: [{ kind: 'low_confidence_ocr', message: 'ביטחון קריאה נמוך בשורה 2, עמודה 2' }],
      },
      error: null,
    })

    const result = await parseImageSchedule([new Uint8Array([0xff, 0xd8, 0xff])])
    expect(result.supported).toBe(true)
    if (result.supported) {
      expect(result.warnings?.some((w) => w.kind === 'low_confidence_ocr')).toBe(true)
      const flatText = result.grid.rows.flat().map((c) => c.text).join(' ')
      expect(flatText).toContain('בדיקה־ב׳')
    }
  })

  it('concatenates multiple images into one merged grid, keeping only the first header', async () => {
    invokeMock
      .mockResolvedValueOnce({
        data: {
          supported: true,
          grid: {
            rows: [
              [{ text: 'משמרות', entries: [] }, { text: '06/09', entries: [] }],
              [
                { text: 'שער א', entries: ['שער א'] },
                { text: '06:00-14:00 בדיקה־א׳', entries: ['06:00-14:00 בדיקה־א׳'] },
              ],
            ],
          },
          warnings: [],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          supported: true,
          grid: {
            rows: [
              [{ text: 'משמרות', entries: [] }, { text: '06/09', entries: [] }],
              [
                { text: 'שער ב', entries: ['שער ב'] },
                { text: '07:00-15:00 בדיקה־ג׳', entries: ['07:00-15:00 בדיקה־ג׳'] },
              ],
            ],
          },
          warnings: [],
        },
        error: null,
      })

    const result = await parseImageSchedule([
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
      expect(result.grid.rows).toHaveLength(3)
    }
  })

  it('reports unsupported when no images are provided', async () => {
    const result = await parseImageSchedule([])
    expect(result.supported).toBe(false)
  })

  it('reports unsupported when the edge function says the image is unreadable', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { supported: false, reason: 'לא זוהה טקסט קריא בתמונה.' },
      error: null,
    })

    const result = await parseImageSchedule([new Uint8Array([0xff, 0xd8, 0xff])])
    expect(result.supported).toBe(false)
  })

  it('reports unsupported with the server error message when the function call fails', async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: new Error('Not authorized'),
    })

    const result = await parseImageSchedule([new Uint8Array([0xff, 0xd8, 0xff])])
    expect(result.supported).toBe(false)
    if (!result.supported) {
      expect(result.reason).toContain('Not authorized')
    }
  })
})
