import { describe, expect, it } from 'vitest'
import { getShiftProgress } from './shiftProgress'

const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute)

describe('getShiftProgress', () => {
  it('is 0 at the start of the shift and grows through it', () => {
    expect(getShiftProgress('morning', at(7))).toBe(0)
    expect(getShiftProgress('morning', at(11))).toBe(0.5)
  })

  it('matches the afternoon shift at 20:02', () => {
    expect(getShiftProgress('afternoon', at(20, 2))).toBeCloseTo(302 / 480, 5)
  })

  it('handles the night shift across midnight', () => {
    expect(getShiftProgress('night', at(23))).toBe(0)
    expect(getShiftProgress('night', at(3))).toBe(0.5)
    expect(getShiftProgress('night', at(6, 59))).toBeCloseTo(479 / 480, 5)
  })

  it('clamps outside the shift hours', () => {
    expect(getShiftProgress('afternoon', at(10))).toBe(0)
    expect(getShiftProgress('afternoon', at(23, 30))).toBe(1)
  })
})
