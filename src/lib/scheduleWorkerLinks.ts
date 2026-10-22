import { supabase } from './supabase'

export type ScheduleWorkerLink = {
  source_key: string
  /** null = the manager decided this name must not be attributed to anyone */
  user_id: string | null
  is_ambiguous: boolean
}

export type MyShift = {
  id: string
  work_date: string
  shift_category: 'morning' | 'afternoon' | 'night'
  worker_kind: 'אחמ"ש' | 'מאבטח'
  position: string
  slot_index: number
  starts_at: string
  ends_at: string
  source_name: string | null
  actual_name: string | null
  is_manually_edited: boolean
}

export type MyShiftsResult = {
  /** whether the signed-in account could be matched to a schedule name at all */
  linked: boolean
  link_kind: 'explicit' | 'exact' | null
  /** Why a name that looks like the user's is not attributed to them. */
  blocked_reason: 'shared_name' | 'duplicate_accounts' | 'overlap_review' | null
  /** Rows of the user's name held back this week because their times overlap. */
  held_back: number
  shifts: MyShift[]
}

function failure(action: string, error: { message?: string }) {
  return new Error(`${action}: ${error.message ?? 'Supabase request failed.'}`)
}

export async function fetchMyShifts(weekStart: string): Promise<MyShiftsResult> {
  const { data, error } = await supabase.rpc('get_my_shifts', { p_week_start: weekStart })
  if (error) throw failure('Failed to load my shifts', error)
  return data as MyShiftsResult
}

export async function fetchScheduleWorkerLinks(): Promise<ScheduleWorkerLink[]> {
  const { data, error } = await supabase
    .from('schedule_worker_links')
    .select('source_key, user_id, is_ambiguous')
  if (error) throw failure('Failed to load schedule links', error)
  return (data ?? []) as ScheduleWorkerLink[]
}

/** userId null = "do not attribute this name to any account". */
export async function linkScheduleWorker(sourceName: string, userId: string | null): Promise<void> {
  const { error } = await supabase.rpc('link_schedule_worker', { p_source_name: sourceName, p_user_id: userId })
  if (error) throw failure('Failed to link schedule worker', error)
}

export async function unlinkScheduleWorker(sourceName: string): Promise<void> {
  const { error } = await supabase.rpc('unlink_schedule_worker', { p_source_name: sourceName })
  if (error) throw failure('Failed to unlink schedule worker', error)
}

export type SchedulePerson = {
  id: string
  work_date: string
  starts_at: string
  ends_at: string
  source_name: string | null
  is_manually_edited: boolean
  published: boolean
}

/** Every published row, for the manager's link screen (RLS lets a manager read all). */
export async function fetchPublishedSchedulePeople(): Promise<SchedulePerson[]> {
  const { data, error } = await supabase
    .from('shift_assignments')
    .select('id, work_date, starts_at, ends_at, source_name, is_manually_edited, published')
    .eq('published', true)
    .limit(5000)
  if (error) throw failure('Failed to load schedule names', error)
  return (data ?? []) as SchedulePerson[]
}
