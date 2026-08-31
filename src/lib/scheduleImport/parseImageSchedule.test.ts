import { describe, it, expect } from 'vitest'
import { parseImageSchedule } from './parseImageSchedule'

describe('parseImageSchedule', () => {
  it('reports unsupported in phase 1, for one image', async () => {
    const result = await parseImageSchedule([new Uint8Array([0xff, 0xd8, 0xff])])
    expect(result.supported).toBe(false)
    if (!result.supported) {
      expect(result.reason.length).toBeGreaterThan(0)
    }
  })

  it('reports unsupported for multiple images', async () => {
    const result = await parseImageSchedule([
      new Uint8Array([0xff, 0xd8, 0xff]),
      new Uint8Array([0xff, 0xd8, 0xff]),
    ])
    expect(result.supported).toBe(false)
  })
})
