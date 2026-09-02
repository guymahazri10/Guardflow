import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseImageSchedule } from './parseImageSchedule'
import { CANONICAL_POSITIONS } from './positions'

const invokeMock = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}))

const IMAGE = new Uint8Array([0xff, 0xd8, 0xff])

function record(overrides: Partial<Record<string, string>> = {}) {
  return {
    date: '2026-08-30',
    worker_kind: 'אחמ"ש',
    position: 'אחמ"ש בוקר',
    start: '06:30',
    end: '15:00',
    name: 'ניר כהן',
    ...overrides,
  }
}

beforeEach(() => {
  invokeMock.mockReset()
})

describe('parseImageSchedule', () => {
  it('returns the extracted assignment records from the edge function', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { supported: true, assignments: [record()], warnings: [] },
      error: null,
    })

    const result = await parseImageSchedule([IMAGE], undefined, ['image/png'])
    expect(result.supported).toBe(true)
    if (result.supported) {
      expect(result.assignments).toHaveLength(1)
      expect(result.assignments[0].name).toBe('ניר כהן')
    }
  })

  // The canonical position list has exactly one definition (positions.ts) and
  // travels with the request, rather than being duplicated into the edge
  // function, which cannot import from src/. If this stops being sent the
  // model is no longer constrained to known positions.
  it('sends the canonical position list and the image mime type', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { supported: true, assignments: [record()], warnings: [] },
      error: null,
    })

    await parseImageSchedule([IMAGE], undefined, ['image/jpeg'])

    expect(invokeMock).toHaveBeenCalledWith(
      'parse-schedule-image',
      expect.objectContaining({
        body: expect.objectContaining({
          mimeType: 'image/jpeg',
          positions: CANONICAL_POSITIONS,
        }),
      }),
    )
  })

  it('surfaces model warnings (e.g. a cropped screenshot) rather than dropping them', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        supported: true,
        assignments: [record()],
        warnings: ['השורה התחתונה חתוכה בתמונה'],
      },
      error: null,
    })

    const result = await parseImageSchedule([IMAGE])
    expect(result.supported).toBe(true)
    if (result.supported) {
      expect(result.warnings.map((w) => w.message)).toContain('השורה התחתונה חתוכה בתמונה')
    }
  })

  it('concatenates records across multiple images of the same week', async () => {
    invokeMock
      .mockResolvedValueOnce({
        data: { supported: true, assignments: [record({ name: 'ראשון' })], warnings: [] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          supported: true,
          assignments: [record({ name: 'שני', position: 'אחמ"ש צהריים', start: '14:30', end: '23:00' })],
          warnings: [],
        },
        error: null,
      })

    const result = await parseImageSchedule([IMAGE, IMAGE])
    expect(result.supported).toBe(true)
    if (result.supported) {
      expect(result.assignments.map((a) => a.name)).toEqual(['ראשון', 'שני'])
    }
  })

  it('reports unsupported when no images are provided', async () => {
    const result = await parseImageSchedule([])
    expect(result.supported).toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('reports unsupported when the function says the image is unreadable', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { supported: false, reason: 'לא זוהו שיבוצים בתמונה.' },
      error: null,
    })

    const result = await parseImageSchedule([IMAGE])
    expect(result.supported).toBe(false)
    if (!result.supported) expect(result.reason).toBe('לא זוהו שיבוצים בתמונה.')
  })

  it('reports unsupported, not an empty success, when the function returns no records', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { supported: true, assignments: [], warnings: [] },
      error: null,
    })

    const result = await parseImageSchedule([IMAGE])
    expect(result.supported).toBe(false)
  })

  it('surfaces the server error message when the function call fails', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: new Error('Not authorized') })

    const result = await parseImageSchedule([IMAGE])
    expect(result.supported).toBe(false)
    if (!result.supported) expect(result.reason).toContain('Not authorized')
  })
})
