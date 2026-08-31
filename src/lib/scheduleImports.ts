import { supabase } from './supabase'
import type { MatchedAssignment } from './scheduleImport/types'

export type ScheduleImportRow = {
  id: string
  week_start: string
  source_kind: 'excel' | 'pdf' | 'image'
  storage_path: string
  original_filename: string
  content_hash: string
  status: 'processing' | 'ready_for_review' | 'published' | 'failed' | 'cancelled'
  stats: { imported: number; skipped: number; unmatched_names: number }
  parse_warnings: unknown[]
  created_by: string
  created_at: string
  updated_at: string
}

export type ShiftAssignment = {
  id: string
  work_date: string
  shift_category: 'morning' | 'afternoon' | 'night'
  worker_kind: 'אחמ"ש' | 'מאבטח'
  position: string
  slot_index: number
  starts_at: string
  ends_at: string
  source_name: string | null
  planned_user_id: string | null
  actual_user_id: string | null
  actual_name: string | null
  source: 'excel' | 'pdf' | 'image' | 'manual'
  import_id: string | null
  is_manually_edited: boolean
  published: boolean
}

export type PublishResult = {
  to_insert: unknown[]
  to_update: unknown[]
  to_skip_manual: unknown[]
  conflicts: unknown[]
}

function getErrorMessage(action: string, error: { message?: string }) {
  return `${action}: ${error.message ?? 'Supabase request failed.'}`
}

export async function computeContentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._֐-׿-]/g, '_')
}

export async function uploadScheduleFile(
  file: File,
  weekStart: string,
  importId: string,
): Promise<{ storagePath: string }> {
  const safeName = sanitizeFilename(file.name)
  const storagePath = `${weekStart}/${importId}/${safeName}`

  const { error } = await supabase.storage.from('schedule-imports').upload(storagePath, file, {
    upsert: false,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to upload schedule file', error))
  }

  return { storagePath }
}

export async function createScheduleImport(input: {
  week_start: string
  source_kind: 'excel' | 'pdf' | 'image'
  storage_path: string
  original_filename: string
  content_hash: string
}): Promise<ScheduleImportRow> {
  const { data, error } = await supabase
    .from('schedule_imports')
    .insert(input)
    .select()
    .single()

  if (error) {
    throw new Error(getErrorMessage('Failed to create schedule import record', error))
  }

  return data as ScheduleImportRow
}

export async function updateScheduleImportStoragePath(
  importId: string,
  storagePath: string,
): Promise<void> {
  const { error } = await supabase
    .from('schedule_imports')
    .update({ storage_path: storagePath })
    .eq('id', importId)

  if (error) {
    throw new Error(getErrorMessage('Failed to record schedule import storage path', error))
  }
}

export async function callPublishScheduleImport(input: {
  importId: string
  assignments: MatchedAssignment[]
  resolutions: Record<string, 'revert_to_file'>
  dryRun: boolean
}): Promise<PublishResult> {
  const { data, error } = await supabase.rpc('publish_schedule_import', {
    p_import_id: input.importId,
    p_assignments: input.assignments,
    p_resolutions: input.resolutions,
    p_dry_run: input.dryRun,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to publish schedule import', error))
  }

  return data as PublishResult
}

export async function callReplaceAssignmentWorker(input: {
  assignmentId: string
  newUserId: string | null
  newName: string
  reason: string
}): Promise<ShiftAssignment> {
  const { data, error } = await supabase.rpc('replace_assignment_worker', {
    p_assignment_id: input.assignmentId,
    p_new_user_id: input.newUserId,
    p_new_name: input.newName,
    p_reason: input.reason,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to replace assignment worker', error))
  }

  return data as ShiftAssignment
}

export async function fetchShiftAssignmentsForWeek(weekStart: string): Promise<ShiftAssignment[]> {
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)

  const { data, error } = await supabase
    .from('shift_assignments')
    .select('*')
    .gte('work_date', weekStart)
    .lte('work_date', weekEnd.toISOString().slice(0, 10))

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift assignments', error))
  }

  return (data ?? []) as ShiftAssignment[]
}
