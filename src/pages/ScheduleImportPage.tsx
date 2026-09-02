import { useState } from 'react'
import { detectFileKind } from '../lib/scheduleImport/detectFileKind'
import { parseExcelSchedule } from '../lib/scheduleImport/parseExcelSchedule'
import { parseImageSchedule } from '../lib/scheduleImport/parseImageSchedule'
import { normalizeSchedule } from '../lib/scheduleImport/normalizeSchedule'
import {
  normalizeExtractedAssignments,
  type NormalizeExtractedResult,
} from '../lib/scheduleImport/normalizeExtracted'
import { matchNames } from '../lib/scheduleImport/matchNames'
import { validateSchedule, type ExistingAssignmentSummary } from '../lib/scheduleImport/validateSchedule'
import type {
  MatchedAssignment,
  NormalizedAssignment,
  ValidationWarning,
} from '../lib/scheduleImport/types'
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

type WizardStep = 'upload' | 'imagesSelected' | 'processing' | 'preview' | 'error'

type OcrProgress = { imageIndex: number; totalImages: number; progress: number }

async function concatBytes(files: File[]): Promise<Uint8Array> {
  const buffers = await Promise.all(files.map((f) => f.arrayBuffer()))
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0)
  const combined = new Uint8Array(total)
  let offset = 0
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }
  return combined
}

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
  const [pendingImages, setPendingImages] = useState<File[]>([])
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null)
  const [coverage, setCoverage] = useState<NormalizeExtractedResult['coverage'] | null>(null)

  const profilesQuery = useProfiles()

  if (flag.loading) return null
  if (!flag.enabled) {
    return (
      <div dir="rtl" className="p-4">
        <p>התכונה אינה זמינה כרגע.</p>
      </div>
    )
  }

  function checkPreconditions(): string | null {
    if (profilesQuery.isLoading) return 'טוען רשימת עובדים, נסה שוב בעוד רגע.'
    if (profilesQuery.isError) return 'טעינת רשימת העובדים נכשלה. נסה לרענן את הדף.'
    if (!user) return 'יש להתחבר מחדש כדי להעלות קובץ.'
    return null
  }

  // Shared by both the Excel and image paths once each has produced
  // normalized assignments: match -> validate -> create the schedule_imports
  // row -> upload the source file(s) -> move to preview. The two paths reach
  // this point differently on purpose — Excel really is a grid, so it goes
  // through normalizeSchedule, while the image path gets structured records
  // straight from the model and skips grid re-parsing entirely (see
  // normalizeExtracted.ts). `parseWarnings` (unreadable rows, unknown
  // positions, a cropped screenshot) are merged into validateSchedule's own
  // warnings — never dropped.
  async function finishImport(
    normalized: NormalizedAssignment[],
    sourceKind: 'excel' | 'image',
    files: File[],
    contentHashBytes: Uint8Array,
    parseWarnings: ValidationWarning[],
    currentUserId: string,
    coverageInfo: NormalizeExtractedResult['coverage'] | null,
  ) {
    const weekStart = getPreviousSunday(new Date())

    const profiles = (profilesQuery.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name }))
    const matched = matchNames(normalized, profiles)

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
    const combinedWarnings = [...parseWarnings, ...validated.warnings]

    const contentHash = await computeContentHash(contentHashBytes)
    const scheduleImport = await createScheduleImport({
      week_start: weekStartIso,
      source_kind: sourceKind,
      storage_path: '', // placeholder until the upload below completes and this row is updated
      original_filename: files.length === 1 ? files[0].name : `${files.length} תמונות`,
      content_hash: contentHash,
      created_by: currentUserId,
    })

    // Multiple images all live under the same import folder; only the first
    // file's path is recorded on the row (existing single-column schema) —
    // the rest still land in storage for the manager to review manually if
    // ever needed, just without a dedicated multi-path audit column.
    let firstStoragePath: string | null = null
    for (const file of files) {
      const { storagePath } = await uploadScheduleFile(file, weekStartIso, scheduleImport.id)
      if (firstStoragePath === null) firstStoragePath = storagePath
    }
    if (firstStoragePath) {
      await updateScheduleImportStoragePath(scheduleImport.id, firstStoragePath)
    }

    setImportId(scheduleImport.id)
    setAssignments(validated.assignments)
    setWarnings(combinedWarnings)
    setConflicts(validated.conflicts)
    setDetectedWeekStart(weekStartIso)
    setStats(validated.stats)
    setCoverage(coverageInfo)
    setStep('preview')
  }

  async function handleFileSelected(file: File) {
    const precondition = checkPreconditions()
    if (precondition) {
      setErrorMessage(precondition)
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
      const { assignments: normalized } = normalizeSchedule(grid, getPreviousSunday(new Date()))
      await finishImport(normalized, 'excel', [file], bytes, [], user!.id, null)
    } catch (error) {
      setErrorMessage(getReadableError(error))
      setStep('error')
    }
  }

  function handleImagesSelected(files: File[]) {
    const precondition = checkPreconditions()
    if (precondition) {
      setErrorMessage(precondition)
      setStep('error')
      return
    }
    setErrorMessage(null)
    setPendingImages(files)
    setStep('imagesSelected')
  }

  function removePendingImage(index: number) {
    setPendingImages((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleProcessImages() {
    if (pendingImages.length === 0) return

    setStep('processing')
    setErrorMessage(null)
    setOcrProgress({ imageIndex: 0, totalImages: pendingImages.length, progress: 0 })

    try {
      const imageBytesList = await Promise.all(pendingImages.map((f) => f.arrayBuffer().then((b) => new Uint8Array(b))))
      const mimeTypes = pendingImages.map((f) => f.type || 'image/png')
      const result = await parseImageSchedule(imageBytesList, setOcrProgress, mimeTypes)

      if (!result.supported) {
        throw new Error(result.reason)
      }

      // Validate the model's records and build assignments directly — no grid
      // re-parsing step. Rejected rows become warnings naming the offending
      // row rather than vanishing into a shorter list.
      const normalized = normalizeExtractedAssignments(result.assignments, new Date())

      const combinedBytes = await concatBytes(pendingImages)
      await finishImport(
        normalized.assignments,
        'image',
        pendingImages,
        combinedBytes,
        [...result.warnings, ...normalized.warnings],
        user!.id,
        normalized.coverage,
      )
      setPendingImages([])
    } catch (error) {
      setErrorMessage(getReadableError(error))
      setStep('error')
    } finally {
      setOcrProgress(null)
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

        <div className="mb-4">
          <p className="font-bold mb-1">קובץ Excel (מומלץ — מדויק ביותר)</p>
          <input
            type="file"
            accept=".xls,.xlsx"
            disabled={profilesQuery.isLoading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFileSelected(file)
            }}
          />
        </div>

        <div>
          <p className="font-bold mb-1">תמונות (צילומי מסך) — פחות מדויק, דורש אימות</p>
          <input
            type="file"
            accept="image/png,image/jpeg"
            multiple
            disabled={profilesQuery.isLoading}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) handleImagesSelected(files)
              e.target.value = ''
            }}
          />
        </div>

        {profilesQuery.isLoading && <p className="text-sm text-gray-500 mt-2">טוען רשימת עובדים…</p>}
      </div>
    )
  }

  if (step === 'imagesSelected') {
    return (
      <div dir="rtl" className="p-4">
        <h1 className="text-xl font-bold mb-4">תצוגה מקדימה של התמונות</h1>
        <p className="mb-2 text-sm text-gray-600">{pendingImages.length} תמונות נבחרו</p>
        <div className="flex flex-wrap gap-3 mb-4">
          {pendingImages.map((file, i) => (
            <div key={i} className="relative border rounded p-1">
              <img src={URL.createObjectURL(file)} alt={file.name} className="h-32 w-auto object-contain" />
              <button
                type="button"
                onClick={() => removePendingImage(i)}
                className="absolute top-0 left-0 bg-red-600 text-white text-xs rounded px-1"
              >
                הסר
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setPendingImages([])
              setStep('upload')
            }}
          >
            ביטול
          </button>
          <button type="button" onClick={() => void handleProcessImages()} disabled={pendingImages.length === 0}>
            עבד תמונות
          </button>
        </div>
      </div>
    )
  }

  if (step === 'processing') {
    return (
      <div dir="rtl" className="p-4">
        <p>מעבד את הקובץ…</p>
        {ocrProgress && (
          <p className="text-sm text-gray-600 mt-2">
            תמונה {ocrProgress.imageIndex + 1} מתוך {ocrProgress.totalImages} — {Math.round(ocrProgress.progress * 100)}%
          </p>
        )}
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
      coverage={coverage}
      onCancel={() => setStep('upload')}
    />
  )
}

/**
 * Shows how much of the expected week actually came through. A partial or
 * cropped screenshot previously surfaced only as a quietly shorter list —
 * indistinguishable from a light week — so an incomplete import could be
 * published without anyone noticing what was missing.
 */
function CoverageReport({ coverage }: { coverage: NormalizeExtractedResult['coverage'] }) {
  const complete = coverage.positionsMissing.length === 0 && coverage.datesFound.length === 7
  const totalPositions = coverage.positionsFound.length + coverage.positionsMissing.length

  return (
    <div
      className={`p-3 rounded mb-4 ${complete ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}
    >
      <p className="font-bold mb-1">
        {complete ? 'הטבלה נקראה במלואה' : 'ייתכן שחלק מהטבלה חסר'}
      </p>
      <p className="text-sm">
        ימים: {coverage.datesFound.length} מתוך 7 · עמדות: {coverage.positionsFound.length} מתוך{' '}
        {totalPositions}
      </p>
      {coverage.positionsMissing.length > 0 && (
        <p className="text-sm mt-1">
          עמדות שלא נמצאו: {coverage.positionsMissing.map((p) => `${p.position} (${p.worker_kind})`).join(' · ')}
        </p>
      )}
      {!complete && (
        <p className="text-sm mt-1">
          אם חסרות שורות — ייתכן שהצילום חתוך. אפשר לבטל ולהעלות צילום מלא, או להעלות כמה תמונות יחד.
        </p>
      )}
    </div>
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
  coverage,
  onCancel,
}: {
  importId: string
  assignments: MatchedAssignment[]
  warnings: ValidationWarning[]
  conflicts: MatchedAssignment[]
  detectedWeekStart: string | null
  stats: { imported: number; skipped: number; unmatched_names: number }
  coverage: NormalizeExtractedResult['coverage'] | null
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

      {coverage && <CoverageReport coverage={coverage} />}

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
