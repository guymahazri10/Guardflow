import { useState } from 'react'
import { detectFileKind } from '../lib/scheduleImport/detectFileKind'
import { parseExcelSchedule } from '../lib/scheduleImport/parseExcelSchedule'
import { normalizeSchedule } from '../lib/scheduleImport/normalizeSchedule'
import { matchNames } from '../lib/scheduleImport/matchNames'
import { validateSchedule, type ExistingAssignmentSummary } from '../lib/scheduleImport/validateSchedule'
import type { MatchedAssignment, ValidationWarning } from '../lib/scheduleImport/types'
import {
  computeContentHash,
  createScheduleImport,
  uploadScheduleFile,
  updateScheduleImportStoragePath,
  fetchShiftAssignmentsForWeek,
  callPublishScheduleImport,
} from '../lib/scheduleImports'
import { useProfiles } from '../hooks/useProfiles'
import { useFeatureFlag } from '../hooks/useFeatureFlag'
import { useAuth } from '../contexts/AuthContext'
import { utcIsoToIsraelHHMM } from '../lib/israelTime'

type WizardStep = 'upload' | 'processing' | 'preview' | 'error'

function getReadableError(error: unknown): string {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

// Local-date anchor only — this no longer determines the imported week's
// actual dates (normalizeSchedule now reads the real DD/MM date straight out
// of the file's own header cells, see Important #4). It's only used as a
// same-ish-week starting point for parseHeaderDate's day-of-week fallback and
// for the "existing assignments in this week" lookup before the real week is
// known. Uses local date methods (not UTC) so it anchors to the correct
// Israel calendar week rather than drifting near the UTC day boundary.
function getPreviousSunday(date: Date): Date {
  const result = new Date(date)
  result.setDate(result.getDate() - result.getDay())
  result.setHours(0, 0, 0, 0)
  return result
}

export function ScheduleImportPage() {
  const flag = useFeatureFlag('weekly_schedule_import')
  const { user } = useAuth()

  const [step, setStep] = useState<WizardStep>('upload')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [importId, setImportId] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<MatchedAssignment[]>([])
  const [warnings, setWarnings] = useState<ValidationWarning[]>([])
  const [conflicts, setConflicts] = useState<MatchedAssignment[]>([])
  const [detectedWeekStart, setDetectedWeekStart] = useState<string | null>(null)
  const [stats, setStats] = useState({ imported: 0, skipped: 0, unmatched_names: 0 })

  const profilesQuery = useProfiles()

  if (flag.loading) return null
  if (!flag.enabled) {
    return (
      <div dir="rtl" className="p-4">
        <p>התכונה אינה זמינה כרגע.</p>
      </div>
    )
  }

  async function handleFileSelected(file: File) {
    if (profilesQuery.isLoading) {
      setErrorMessage('טוען רשימת עובדים, נסה שוב בעוד רגע.')
      setStep('error')
      return
    }
    if (profilesQuery.isError) {
      setErrorMessage('טעינת רשימת העובדים נכשלה. נסה לרענן את הדף.')
      setStep('error')
      return
    }

    if (!user) {
      setErrorMessage('יש להתחבר מחדש כדי להעלות קובץ.')
      setStep('error')
      return
    }

    setStep('processing')
    setErrorMessage(null)

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const kind = detectFileKind(bytes)

      if (kind === 'unknown') {
        throw new Error('סוג הקובץ לא זוהה. יש להעלות קובץ Excel (.xls/.xlsx).')
      }
      if (kind === 'pdf') {
        throw new Error('ייבוא מקובצי PDF אינו נתמך בשלב זה. יש להעלות קובץ Excel (.xls/.xlsx).')
      }

      const grid = parseExcelSchedule(bytes, kind)
      // This anchor only feeds the day-of-week fallback and year-disambiguation
      // inside normalizeSchedule/parseHeaderDate — it does NOT determine the
      // imported week. The real week comes from the DD/MM dates the file's own
      // header row carries (Important #4): normalizeSchedule now parses those
      // directly, so the detected week below is derived from its actual output.
      const weekStart = getPreviousSunday(new Date())
      const { assignments: normalized } = normalizeSchedule(grid, weekStart)

      const profiles = (profilesQuery.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name }))
      const matched = matchNames(normalized, profiles)

      // Authoritative week_start: the earliest work_date actually parsed out of
      // the file, not the current-week guess above. Falls back to the guess
      // only if the file yielded no assignments at all (e.g. empty upload).
      const weekStartIso =
        normalized.length > 0
          ? normalized.reduce((min, a) => (a.work_date < min ? a.work_date : min), normalized[0].work_date)
          : weekStart.toISOString().slice(0, 10)
      const existingAssignments = await fetchShiftAssignmentsForWeek(weekStartIso)
      const existingSummaries: ExistingAssignmentSummary[] = existingAssignments.map((a) => ({
        work_date: a.work_date,
        shift_category: a.shift_category,
        position: a.position,
        slot_index: a.slot_index,
        is_manually_edited: a.is_manually_edited,
      }))

      const validated = validateSchedule(matched, existingSummaries)

      const contentHash = await computeContentHash(bytes)
      const scheduleImport = await createScheduleImport({
        week_start: weekStartIso,
        source_kind: 'excel',
        storage_path: '', // placeholder until the upload below completes and this row is updated
        original_filename: file.name,
        content_hash: contentHash,
        created_by: user.id,
      })

      const { storagePath } = await uploadScheduleFile(file, weekStartIso, scheduleImport.id)
      await updateScheduleImportStoragePath(scheduleImport.id, storagePath)

      setImportId(scheduleImport.id)
      setAssignments(validated.assignments)
      setWarnings(validated.warnings)
      setConflicts(validated.conflicts)
      setDetectedWeekStart(weekStartIso)
      setStats(validated.stats)
      setStep('preview')
    } catch (error) {
      setErrorMessage(getReadableError(error))
      setStep('error')
    }
  }

  if (step === 'upload' || step === 'error') {
    return (
      <div dir="rtl" className="p-4">
        <h1 className="text-xl font-bold mb-4">ייבוא סידור שבועי</h1>
        {errorMessage && (
          <div className="bg-red-100 text-red-800 p-3 rounded mb-4" role="alert">
            {errorMessage}
          </div>
        )}
        <input
          type="file"
          accept=".xls,.xlsx"
          disabled={profilesQuery.isLoading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFileSelected(file)
          }}
        />
        {profilesQuery.isLoading && <p className="text-sm text-gray-500 mt-2">טוען רשימת עובדים…</p>}
      </div>
    )
  }

  if (step === 'processing') {
    return (
      <div dir="rtl" className="p-4">
        <p>מעבד את הקובץ…</p>
      </div>
    )
  }

  return (
    <SchedulePreview
      importId={importId!}
      assignments={assignments}
      warnings={warnings}
      conflicts={conflicts}
      detectedWeekStart={detectedWeekStart}
      stats={stats}
      onCancel={() => setStep('upload')}
    />
  )
}

function identityKey(a: { work_date: string; shift_category: string; position: string; slot_index: number }): string {
  return `${a.work_date}|${a.shift_category}|${a.position}|${a.slot_index}`
}

function SchedulePreview({
  importId,
  assignments: initialAssignments,
  warnings,
  conflicts,
  detectedWeekStart,
  stats,
  onCancel,
}: {
  importId: string
  assignments: MatchedAssignment[]
  warnings: ValidationWarning[]
  conflicts: MatchedAssignment[]
  detectedWeekStart: string | null
  stats: { imported: number; skipped: number; unmatched_names: number }
  onCancel: () => void
}) {
  const [assignments, setAssignments] = useState(initialAssignments)
  // Identity keys (work_date|shift_category|position|slot_index — same format
  // publish_schedule_import expects) of conflicting rows the manager has
  // explicitly chosen to overwrite from the file (Important #5).
  const [overrides, setOverrides] = useState<Set<string>>(new Set())
  // Identity keys of fuzzy-match rows the manager has explicitly looked at —
  // either by picking a (possibly different) profile from the select, or by
  // clicking "אישור" to keep the suggested match. Publish is blocked while any
  // fuzzy row hasn't been confirmed this way (Important #6).
  const [confirmedFuzzy, setConfirmedFuzzy] = useState<Set<string>>(new Set())
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  const profilesQuery = useProfiles()

  const conflictKeys = new Set(conflicts.map((c) => identityKey(c)))

  function removeRow(index: number) {
    setAssignments((prev) => prev.filter((_, i) => i !== index))
  }

  function assignExistingProfile(index: number, userId: string, name: string) {
    setAssignments((prev) => {
      const row = prev[index]
      if (row) {
        setConfirmedFuzzy((prevConfirmed) => new Set(prevConfirmed).add(identityKey(row)))
      }
      return prev.map((a, i) =>
        i === index ? { ...a, planned_user_id: userId, source_name: name, match_confidence: 'exact' as const } : a,
      )
    })
  }

  function confirmFuzzyMatch(row: MatchedAssignment) {
    setConfirmedFuzzy((prev) => new Set(prev).add(identityKey(row)))
  }

  function toggleOverride(row: MatchedAssignment) {
    const key = identityKey(row)
    setOverrides((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function editName(index: number, name: string) {
    setAssignments((prev) => prev.map((a, i) => (i === index ? { ...a, source_name: name } : a)))
  }

  const hasUnresolvedFuzzy = assignments.some((a) => a.match_confidence === 'fuzzy' && !confirmedFuzzy.has(identityKey(a)))
  const hasUnresolvedNone = assignments.some((a) => a.match_confidence === 'none')
  const publishBlocked = hasUnresolvedFuzzy || hasUnresolvedNone

  async function handlePublish() {
    if (publishBlocked) return
    setPublishing(true)
    setPublishError(null)
    try {
      const resolutions: Record<string, 'revert_to_file'> = {}
      for (const key of overrides) resolutions[key] = 'revert_to_file'

      await callPublishScheduleImport({
        importId,
        assignments,
        resolutions,
        dryRun: false,
      })
      setPublished(true)
    } catch (error) {
      setPublishError(getReadableError(error))
    } finally {
      setPublishing(false)
    }
  }

  if (published) {
    return (
      <div dir="rtl" className="p-4">
        <p className="text-green-700 font-bold">הסידור פורסם בהצלחה.</p>
      </div>
    )
  }

  return (
    <div dir="rtl" className="p-4">
      <h1 className="text-xl font-bold mb-2">תצוגה מקדימה</h1>
      {detectedWeekStart && <p className="text-sm text-gray-600 mb-1">שבוע מזוהה: החל מ-{detectedWeekStart}</p>}
      <p className="mb-4">
        ייקלטו: {stats.imported} · דולגו: {stats.skipped} · שמות שלא זוהו: {stats.unmatched_names}
      </p>

      {warnings.length > 0 && (
        <ul className="bg-yellow-50 text-yellow-900 p-3 rounded mb-4">
          {warnings.map((w, i) => (
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      )}

      <table className="w-full text-right mb-4">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>משמרת</th>
            <th>תפקיד</th>
            <th>עמדה</th>
            <th>שעות</th>
            <th>שם</th>
            <th>התאמה</th>
            <th>עריכה ידנית</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a, i) => {
            const key = identityKey(a)
            const isConflict = conflictKeys.has(key)
            return (
              <tr key={i}>
                <td>{a.work_date}</td>
                <td>{a.shift_category}</td>
                <td>{a.worker_kind}</td>
                <td>{a.position}</td>
                <td>
                  {utcIsoToIsraelHHMM(a.starts_at)}–{utcIsoToIsraelHHMM(a.ends_at)}
                </td>
                <td>
                  <input
                    value={a.source_name ?? ''}
                    onChange={(e) => editName(i, e.target.value)}
                    className="border rounded px-1"
                  />
                </td>
                <td>
                  {a.match_confidence === 'exact' && '✓'}
                  {a.match_confidence === 'fuzzy' && (
                    <div className="flex items-center gap-1">
                      <select
                        onChange={(e) => assignExistingProfile(i, e.target.value, a.source_name ?? '')}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          אישור התאמה
                        </option>
                        {(profilesQuery.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name}
                          </option>
                        ))}
                      </select>
                      {!confirmedFuzzy.has(key) ? (
                        <button type="button" className="border rounded px-1 text-sm" onClick={() => confirmFuzzyMatch(a)}>
                          אישור
                        </button>
                      ) : (
                        <span className="text-green-700 text-sm">✓ אושר</span>
                      )}
                    </div>
                  )}
                  {a.match_confidence === 'none' && (
                    <select onChange={(e) => assignExistingProfile(i, e.target.value, a.source_name ?? '')} defaultValue="">
                      <option value="" disabled>
                        בחר עובד קיים
                      </option>
                      {(profilesQuery.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  {isConflict && (
                    <label className="flex items-center gap-1 text-xs text-amber-800">
                      <input type="checkbox" checked={overrides.has(key)} onChange={() => toggleOverride(a)} />
                      שיבוץ זה נערך ידנית — האם לדרוס מהקובץ?
                    </label>
                  )}
                </td>
                <td>
                  <button type="button" onClick={() => removeRow(i)}>
                    הסר
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {publishBlocked && (
        <div className="bg-yellow-50 text-yellow-900 p-3 rounded mb-4" role="alert">
          {hasUnresolvedFuzzy && <p>יש לאשר את כל ההתאמות המשוערות (התאמה לא ודאית) לפני פרסום.</p>}
          {hasUnresolvedNone && <p>יש לבחור עובד קיים או להסיר כל שורה עם שם שלא זוהה לפני פרסום.</p>}
        </div>
      )}

      {publishError && (
        <div className="bg-red-100 text-red-800 p-3 rounded mb-4" role="alert">
          {publishError}
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={publishing}>
          ביטול
        </button>
        <button type="button" onClick={handlePublish} disabled={publishing || publishBlocked}>
          {publishing ? 'מפרסם…' : 'פרסם'}
        </button>
      </div>
    </div>
  )
}
