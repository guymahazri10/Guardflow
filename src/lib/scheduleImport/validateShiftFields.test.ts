import { describe, it, expect } from 'vitest'
import { hasPositiveDuration, isValidCalendarDate, isValidHourRange } from './validateShiftFields'

describe('isValidHourRange', () => {
  it('accepts every valid hour/minute combination', () => {
    expect(isValidHourRange(0, 0)).toBe(true)
    expect(isValidHourRange(23, 59)).toBe(true)
    expect(isValidHourRange(9, 30)).toBe(true)
  })

  it('rejects an hour or minute outside 0-23/0-59', () => {
    expect(isValidHourRange(24, 0)).toBe(false)
    expect(isValidHourRange(-1, 0)).toBe(false)
    expect(isValidHourRange(9, 60)).toBe(false)
    expect(isValidHourRange(9, -1)).toBe(false)
  })

  it('rejects a non-integer', () => {
    expect(isValidHourRange(9.5, 0)).toBe(false)
  })
})

describe('isValidCalendarDate', () => {
  it('accepts a real date, including Feb 29 on a leap year', () => {
    expect(isValidCalendarDate(2026, 9, 6)).toBe(true)
    expect(isValidCalendarDate(2024, 2, 29)).toBe(true)
  })

  it('rejects a day that does not exist for the given month', () => {
    expect(isValidCalendarDate(2026, 2, 31)).toBe(false)
    expect(isValidCalendarDate(2026, 2, 29)).toBe(false) // 2026 is not a leap year
    expect(isValidCalendarDate(2026, 4, 31)).toBe(false)
  })

  it('rejects a month outside 1-12', () => {
    expect(isValidCalendarDate(2026, 13, 1)).toBe(false)
    expect(isValidCalendarDate(2026, 0, 1)).toBe(false)
  })
})

describe('hasPositiveDuration', () => {
  it('accepts an end instant after the start', () => {
    expect(hasPositiveDuration('2026-09-06T03:00:00.000Z', '2026-09-06T11:00:00.000Z')).toBe(true)
  })

  it('rejects an equal or inverted range', () => {
    expect(hasPositiveDuration('2026-09-06T03:00:00.000Z', '2026-09-06T03:00:00.000Z')).toBe(false)
    expect(hasPositiveDuration('2026-09-06T11:00:00.000Z', '2026-09-06T03:00:00.000Z')).toBe(false)
  })
})
