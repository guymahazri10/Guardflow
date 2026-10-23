import { describe, expect, it } from 'vitest'
import { computeTimes, defaultShiftHours, findOverlaps, isPastDate, resolveWorkerAccount } from './editPlan'
import type { ShiftAssignment } from '../scheduleImports'

const base: ShiftAssignment = {
  id: 'a1', work_date: '2032-01-04', shift_category: 'morning', worker_kind: 'מאבטח', position: 'AB', slot_index: 0,
  starts_at: '2032-01-04T04:45:00Z', ends_at: '2032-01-04T13:10:00Z', source_name: 'אורי כהן', planned_user_id: null,
  actual_user_id: null, actual_name: 'אורי כהן', source: 'excel', import_id: 'i', is_manually_edited: false, published: true,
  updated_at: '2032-01-01T00:00:00Z',
}

describe('computeTimes', () => {
  it('a day shift ends the same day', () => {
    const t = computeTimes('2032-01-04', '06:45', '15:10')!
    expect(t.endDate).toBe('2032-01-04')
    expect(t.crossesMidnight).toBe(false)
  })
  it('a night shift ends the next calendar day, and the date is shown', () => {
    const t = computeTimes('2032-01-06', '22:45', '07:10')!
    expect(t.crossesMidnight).toBe(true)
    expect(t.endDate).toBe('2032-01-07')
    expect(Date.parse(t.endsAt)).toBeGreaterThan(Date.parse(t.startsAt))
  })
  it('rejects malformed times', () => {
    expect(computeTimes('2032-01-04', '25:00', '07:00')).toBeNull()
  })
})

describe('defaultShiftHours', () => {
  it('uses the standard Excel hours for guards and for shift commanders', () => {
    expect(defaultShiftHours('morning', 'מאבטח')).toEqual({ start: '06:45', end: '15:10' })
    expect(defaultShiftHours('night', 'מאבטח')).toEqual({ start: '22:45', end: '07:10' })
    expect(defaultShiftHours('afternoon', 'אחמ"ש')).toEqual({ start: '14:30', end: '23:00' })
  })
  it('a night default ends the next calendar day', () => {
    const d = defaultShiftHours('night', 'מאבטח')
    expect(computeTimes('2032-01-06', d.start, d.end)!.crossesMidnight).toBe(true)
  })
})

describe('resolveWorkerAccount', () => {
  const profiles = [
    { id: 'a', full_name: 'אורי כהן' },
    { id: 'd1', full_name: 'תמר גל' },
    { id: 'd2', full_name: 'תמר גל' },
    { id: 'g', full_name: 'גיא' },
  ]
  it('an account picked from the suggestions is used', () => {
    expect(resolveWorkerAccount('תמר גל', 'd2', profiles)).toEqual({ userId: 'd2', name: 'תמר גל' })
  })
  it('an exact, unique full name is the account (not a guess)', () => {
    expect(resolveWorkerAccount('  אורי   כהן ', null, profiles)).toEqual({ userId: 'a', name: 'אורי   כהן' })
  })
  it('a name shared by two accounts is never attributed to either without a pick', () => {
    expect(resolveWorkerAccount('תמר גל', null, profiles).userId).toBeNull()
  })
  it('a similar or partial name is free text with no account', () => {
    expect(resolveWorkerAccount('גיא מהצרי', null, profiles).userId).toBeNull()
    expect(resolveWorkerAccount('אורי כהנא', null, profiles).userId).toBeNull()
    expect(resolveWorkerAccount('שם שלא רשום', null, profiles)).toEqual({ userId: null, name: 'שם שלא רשום' })
  })
  it('an empty name has no account', () => {
    expect(resolveWorkerAccount('   ', null, profiles).userId).toBeNull()
  })
})

describe('findOverlaps', () => {
  const other: ShiftAssignment = { ...base, id: 'a2', position: 'CD', starts_at: '2032-01-04T04:00:00Z', ends_at: '2032-01-04T08:00:00Z' }
  it('warns about an overlapping shift of the same worker (by name when there is no account)', () => {
    const o = findOverlaps([base, other], { id: 'a1', startsAt: base.starts_at, endsAt: base.ends_at, userId: null, name: 'אורי כהן' })
    expect(o.map((x) => x.id)).toEqual(['a2'])
  })
  it('does not warn about a different worker, a cancelled shift, or a touching shift', () => {
    expect(findOverlaps([other], { startsAt: base.starts_at, endsAt: base.ends_at, userId: null, name: 'מישהו אחר' })).toEqual([])
    expect(findOverlaps([{ ...other, published: false }], { startsAt: base.starts_at, endsAt: base.ends_at, userId: null, name: 'אורי כהן' })).toEqual([])
    expect(findOverlaps([{ ...other, starts_at: '2032-01-04T01:00:00Z', ends_at: base.starts_at }], { startsAt: base.starts_at, endsAt: base.ends_at, userId: null, name: 'אורי כהן' })).toEqual([])
  })
})

describe('isPastDate', () => {
  it('a shift before today needs a reason', () => {
    expect(isPastDate('2026-10-01', '2026-10-23')).toBe(true)
    expect(isPastDate('2026-10-23', '2026-10-23')).toBe(false)
  })
})
