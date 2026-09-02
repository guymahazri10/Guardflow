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
import { AlertIcon, CheckCircleIcon, ImageIcon, UploadIcon, XIcon } from '../components/ui/StateIcon'

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

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full lg:max-w-none">{children}</div>
}

function PageHeader({ light, bold }: { light: string; bold: string }) {
  return (
    <div className="bg-white border-b border-border px-4 pt-5 pb-4">
      <h1 className="text-lg">
        <span className="font-light text-text-secondary">{light}</span>{' '}
        <b className="font-extrabold">{bold}</b>
      </h1>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger flex items-start gap-2"
    >
      <AlertIcon className="shrink-0 w-4 h-4 mt-0.5" />
      <span>{message}</span>
    </div>
  )
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
      <PageShell>
        <PageHeader light="ייבוא" bold="סידור שבועי" />
        <div className="p-4">
          <p className="text-sm text-text-secondary">התכונה אינה זמינה כרגע.</p>
        </div>
      </PageShell>
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
      <PageShell>
        <PageHeader light="ייבוא" bold="סידור שבועי" />
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
          {errorMessage && <ErrorBanner message={errorMessage} />}

          <label
            className={`card border-2 border-dashed border-border-strong p-6 flex flex-col items-center text-center gap-2 transition-colors ${
              profilesQuery.isLoading ? 'opacity-50' : 'active:bg-primary-light/40 cursor-pointer'
            }`}
          >
            <input
              type="file"
              accept=".xls,.xlsx"
              disabled={profilesQuery.isLoading}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFileSelected(file)
              }}
            />
            <div className="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center text-primary">
              <UploadIcon className="w-5 h-5" />
            </div>
            <div className="flex items-center gap-1.5">
              <p className="font-bold text-text-primary text-sm">קובץ Excel</p>
              <span className="text-[11px] font-bold bg-primary-light text-primary rounded-badge px-2 py-0.5">
                מומלץ
              </span>
            </div>
            <p className="text-xs text-text-muted">מדויק ביותר · .xls / .xlsx</p>
          </label>

          <label
            className={`card border-2 border-dashed border-border-strong p-6 flex flex-col items-center text-center gap-2 transition-colors ${
              profilesQuery.isLoading ? 'opacity-50' : 'active:bg-primary-light/40 cursor-pointer'
            }`}
          >
            <input
              type="file"
              accept="image/png,image/jpeg"
              multiple
              disabled={profilesQuery.isLoading}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length > 0) handleImagesSelected(files)
                e.target.value = ''
              }}
            />
            <div className="w-11 h-11 rounded-full bg-background-2 flex items-center justify-center text-text-secondary">
              <ImageIcon className="w-5 h-5" />
            </div>
            <p className="font-bold text-text-primary text-sm">תמונות (צילומי מסך)</p>
            <p className="text-xs text-text-muted">פחות מדויק · דורש אימות לפני פרסום</p>
          </label>

          {profilesQuery.isLoading && (
            <p className="text-xs text-text-secondary text-center">טוען רשימת עובדים…</p>
          )}
        </div>
      </PageShell>
    )
  }

  if (step === 'imagesSelected') {
    return (
      <PageShell>
        <PageHeader light="תצוגה מקדימה של" bold="התמונות" />
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
          <p className="text-sm text-text-secondary">{pendingImages.length} תמונות נבחרו</p>

          <div className="grid grid-cols-3 gap-2">
            {pendingImages.map((file, i) => (
              <div key={i} className="relative rounded-xl overflow-hidden border border-border aspect-square bg-background-2">
                <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePendingImage(i)}
                  aria-label="הסר תמונה"
                  className="absolute top-1 left-1 w-6 h-6 rounded-full bg-danger text-white flex items-center justify-center shadow-card active:opacity-80"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setPendingImages([])
                setStep('upload')
              }}
            >
              ביטול
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleProcessImages()}
              disabled={pendingImages.length === 0}
            >
              עבד תמונות
            </button>
          </div>
        </div>
      </PageShell>
    )
  }

  if (step === 'processing') {
    return (
      <PageShell>
        <PageHeader light="ייבוא" bold="סידור שבועי" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
          <div className="w-12 h-12 rounded-full bg-primary-light flex items-center justify-center">
            <span className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <p className="font-bold text-text-primary text-sm">מעבד את הקובץ…</p>
          {ocrProgress && (
            <p className="text-xs text-text-secondary tabular-nums">
              תמונה {ocrProgress.imageIndex + 1} מתוך {ocrProgress.totalImages}
            </p>
          )}
        </div>
      </PageShell>
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
      className={`card p-4 flex gap-2.5 ${
        complete ? 'bg-good-light border-good/20' : 'bg-warning-light border-warning/20'
      }`}
    >
      {complete ? (
        <CheckCircleIcon className="shrink-0 w-4 h-4 mt-0.5 text-good" />
      ) : (
        <AlertIcon className="shrink-0 w-4 h-4 mt-0.5 text-warning" />
      )}
      <div>
        <p className={`font-bold text-sm ${complete ? 'text-good' : 'text-warning'}`}>
          {complete ? 'הטבלה נקראה במלואה' : 'ייתכן שחלק מהטבלה חסר'}
        </p>
        <p className={`text-xs mt-0.5 ${complete ? 'text-good' : 'text-warning'}`}>
          ימים: {coverage.datesFound.length} מתוך 7 · עמדות: {coverage.positionsFound.length} מתוך {totalPositions}
        </p>
        {coverage.positionsMissing.length > 0 && (
          <p className="text-xs mt-1 text-warning">
            עמדות שלא נמצאו: {coverage.positionsMissing.map((p) => `${p.position} (${p.worker_kind})`).join(' · ')}
          </p>
        )}
        {!complete && (
          <p className="text-xs mt-1 text-warning">
            אם חסרות שורות — ייתכן שהצילום חתוך. אפשר לבטל ולהעלות צילום מלא, או להעלות כמה תמונות יחד.
          </p>
        )}
      </div>
    </div>
  )
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: 'good' | 'neutral' | 'warning' }) {
  const toneClasses =
    tone === 'good'
      ? 'bg-good-light text-good'
      : tone === 'warning'
        ? 'bg-warning-light text-warning'
        : 'bg-background-2 text-text-secondary'

  return (
    <div className={`flex-1 rounded-xl px-3 py-2.5 text-center ${toneClasses}`}>
      <p className="text-lg font-extrabold tabular-nums leading-none">{value}</p>
      <p className="text-[11px] font-semibold mt-1">{label}</p>
    </div>
  )
}

function identityKey(a: { work_date: string; shift_category: string; position: string; slot_index: number }): string {
  return `${a.work_date}|${a.shift_category}|${a.position}|${a.slot_index}`
}

const selectFieldClass =
  'bg-white border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary transition'

function MatchConfidenceCell({
  assignment,
  profiles,
  isConfirmed,
  onAssignExisting,
  onConfirmFuzzy,
}: {
  assignment: MatchedAssignment
  profiles: { id: string; full_name: string | null }[]
  isConfirmed: boolean
  onAssignExisting: (userId: string, name: string) => void
  onConfirmFuzzy: () => void
}) {
  if (assignment.match_confidence === 'exact') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-good bg-good-light rounded-badge px-2 py-0.5">
        <CheckCircleIcon className="w-3.5 h-3.5" />
        מדויק
      </span>
    )
  }

  if (assignment.match_confidence === 'fuzzy') {
    return (
      <div className="flex items-center gap-1.5">
        <select
          className={selectFieldClass}
          onChange={(e) => onAssignExisting(e.target.value, assignment.source_name ?? '')}
          defaultValue=""
        >
          <option value="" disabled>
            אישור התאמה
          </option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
        {!isConfirmed ? (
          <button
            type="button"
            className="text-xs font-bold text-warning bg-warning-light rounded-lg px-2 py-1.5 active:opacity-70"
            onClick={onConfirmFuzzy}
          >
            אישור
          </button>
        ) : (
          <span className="text-xs font-bold text-good">✓ אושר</span>
        )}
      </div>
    )
  }

  return (
    <select
      className={`${selectFieldClass} border-danger/40`}
      onChange={(e) => onAssignExisting(e.target.value, assignment.source_name ?? '')}
      defaultValue=""
    >
      <option value="" disabled>
        בחר עובד קיים
      </option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.full_name}
        </option>
      ))}
    </select>
  )
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
      <PageShell>
        <PageHeader light="תצוגה" bold="מקדימה" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
          <CheckCircleIcon className="w-12 h-12 text-good" />
          <p className="text-good font-bold">הסידור פורסם בהצלחה.</p>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader light="תצוגה" bold="מקדימה" />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
        {detectedWeekStart && (
          <p className="text-xs text-text-secondary">שבוע מזוהה: החל מ-{detectedWeekStart}</p>
        )}

        <div className="flex gap-2">
          <StatChip label="ייקלטו" value={stats.imported} tone="good" />
          <StatChip label="דולגו" value={stats.skipped} tone="neutral" />
          <StatChip label="שמות שלא זוהו" value={stats.unmatched_names} tone="warning" />
        </div>

        {coverage && <CoverageReport coverage={coverage} />}

        {warnings.length > 0 && (
          <div className="card p-4 bg-warning-light border-warning/20 flex gap-2.5">
            <AlertIcon className="shrink-0 w-4 h-4 mt-0.5 text-warning" />
            <ul className="flex flex-col gap-1 text-xs text-warning">
              {warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-secondary text-xs">
                  <th className="px-3 py-2.5 font-bold text-right">תאריך</th>
                  <th className="px-3 py-2.5 font-bold text-right">משמרת</th>
                  <th className="px-3 py-2.5 font-bold text-right">תפקיד</th>
                  <th className="px-3 py-2.5 font-bold text-right">עמדה</th>
                  <th className="px-3 py-2.5 font-bold text-right">שעות</th>
                  <th className="px-3 py-2.5 font-bold text-right">שם</th>
                  <th className="px-3 py-2.5 font-bold text-right">התאמה</th>
                  <th className="px-3 py-2.5 font-bold text-right">עריכה ידנית</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a, i) => {
                  const key = identityKey(a)
                  const isConflict = conflictKeys.has(key)
                  return (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">{a.work_date}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{a.shift_category}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{a.worker_kind}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{a.position}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {utcIsoToIsraelHHMM(a.starts_at)}–{utcIsoToIsraelHHMM(a.ends_at)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={a.source_name ?? ''}
                          onChange={(e) => editName(i, e.target.value)}
                          className="w-28 bg-white border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary transition"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <MatchConfidenceCell
                          assignment={a}
                          profiles={profilesQuery.data ?? []}
                          isConfirmed={confirmedFuzzy.has(key)}
                          onAssignExisting={(userId, name) => assignExistingProfile(i, userId, name)}
                          onConfirmFuzzy={() => confirmFuzzyMatch(a)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {isConflict && (
                          <label className="flex items-start gap-1.5 text-[11px] text-warning max-w-[160px]">
                            <input
                              type="checkbox"
                              checked={overrides.has(key)}
                              onChange={() => toggleOverride(a)}
                              className="mt-0.5 accent-warning"
                            />
                            שיבוץ זה נערך ידנית — האם לדרוס מהקובץ?
                          </label>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          aria-label="הסר שורה"
                          className="text-text-muted active:text-danger active:bg-danger-light rounded-lg p-1.5 transition-colors"
                        >
                          <XIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {publishBlocked && (
          <div role="alert" className="card p-4 bg-warning-light border-warning/20 flex gap-2.5">
            <AlertIcon className="shrink-0 w-4 h-4 mt-0.5 text-warning" />
            <div className="text-xs text-warning flex flex-col gap-0.5">
              {hasUnresolvedFuzzy && <p>יש לאשר את כל ההתאמות המשוערות (התאמה לא ודאית) לפני פרסום.</p>}
              {hasUnresolvedNone && <p>יש לבחור עובד קיים או להסיר כל שורה עם שם שלא זוהה לפני פרסום.</p>}
            </div>
          </div>
        )}

        {publishError && <ErrorBanner message={publishError} />}

        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={publishing}>
            ביטול
          </button>
          <button type="button" className="btn-primary" onClick={handlePublish} disabled={publishing || publishBlocked}>
            {publishing ? 'מפרסם…' : 'פרסם'}
          </button>
        </div>
      </div>
    </PageShell>
  )
}
