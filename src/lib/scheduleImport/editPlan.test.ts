import { describe, expect, it } from 'vitest'
import { buildChanges, computeTimes, describeEdit, draftFromAssignment, findOverlaps, isPastDate, validateDraft } from './editPlan'
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

describe('validateDraft / buildChanges', () => {
  it('a draft equal to the original has no changes', () => {
    expect(buildChanges(base, draftFromAssignment(base))).toEqual({})
  })
  it('sends only the hours that changed', () => {
    const d = { ...draftFromAssignment(base), startTime: '07:00' }
    const c = buildChanges(base, d)
    expect(Object.keys(c)).toEqual(['starts_at'])
  })
  it('keeps account and free-text workers separate, with no name matching', () => {
    const acc = buildChanges(base, { ...draftFromAssignment(base), worker: { kind: 'account', userId: 'u1', name: 'דנה' } })
    expect(acc.worker).toEqual({ user_id: 'u1', name: 'דנה' })
    const free = buildChanges(base, { ...draftFromAssignment(base), worker: { kind: 'free', name: ' מחליף ' } })
    expect(free.worker).toEqual({ user_id: null, name: 'מחליף' })
  })
  it('flags a missing free-text name and an over-long shift', () => {
    expect(validateDraft({ ...draftFromAssignment(base), worker: { kind: 'free', name: ' ' } })).toHaveLength(1)
    expect(validateDraft({ ...draftFromAssignment(base), startTime: '06:00', endTime: '23:30' })[0]).toMatch(/16/)
  })
})

describe('describeEdit', () => {
  it('shows what it was and what it will be, including the end date of a night shift', () => {
    const night: ShiftAssignment = { ...base, shift_category: 'night', work_date: '2032-01-06', starts_at: '2032-01-06T20:45:00Z', ends_at: '2032-01-07T05:10:00Z' }
    const lines = describeEdit(night, { ...draftFromAssignment(night), startTime: '23:00', endTime: '07:30' })
    const hours = lines.find((l) => l.label === 'שעות')!
    expect(hours.before).toContain('22:45')
    expect(hours.after).toContain('23:00')
    expect(hours.after).toContain('מסתיימת ב')
  })
  it('lists worker, post and shift changes', () => {
    const lines = describeEdit(base, { ...draftFromAssignment(base), category: 'afternoon', position: 'CD', worker: { kind: 'free', name: 'מחליף' } })
    expect(lines.map((l) => l.label).sort()).toEqual(['משמרת', 'עובד', 'עמדה'].sort())
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
