import { addDaysIso, israelLocalToUtcIso, utcIsoToIsraelHHMM, formatIsraelShortDateLabel } from '../israelTime'
import { personNameKey } from './matchNames'
import type { ShiftAssignment } from '../scheduleImports'

function parseHm(value: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h <= 23 && min <= 59 ? [h, min] : null
}

/** Start and end instants for wall-clock times on a work date. The shift
 *  belongs to the date it starts; an end time at or before the start time
 *  means it ends the next calendar day (a night shift). */
export function computeTimes(
  workDate: string,
  startTime: string,
  endTime: string,
): { startsAt: string; endsAt: string; endDate: string; crossesMidnight: boolean } | null {
  const s = parseHm(startTime)
  const e = parseHm(endTime)
  if (!s || !e) return null
  const [y, mo, d] = workDate.split('-').map(Number)
  const crosses = e[0] * 60 + e[1] <= s[0] * 60 + s[1]
  const endDate = crosses ? addDaysIso(workDate, 1) : workDate
  const [ey, emo, ed] = endDate.split('-').map(Number)
  return {
    startsAt: israelLocalToUtcIso(y, mo, d, s[0], s[1]),
    endsAt: israelLocalToUtcIso(ey, emo, ed, e[0], e[1]),
    endDate,
    crossesMidnight: crosses,
  }
}

export type OverlapInfo = { id: string; dateLabel: string; position: string; hours: string; name: string }

function workerKey(a: Pick<ShiftAssignment, 'actual_user_id' | 'actual_name' | 'source_name'>): string {
  return a.actual_user_id ?? `name:${personNameKey(a.actual_name ?? a.source_name)}`
}

/** Other live shifts of the SAME worker (same account, or same name when
 *  there is no account) whose time overlaps the proposed one. A warning for
 *  the manager to confirm, never a block. */
export function findOverlaps(
  others: ShiftAssignment[],
  proposed: { id?: string; startsAt: string; endsAt: string; userId: string | null; name: string },
): OverlapInfo[] {
  const key = proposed.userId ?? `name:${personNameKey(proposed.name)}`
  if (key === 'name:') return []
  const s = Date.parse(proposed.startsAt)
  const e = Date.parse(proposed.endsAt)
  return others
    .filter((a) => a.published && a.id !== proposed.id && workerKey(a) === key)
    .filter((a) => Math.min(e, Date.parse(a.ends_at)) > Math.max(s, Date.parse(a.starts_at)))
    .map((a) => ({
      id: a.id,
      dateLabel: formatIsraelShortDateLabel(a.work_date),
      position: a.position,
      hours: `${utcIsoToIsraelHHMM(a.starts_at)}–${utcIsoToIsraelHHMM(a.ends_at)}`,
      name: a.actual_name ?? a.source_name ?? '',
    }))
}

export function isPastDate(workDate: string, todayIso: string): boolean {
  return workDate < todayIso
}

/** Standard hours of a shift when a name is put into an empty slot that has no earlier shift to copy
 *  them from: guards 06:45–15:10 / 14:45–23:10 / 22:45–07:10, shift commanders
 *  06:30–15:00 / 14:30–23:00 / 22:30–07:00 (the hours the weekly Excel uses). */
export function defaultShiftHours(category: 'morning' | 'afternoon' | 'night', workerKind: 'אחמ"ש' | 'מאבטח'): { start: string; end: string } {
  const guard = { morning: ['06:45', '15:10'], afternoon: ['14:45', '23:10'], night: ['22:45', '07:10'] } as const
  const commander = { morning: ['06:30', '15:00'], afternoon: ['14:30', '23:00'], night: ['22:30', '07:00'] } as const
  const [start, end] = (workerKind === 'אחמ"ש' ? commander : guard)[category]
  return { start, end }
}

/** The account a typed name refers to: the one picked from the suggestions, otherwise the single
 *  account whose full name is exactly this name. Anything else is a free-text name with no account —
 *  never a guess from a similar name. */
export function resolveWorkerAccount(
  text: string,
  pickedId: string | null,
  profiles: { id: string; full_name: string | null }[],
): { userId: string | null; name: string } {
  const name = text.trim()
  if (pickedId && profiles.some((p) => p.id === pickedId)) return { userId: pickedId, name }
  const key = personNameKey(name)
  if (!key) return { userId: null, name }
  const exact = profiles.filter((p) => personNameKey(p.full_name) === key)
  return { userId: exact.length === 1 ? exact[0].id : null, name }
}
