import { supabase } from './supabase'
import type { MatchedAssignment } from './scheduleImport/types'

export type ScheduleImportRow = {
  id: string
  week_start: string
  source_kind: 'excel' | 'pdf' | 'image' | 'json'
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
  source: 'excel' | 'pdf' | 'image' | 'json' | 'manual'
  import_id: string | null
  is_manually_edited: boolean
  published: boolean
}

/** One row as returned by publish_schedule_import's diff — same shape in
 *  every category, whether or not a matching database row exists yet. */
export type PublishDiffRow = {
  id: string | null
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
}

export type PublishResult = {
  to_insert: PublishDiffRow[]
  to_update: PublishDiffRow[]
  unchanged: PublishDiffRow[]
  to_keep_manual: PublishDiffRow[]
  to_delete: PublishDiffRow[]
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

export const UPLOAD_TIMEOUT_MS = 45_000

/** Rejects with `message` if `promise` has not settled in `ms`. A storage
 *  request that stalls (observed after a denied upsert) must end the import
 *  with a visible error instead of leaving the wizard on "processing". */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
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
  const { error } = await withTimeout(
    supabase.storage.from('schedule-imports').upload(storagePath, file, { upsert: true }),
    UPLOAD_TIMEOUT_MS,
    'העלאת הקובץ לא הסתיימה בזמן סביר. לא בוצע שינוי בסידור — ניתן לנסות שוב.',
  )

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
  source_kind: 'excel' | 'pdf' | 'image' | 'json'
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

// Which current statuses each transition may start from. 'published' is never
// listed: an import that was published is never moved back by the client (an
// identical re-upload resumes the same row and must leave it published).
const STATUS_TRANSITIONS: Record<'ready_for_review' | 'failed' | 'cancelled', ScheduleImportRow['status'][]> = {
  ready_for_review: ['processing', 'ready_for_review', 'failed', 'cancelled'],
  failed: ['processing'],
  cancelled: ['processing', 'ready_for_review', 'failed'],
}

/**
 * Keeps an import row's status truthful while it is not published. The publish
 * RPC sets 'published' itself, and its dry-run is deliberately write-free
 * (phase20k), so without this a row whose preview finished — or failed, or was
 * cancelled — stayed 'processing' forever. Conditional on the current status,
 * so it can never downgrade a published import.
 */
export async function setScheduleImportStatus(
  importId: string,
  status: 'ready_for_review' | 'failed' | 'cancelled',
): Promise<void> {
  const { error } = await supabase
    .from('schedule_imports')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', importId)
    .in('status', STATUS_TRANSITIONS[status])

  if (error) {
    throw new Error(getErrorMessage('Failed to update schedule import status', error))
  }
}

/**
 * Stores the uploaded source file(s) for an import row and records the path.
 *
 * An identical re-upload (same week + content hash) resumes the existing row,
 * which already has its file stored from the first time — the bytes are by
 * definition the same, so nothing is uploaded again. That keeps a repeat
 * upload from depending on overwriting an existing storage object, which
 * needs the UPDATE policy of phase20h and which stalled when that policy
 * was missing. Only a row with no stored path yet (a new import, or one whose
 * first upload never finished) uploads.
 */
export async function storeImportFiles(
  importRow: Pick<ScheduleImportRow, 'id' | 'storage_path'>,
  files: File[],
  weekStart: string,
): Promise<{ storagePath: string; uploaded: boolean }> {
  if (importRow.storage_path) return { storagePath: importRow.storage_path, uploaded: false }

  let firstStoragePath: string | null = null
  for (const file of files) {
    const { storagePath } = await uploadScheduleFile(file, weekStart, importRow.id)
    if (firstStoragePath === null) firstStoragePath = storagePath
  }
  if (!firstStoragePath) throw new Error('לא נבחר קובץ להעלאה.')
  await updateScheduleImportStoragePath(importRow.id, firstStoragePath)
  return { storagePath: firstStoragePath, uploaded: true }
}

/** PostgREST reports an RPC called with parameters the database function
 *  doesn't have (PGRST202, or "Could not find the function ... in the schema
 *  cache") — i.e. this build is ahead of the applied migrations. */
function isMissingRpcSignature(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')
}

export const SCHEMA_OUT_OF_DATE_MESSAGE =
  'מסד הנתונים עדיין לא עודכן לגרסה הנדרשת לפרסום הסידור (חסרות המיגרציות phase20j ו-phase20k). לא בוצע שום שינוי. יש לפנות למנהל המערכת לפני ניסיון נוסף.'

export async function callPublishScheduleImport(input: {
  importId: string
  assignments: MatchedAssignment[]
  resolutions: Record<string, 'revert_to_file'>
  /** Ids from a prior dry-run's `to_delete` that the manager explicitly
   *  confirmed in the UI. A real publish (dryRun: false) is rejected by the
   *  RPC if it would delete a row not in this list — see phase20k. */
  confirmedDeleteIds: string[]
  dryRun: boolean
}): Promise<PublishResult> {
  const { data, error } = await supabase.rpc('publish_schedule_import', {
    p_import_id: input.importId,
    p_assignments: input.assignments,
    p_resolutions: input.resolutions,
    p_confirmed_delete_ids: input.confirmedDeleteIds,
    p_dry_run: input.dryRun,
  })

  if (error) {
    if (isMissingRpcSignature(error)) {
      throw new Error(SCHEMA_OUT_OF_DATE_MESSAGE)
    }
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
