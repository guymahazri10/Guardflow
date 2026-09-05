import { describe, it, expect } from 'vitest'
import { formatIsraelDateLabel, formatIsraelShortDateLabel } from './israelTime'

describe('formatIsraelDateLabel', () => {
  it('formats a YYYY-MM-DD date as a Hebrew weekday + day + month label', () => {
    // 2026-09-03 is a Thursday.
    expect(formatIsraelDateLabel('2026-09-03')).toBe('יום חמישי, 3 בספטמבר')
  })

  // Regression guard: must read the given Y/M/D back exactly, not shift by a
  // day under some local timezone — this is calendar-date formatting, not an
  // instant that needs Israel-local conversion.
  it('does not drift across a month boundary', () => {
    expect(formatIsraelDateLabel('2026-08-31')).toBe('יום שני, 31 באוגוסט')
    expect(formatIsraelDateLabel('2026-09-01')).toBe('יום שלישי, 1 בספטמבר')
  })
})

describe('formatIsraelShortDateLabel', () => {
  it('formats a compact weekday + D/M label for table headers', () => {
    // 2026-09-03 is a Thursday.
    expect(formatIsraelShortDateLabel('2026-09-03')).toBe('ה׳ 3/9')
  })

  it('does not drift across a month boundary', () => {
    expect(formatIsraelShortDateLabel('2026-08-31')).toBe('ב׳ 31/8')
    expect(formatIsraelShortDateLabel('2026-09-01')).toBe('ג׳ 1/9')
  })
})
