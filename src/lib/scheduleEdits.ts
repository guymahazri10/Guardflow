import { supabase } from './supabase'

export { ScheduleEditError, mapEditError, type ScheduleEditErrorKind } from './scheduleEditErrors'
import { mapEditError } from './scheduleEditErrors'

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

/** The only thing a non-manager screen learns about a cancelled shift. */
export type CancelledSlot = {
  work_date: string
  shift_category: 'morning' | 'afternoon' | 'night'
  position: string
  slot_index: number
}

export async function fetchCancelledSlots(weekStart: string): Promise<CancelledSlot[]> {
  const { data, error } = await supabase.rpc('get_cancelled_slots', { p_week_start: weekStart })
  if (error) throw mapEditError(error)
  return (data ?? []) as CancelledSlot[]
}
