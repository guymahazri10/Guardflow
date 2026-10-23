import { supabase } from './supabase'

/** What went wrong with a manager edit, in terms the screen can explain. */
export type ScheduleEditErrorKind =
  | 'concurrent' // someone changed the row after the manager loaded it
  | 'occupied' // the target place already holds a live shift
  | 'reason_required' // a past shift needs a reason
  | 'cancelled' // the row is cancelled (restore it first)
  | 'not_cancelled'
  | 'moved_away' // the cancelled marker was left by a move whose copy is still live
  | 'no_changes'
  | 'denied'
  | 'invalid'
  | 'other'

export class ScheduleEditError extends Error {
  kind: ScheduleEditErrorKind
  constructor(kind: ScheduleEditErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

const MESSAGES: Record<ScheduleEditErrorKind, string> = {
  concurrent: 'השיבוץ שונה בינתיים על ידי משתמש אחר. הנתונים רועננו — יש לבדוק ולנסות שוב.',
  occupied: 'מקום היעד תפוס בשיבוץ אחר. לא בוצע שינוי. אפשר לבטל או להעביר קודם את השיבוץ שנמצא שם.',
  reason_required: 'לתיקון משמרת שכבר עברה יש להזין סיבה.',
  cancelled: 'השיבוץ מבוטל. יש לשחזר אותו לפני עריכה.',
  not_cancelled: 'השיבוץ אינו מבוטל.',
  moved_away: 'השיבוץ הזה הועבר למקום אחר ועדיין פעיל שם. אפשר לבטל או להעביר את העותק החדש.',
  no_changes: 'לא בוצע שינוי.',
  denied: 'רק מנהל רשאי לערוך את הסידור.',
  invalid: 'הנתונים אינם תקינים. יש לבדוק שעות, עמדה ועובד.',
  other: 'הפעולה נכשלה. נסה שוב.',
}

export function mapEditError(error: { message?: string; code?: string }): ScheduleEditError {
  const m = error.message ?? ''
  const code = error.code ?? ''
  const kind: ScheduleEditErrorKind =
    code === '42501' || m.includes('Only מנהל')
      ? 'denied'
      : m.includes('concurrent_change') || code === '40001'
        ? 'concurrent'
        : m.includes('target_occupied') || code === '23505'
          ? 'occupied'
          : m.includes('reason_required')
            ? 'reason_required'
            : m.includes('assignment_cancelled')
              ? 'cancelled'
              : m.includes('assignment_not_cancelled')
                ? 'not_cancelled'
                : m.includes('moved_away')
                  ? 'moved_away'
                  : m.includes('no_changes')
                    ? 'no_changes'
                    : code === '22023'
                      ? 'invalid'
                      : 'other'
  return new ScheduleEditError(kind, MESSAGES[kind])
}

export type WorkerChoice = { userId: string | null; name: string }

export type ShiftChanges = {
  starts_at?: string
  ends_at?: string
  shift_category?: string
  position?: string
  slot_index?: number
  worker?: { user_id: string | null; name: string }
}

export async function editShiftAssignment(input: {
  id: string
  expectedUpdatedAt: string
  changes: ShiftChanges
  reason: string | null
}) {
  const { error } = await supabase.rpc('edit_shift_assignment', {
    p_assignment_id: input.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_changes: input.changes,
    p_reason: input.reason,
  })
  if (error) throw mapEditError(error)
}

export async function addShiftAssignment(input: {
  workDate: string
  shiftCategory: string
  workerKind: string
  position: string
  slotIndex: number
  startsAt: string
  endsAt: string
  worker: WorkerChoice
  reason: string | null
}) {
  const { error } = await supabase.rpc('add_shift_assignment', {
    p_assignment: {
      work_date: input.workDate,
      shift_category: input.shiftCategory,
      worker_kind: input.workerKind,
      position: input.position,
      slot_index: input.slotIndex,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      worker: { user_id: input.worker.userId, name: input.worker.name },
    },
    p_reason: input.reason,
  })
  if (error) throw mapEditError(error)
}

export async function cancelShiftAssignment(input: { id: string; expectedUpdatedAt: string; reason: string | null }) {
  const { error } = await supabase.rpc('cancel_shift_assignment', {
    p_assignment_id: input.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_reason: input.reason,
  })
  if (error) throw mapEditError(error)
}

export async function restoreShiftAssignment(input: { id: string; expectedUpdatedAt: string; reason: string | null }) {
  const { error } = await supabase.rpc('restore_shift_assignment', {
    p_assignment_id: input.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_reason: input.reason,
  })
  if (error) throw mapEditError(error)
}

export type AssignmentHistoryEntry = {
  id: string
  change_kind: string
  changed_by: string
  changed_at: string
  reason: string | null
  from_name: string | null
  to_name: string | null
  details: { before?: Record<string, unknown>; after?: Record<string, unknown>; change_group?: string } | null
}

export async function fetchAssignmentHistory(assignmentId: string): Promise<AssignmentHistoryEntry[]> {
  const { data, error } = await supabase
    .from('staffing_change_log')
    .select('id, change_kind, changed_by, changed_at, reason, from_name, to_name, details')
    .eq('assignment_id', assignmentId)
    .order('changed_at', { ascending: false })
  if (error) throw mapEditError(error)
  return (data ?? []) as AssignmentHistoryEntry[]
}
