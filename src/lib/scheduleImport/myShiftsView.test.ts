import { describe, expect, it } from 'vitest'
import { endsNextDay, myShiftsState, sortMyShifts } from './myShiftsView'
import type { MyShift } from '../scheduleWorkerLinks'

const s = (over: Partial<MyShift>): MyShift => ({
  id: 'x', work_date: '2031-01-05', shift_category: 'morning', worker_kind: 'מאבטח', position: 'AB', slot_index: 0,
  starts_at: '2031-01-05T04:00:00Z', ends_at: '2031-01-05T12:00:00Z', source_name: 'x', actual_name: 'x', is_manually_edited: false, ...over,
})

describe('my shifts view', () => {
  it('tells "not linked" apart from "no shifts this week", also for an empty week', () => {
    expect(myShiftsState({ linked: false, link_kind: null, shifts: [] })).toBe('not_linked')
    expect(myShiftsState({ linked: true, link_kind: 'exact', shifts: [] })).toBe('no_shifts')
    expect(myShiftsState({ linked: true, link_kind: 'explicit', shifts: [s({})] })).toBe('shifts')
    // a replacement can give shifts to an account whose name is not linked
    expect(myShiftsState({ linked: false, link_kind: null, shifts: [s({ is_manually_edited: true })] })).toBe('shifts')
  })

  it('orders by date then start time', () => {
    const out = sortMyShifts([
      s({ id: 'c', work_date: '2031-01-06', starts_at: '2031-01-06T04:00:00Z' }),
      s({ id: 'b', starts_at: '2031-01-05T12:00:00Z' }),
      s({ id: 'a', starts_at: '2031-01-05T04:00:00Z' }),
    ])
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('a night shift stays under its start date and is flagged as ending the next day', () => {
    const night = s({ shift_category: 'night', work_date: '2031-01-10', starts_at: '2031-01-10T20:30:00Z', ends_at: '2031-01-11T05:00:00Z' })
    const israelDate = (iso: string) => new Date(Date.parse(iso) + 2 * 3600_000).toISOString().slice(0, 10)
    expect(night.work_date).toBe('2031-01-10')
    expect(endsNextDay(night, israelDate)).toBe(true)
    expect(endsNextDay(s({}), israelDate)).toBe(false)
  })
})
