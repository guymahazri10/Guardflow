import type { MyShift, MyShiftsResult } from '../scheduleWorkerLinks'

/** Which message the "My shifts" tab shows. An account that cannot be matched
 *  to a name is told so even in a week where it has no shifts; a matched
 *  account with an empty week is told it simply has none. */
export type MyShiftsState = 'shifts' | 'no_shifts' | 'not_linked'

export function myShiftsState(result: MyShiftsResult): MyShiftsState {
  if (result.shifts.length > 0) return 'shifts'
  return result.linked ? 'no_shifts' : 'not_linked'
}

/** Ordered by date, then start time, then post. A night shift sits under the
 *  date it starts (work_date). */
export function sortMyShifts(shifts: MyShift[]): MyShift[] {
  return [...shifts].sort(
    (a, b) =>
      a.work_date.localeCompare(b.work_date) ||
      Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
      a.position.localeCompare(b.position, 'he') ||
      a.slot_index - b.slot_index,
  )
}

/** True when the shift ends on a later calendar day than it starts (Israel time). */
export function endsNextDay(shift: Pick<MyShift, 'work_date' | 'ends_at'>, israelDateOf: (iso: string) => string): boolean {
  return israelDateOf(shift.ends_at) > shift.work_date
}
