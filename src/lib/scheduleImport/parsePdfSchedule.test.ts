import { describe, it, expect, vi } from 'vitest'
import { parsePdfSchedule } from './parsePdfSchedule'

vi.mock('pdfjs-dist', () => {
  return {
    getDocument: (_opts: unknown) => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [
              { str: 'ראשון 06/09', transform: [1, 0, 0, 1, 100, 700] },
              { str: 'אחמ"ש', transform: [1, 0, 0, 1, 10, 650] },
              { str: 'שער ראשי', transform: [1, 0, 0, 1, 10, 600] },
              { str: '06:00-14:00 בדיקה־א׳', transform: [1, 0, 0, 1, 100, 600] },
            ],
          }),
        }),
      }),
    }),
    GlobalWorkerOptions: {},
  }
})

describe('parsePdfSchedule', () => {
  it('extracts a RawGrid from a text-layer pdf', async () => {
    const result = await parsePdfSchedule(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    expect(result.supported).toBe(true)
    if (result.supported) {
      const flatText = result.grid.rows.flat().map((c) => c.text).join(' ')
      expect(flatText).toContain('בדיקה־א׳')
    }
  })

  it('reports unsupported for a scanned pdf with no extractable text', async () => {
    vi.resetModules()
    vi.doMock('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
        }),
      }),
      GlobalWorkerOptions: {},
    }))
    const { parsePdfSchedule: freshParse } = await import('./parsePdfSchedule')
    const result = await freshParse(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    expect(result.supported).toBe(false)
    if (!result.supported) {
      expect(result.reason).toContain('סרוק')
    }
  })
})
