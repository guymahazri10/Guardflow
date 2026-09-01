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

// Supabase Storage keys must be ASCII-safe — a Hebrew filename (e.g. iOS's
// default screenshot name "צילום מסך ...") fails upload with "Invalid key"
// even though the previous version of this function deliberately allowed
// the Hebrew Unicode block through. The original filename is preserved
// separately (schedule_imports.original_filename), so the storage key
// itself doesn't need to stay human-readable — strip anything non-ASCII.
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function uploadScheduleFile(
  file: File,
  weekStart: string,
  importId: string,
): Promise<{ storagePath: string }> {
  const safeName = sanitizeFilename(file.name)
  const storagePath = `${weekStart}/${importId}/${safeName}`

  // upsert: true — a duplicate upload (identical week_start + content_hash)
  // resumes the existing schedule_imports row (see createScheduleImport),
  // which reuses the same storage_path/import id, so re-uploading the same
  // bytes to that path must not fail as a conflict.
  const { error } = await supabase.storage.from('schedule-imports').upload(storagePath, file, {
    upsert: true,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to upload schedule file', error))
  }

  return { storagePath }
}

/** Postgres unique_violation error code, used to detect a re-upload of the
 *  identical file (same week_start + content_hash) hitting
 *  schedule_imports_week_start_content_hash_key. */
const POSTGRES_UNIQUE_VIOLATION = '23505'

export async function createScheduleImport(input: {
  week_start: string
  source_kind: 'excel' | 'pdf' | 'image'
  storage_path: string
  original_filename: string
  content_hash: string
  created_by: string
}): Promise<ScheduleImportRow> {
  const { data, error } = await supabase
    .from('schedule_imports')
    .insert(input)
    .select()
    .single()

  if (error) {
    if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
      // Identical file (same week_start + content_hash) already uploaded —
      // resume the existing import row instead of surfacing a raw Postgres
      // constraint error, so the manager can still see/re-publish its preview.
      const existing = await supabase
        .from('schedule_imports')
        .select()
        .eq('week_start', input.week_start)
        .eq('content_hash', input.content_hash)
        .maybeSingle()

      if (existing.data) {
        return existing.data as ScheduleImportRow
      }

      throw new Error('קובץ זה כבר הועלה עבור שבוע זה.')
    }
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

  // Pad the start by one calendar day: a night shift's work_date is the date
  // it *started* (normalizeSchedule.ts), so the assignment still active in
  // the early hours of weekStart's own calendar day (00:00-07:00 Israel
  // time) is filed under the day *before* weekStart — one day outside the
  // nominal week. ShiftLivePage's active-assignment lookup needs that row
  // available when weekStart is "today" and it's currently just after
  // midnight during an ongoing night shift that began the day before.
  const paddedStart = new Date(weekStart)
  paddedStart.setUTCDate(paddedStart.getUTCDate() - 1)

  const { data, error } = await supabase
    .from('shift_assignments')
    .select('*')
    .gte('work_date', paddedStart.toISOString().slice(0, 10))
    .lte('work_date', weekEnd.toISOString().slice(0, 10))

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift assignments', error))
  }

  return (data ?? []) as ShiftAssignment[]
}
