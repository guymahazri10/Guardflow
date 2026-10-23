import { addDaysIso, israelLocalToUtcIso, utcIsoToIsraelHHMM, formatIsraelShortDateLabel } from '../israelTime'
import { SHIFT_CATEGORIES } from '../../constants/shifts'
import { personNameKey } from './matchNames'
import type { ShiftAssignment } from '../scheduleImports'
import type { ShiftChanges } from '../scheduleEdits'

export type WorkerDraft =
  | { kind: 'keep' }
  | { kind: 'account'; userId: string; name: string }
  | { kind: 'free'; name: string }

export type EditDraft = {
  workDate: string
  category: 'morning' | 'afternoon' | 'night'
  position: string
  slotIndex: number
  startTime: string // HH:MM, Israel time
  endTime: string // HH:MM, Israel time
  worker: WorkerDraft
}

export function draftFromAssignment(a: ShiftAssignment): EditDraft {
  return {
    workDate: a.work_date,
    category: a.shift_category,
    position: a.position,
    slotIndex: a.slot_index,
    startTime: utcIsoToIsraelHHMM(a.starts_at),
    endTime: utcIsoToIsraelHHMM(a.ends_at),
    worker: { kind: 'keep' },
  }
}

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

export function validateDraft(draft: EditDraft): string[] {
  const problems: string[] = []
  const times = computeTimes(draft.workDate, draft.startTime, draft.endTime)
  if (!times) problems.push('שעת התחלה או סיום אינה תקינה.')
  else {
    const hours = (Date.parse(times.endsAt) - Date.parse(times.startsAt)) / 3_600_000
    if (hours <= 0) problems.push('שעת הסיום חייבת להיות אחרי שעת ההתחלה.')
    if (hours > 16) problems.push('משמרת ארוכה מ־16 שעות אינה מותרת.')
  }
  if (!draft.position.trim()) problems.push('יש לבחור עמדה.')
  if (draft.worker.kind === 'free' && !draft.worker.name.trim()) problems.push('יש להזין שם עובד.')
  if (draft.worker.kind === 'account' && !draft.worker.userId) problems.push('יש לבחור חשבון.')
  return problems
}

/** Only what actually changed, in the shape edit_shift_assignment expects. */
export function buildChanges(original: ShiftAssignment, draft: EditDraft): ShiftChanges {
  const changes: ShiftChanges = {}
  const times = computeTimes(draft.workDate, draft.startTime, draft.endTime)
  if (times) {
    if (Date.parse(times.startsAt) !== Date.parse(original.starts_at)) changes.starts_at = times.startsAt
    if (Date.parse(times.endsAt) !== Date.parse(original.ends_at)) changes.ends_at = times.endsAt
  }
  if (draft.category !== original.shift_category) changes.shift_category = draft.category
  if (draft.position !== original.position) changes.position = draft.position
  if (draft.slotIndex !== original.slot_index) changes.slot_index = draft.slotIndex
  if (draft.worker.kind === 'account') changes.worker = { user_id: draft.worker.userId, name: draft.worker.name }
  if (draft.worker.kind === 'free') changes.worker = { user_id: null, name: draft.worker.name.trim() }
  return changes
}

export type SummaryLine = { label: string; before: string; after: string }

function hoursText(startsAt: string, endsAt: string, workDate: string): string {
  const endDate = new Date(endsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
  const next = endDate > workDate
  // the hours range is isolated left-to-right so it reads 15:00–23:10 inside RTL text
  return `\u2066${utcIsoToIsraelHHMM(startsAt)}–${utcIsoToIsraelHHMM(endsAt)}\u2069${next ? ` (מסתיימת ב־${formatIsraelShortDateLabel(endDate)})` : ''}`
}

/** Human summary of an edit: date, and what was vs. what will be. */
export function describeEdit(original: ShiftAssignment, draft: EditDraft): SummaryLine[] {
  const lines: SummaryLine[] = []
  const times = computeTimes(draft.workDate, draft.startTime, draft.endTime)
  const before = hoursText(original.starts_at, original.ends_at, original.work_date)
  const after = times ? hoursText(times.startsAt, times.endsAt, draft.workDate) : '—'
  if (before !== after) lines.push({ label: 'שעות', before, after })
  if (draft.category !== original.shift_category)
    lines.push({ label: 'משמרת', before: SHIFT_CATEGORIES[original.shift_category].label, after: SHIFT_CATEGORIES[draft.category].label })
  if (draft.position !== original.position || draft.slotIndex !== original.slot_index)
    lines.push({
      label: 'עמדה',
      before: `${original.position}${original.slot_index > 0 ? ` (${original.slot_index + 1})` : ''}`,
      after: `${draft.position}${draft.slotIndex > 0 ? ` (${draft.slotIndex + 1})` : ''}`,
    })
  if (draft.worker.kind !== 'keep') {
    const was = original.actual_name ?? original.source_name ?? '—'
    const now = draft.worker.name.trim() || '—'
    if (was !== now || draft.worker.kind === 'free' !== (original.actual_user_id === null))
      lines.push({ label: 'עובד', before: was, after: draft.worker.kind === 'free' ? `${now} (שם חופשי, ללא חשבון)` : now })
  }
  return lines
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
