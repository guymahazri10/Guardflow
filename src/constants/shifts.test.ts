import { describe, expect, it } from 'vitest'
import { buildShiftConfig, getGuardCountLabel, getShiftHoursLabel, getShiftOptionLabel } from './shifts'

describe('shift option labels', () => {
  it('says the guard count the way it is spoken', () => {
    expect(getGuardCountLabel(1)).toBe('מאבטח אחד')
    expect(getGuardCountLabel(2)).toBe('שני מאבטחים')
    expect(getGuardCountLabel(6)).toBe('6 מאבטחים')
  })

  it('builds the option from the variants that exist (shift_types), not from a list in code', () => {
    const night1 = buildShiftConfig({ id: 'night_1', category: 'night', guard_count: 1 })
    const night2 = buildShiftConfig({ id: 'night_2', category: 'night', guard_count: 2 })
    expect(getShiftOptionLabel(night1)).toBe('מאבטח אחד')
    expect(getShiftOptionLabel(night2)).toBe('שני מאבטחים')
    expect(getShiftHoursLabel(night2)).toBe('23:00–07:00')
    // the existing label used by other screens is unchanged
    expect(night2.label).toBe('לילה 2 מאבטחים')
  })

  it('falls back to the existing short label when the guard count is unknown', () => {
    expect(getShiftOptionLabel({ id: 'x', label: 'בוקר 5 מאבטחים', category: 'morning', startHour: 7, endHour: 15 })).toBe('5 מאבטחים')
  })
})
