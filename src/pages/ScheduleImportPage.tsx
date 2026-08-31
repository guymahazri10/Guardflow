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

type WizardStep = 'upload' | 'processing' | 'preview' | 'error'

function getReadableError(error: unknown): string {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

function getPreviousSunday(date: Date): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() - result.getUTCDay())
  result.setUTCHours(0, 0, 0, 0)
  return result
}

export function ScheduleImportPage() {
  const [step, setStep] = useState<WizardStep>('upload')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [importId, setImportId] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<MatchedAssignment[]>([])
  const [warnings, setWarnings] = useState<ValidationWarning[]>([])
  const [stats, setStats] = useState({ imported: 0, skipped: 0, unmatched_names: 0 })

  const profilesQuery = useProfiles()

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

    setStep('processing')
    setErrorMessage(null)

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const kind = detectFileKind(bytes)

      if (kind === 'unknown') {
        throw new Error('סוג הקובץ לא זוהה. יש להעלות קובץ Excel (.xls/.xlsx) או PDF.')
      }
      if (kind === 'pdf') {
        throw new Error('קבצי PDF מעובדים בשלב נפרד. תמיכה זו תתווסף בהמשך המשימה.')
      }

      const grid = parseExcelSchedule(bytes, kind)
      const weekStart = getPreviousSunday(new Date())
      const { assignments: normalized } = normalizeSchedule(grid, weekStart)

      const profiles = (profilesQuery.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name }))
      const matched = matchNames(normalized, profiles)

      const weekStartIso = weekStart.toISOString().slice(0, 10)
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
      })

      const { storagePath } = await uploadScheduleFile(file, weekStartIso, scheduleImport.id)
      await updateScheduleImportStoragePath(scheduleImport.id, storagePath)

      setImportId(scheduleImport.id)
      setAssignments(validated.assignments)
      setWarnings(validated.warnings)
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
          accept=".xls,.xlsx,.pdf"
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
      stats={stats}
      onCancel={() => setStep('upload')}
    />
  )
}

function SchedulePreview({
  importId,
  assignments: initialAssignments,
  warnings,
  stats,
  onCancel,
}: {
  importId: string
  assignments: MatchedAssignment[]
  warnings: ValidationWarning[]
  stats: { imported: number; skipped: number; unmatched_names: number }
  onCancel: () => void
}) {
  const [assignments, setAssignments] = useState(initialAssignments)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  const profilesQuery = useProfiles()

  function removeRow(index: number) {
    setAssignments((prev) => prev.filter((_, i) => i !== index))
  }

  function assignExistingProfile(index: number, userId: string, name: string) {
    setAssignments((prev) =>
      prev.map((a, i) => (i === index ? { ...a, planned_user_id: userId, source_name: name, match_confidence: 'exact' as const } : a)),
    )
  }

  function editName(index: number, name: string) {
    setAssignments((prev) => prev.map((a, i) => (i === index ? { ...a, source_name: name } : a)))
  }

  async function handlePublish() {
    setPublishing(true)
    setPublishError(null)
    try {
      await callPublishScheduleImport({
        importId,
        assignments,
        resolutions: {},
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a, i) => (
            <tr key={i}>
              <td>{a.work_date}</td>
              <td>{a.shift_category}</td>
              <td>{a.worker_kind}</td>
              <td>{a.position}</td>
              <td>
                {new Date(a.starts_at).toISOString().slice(11, 16)}–{new Date(a.ends_at).toISOString().slice(11, 16)}
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
                  <select onChange={(e) => assignExistingProfile(i, e.target.value, a.source_name ?? '')} defaultValue="">
                    <option value="" disabled>
                      אישור התאמה
                    </option>
                    {(profilesQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
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
                <button type="button" onClick={() => removeRow(i)}>
                  הסר
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {publishError && (
        <div className="bg-red-100 text-red-800 p-3 rounded mb-4" role="alert">
          {publishError}
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={publishing}>
          ביטול
        </button>
        <button type="button" onClick={handlePublish} disabled={publishing}>
          {publishing ? 'מפרסם…' : 'פרסם'}
        </button>
      </div>
    </div>
  )
}
