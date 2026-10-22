import { useState } from 'react'
import { Link } from 'react-router-dom'
import { detectFileKind } from '../lib/scheduleImport/detectFileKind'
import { parseExcelSchedule } from '../lib/scheduleImport/parseExcelSchedule'
import { parseImageSchedule } from '../lib/scheduleImport/parseImageSchedule'
import { normalizeSchedule } from '../lib/scheduleImport/normalizeSchedule'
import {
  normalizeExtractedAssignments,
  type NormalizeExtractedResult,
} from '../lib/scheduleImport/normalizeExtracted'
import { matchNames } from '../lib/scheduleImport/matchNames'
import { linksToMap } from '../lib/scheduleImport/workerNames'
import { fetchScheduleWorkerLinks } from '../lib/scheduleWorkerLinks'
import { validateSchedule, type ExistingAssignmentSummary } from '../lib/scheduleImport/validateSchedule'
import { detectOverlaps } from '../lib/scheduleImport/detectOverlaps'
import { NIGHT_GUARD_ROLE } from '../lib/scheduleImport/positions'
import { WeeklyPreviewGrid } from '../components/WeeklyPreviewGrid'
import { buildPreviewGrid } from '../lib/scheduleImport/previewGrid'
import { getPublishBlockers } from '../lib/scheduleImport/publishGate'
import {
  carryOverLinks,
  toPublishPayload,
} from '../lib/scheduleImport/nameSummary'
import {
  ACK_REQUIRED_WARNING_KINDS,
  type MatchedAssignment,
  type NormalizedAssignment,
  type NormalizeSummary,
  type ValidationWarning,
} from '../lib/scheduleImport/types'
import {
  computeContentHash,
  createScheduleImport,
  storeImportFiles,
  setScheduleImportStatus,
  fetchShiftAssignmentsForWeek,
  callPublishScheduleImport,
  type PublishResult,
} from '../lib/scheduleImports'
import { useProfiles } from '../hooks/useProfiles'
import { useFeatureFlag } from '../hooks/useFeatureFlag'
import { useAuth } from '../contexts/AuthContext'
import { utcIsoToIsraelHHMM } from '../lib/israelTime'
import { SHIFT_CATEGORIES } from '../constants/shifts'
import { AlertIcon, BracesIcon, CheckCircleIcon, ImageIcon, UploadIcon, XIcon } from '../components/ui/StateIcon'
import type { ExtractedAssignment } from '../lib/scheduleImport/normalizeExtracted'
import { looksLikeDayGroupedSchedule, adaptDayGroupedSchedule } from '../lib/scheduleImport/jsonScheduleAdapter'

// Image import depends on the parse-schedule-image edge function, which has not
// been verified end to end against Gemini. It is hidden unless explicitly
// switched on for a build (VITE_ENABLE_IMAGE_IMPORT=true), so the deployed
// screen offers Excel (and the manager-prepared JSON file) only.
const IMAGE_IMPORT_ENABLED = import.meta.env.VITE_ENABLE_IMAGE_IMPORT === 'true'

type WizardStep = 'selectWeek' | 'upload' | 'imagesSelected' | 'processing' | 'preview' | 'error'

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

function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Sunday check on the manager's own picked date string (YYYY-MM-DD), using
 *  local-date parsing (not `new Date(iso)`, which reads it as UTC midnight
 *  and can shift a day depending on the browser's timezone). */
function isSundayIsoDate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return false
  return new Date(y, m - 1, d).getDay() === 0
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

  const [step, setStep] = useState<WizardStep>('selectWeek')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [importId, setImportId] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<MatchedAssignment[]>([])
  const [warnings, setWarnings] = useState<ValidationWarning[]>([])
  const [conflicts, setConflicts] = useState<MatchedAssignment[]>([])
  const [detectedWeekStart, setDetectedWeekStart] = useState<string | null>(null)
  // parseRejected counts rows dropped during parsing/field-validation itself
  // (bad hours, unknown position, etc. — one warning per row, see
  // validateShiftFields.ts) — distinct from what the dry-run diff separately
  // reports (inserted/updated/unchanged/kept-manual/to-delete).
  const [stats, setStats] = useState({ parseRejected: 0, unmatched_names: 0 })
  const [pendingImages, setPendingImages] = useState<File[]>([])
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null)
  const [coverage, setCoverage] = useState<NormalizeExtractedResult['coverage'] | null>(null)
  const [dryRunResult, setDryRunResult] = useState<PublishResult | null>(null)
  // What the Excel importer included / left out, and why. Null for the image
  // and JSON paths, which have no excluded groups.
  const [summary, setSummary] = useState<NormalizeSummary | null>(null)

  // The manager's chosen week. Selected on its own step, before any upload
  // input is shown, and never editable again once a schedule_imports row has
  // been created for this import session (importId !== null) — see the plan's
  // "week lock" section. A mismatch between this and the week actually found
  // in an uploaded file restarts the whole flow from this step, rather than
  // silently switching to the detected week or the other way around.
  const [selectedWeekStart, setSelectedWeekStart] = useState<string>(() => toIsoDate(getPreviousSunday(new Date())))

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
    if (!user) return 'יש להתחבר מחדש כדי להעלות קובץ.'
    return null
  }

  // Best effort: a status label must never turn a good import into an error.
  async function markStatus(id: string, status: 'ready_for_review' | 'failed' | 'cancelled') {
    try {
      await setScheduleImportStatus(id, status)
    } catch (error) {
      console.warn('Could not update the import status', error)
    }
  }

  // Shared by all three input paths once each has produced normalized
  // assignments: match -> check the file's week against the manager's chosen
  // week -> validate -> create the schedule_imports row (only once the week
  // matches — see the plan's week-lock section) -> upload the source file(s)
  // -> run a real dry-run publish so the preview is backed by the same RPC
  // that will actually write -> move to preview. `parseWarnings` (unreadable
  // rows, unknown positions, a cropped screenshot) are merged into
  // validateSchedule's own warnings — never dropped.
  async function finishImport(
    normalized: NormalizedAssignment[],
    sourceKind: 'excel' | 'image' | 'json',
    files: File[],
    contentHashBytes: Uint8Array,
    parseWarnings: ValidationWarning[],
    currentUserId: string,
    coverageInfo: NormalizeExtractedResult['coverage'] | null,
    importSummary: NormalizeSummary | null = null,
  ) {
    // An empty parse result must never reach the RPC at all — publishing it
    // would (per the RPC's own guard) be rejected, but failing fast here
    // with a specific message is clearer than surfacing a generic RPC error.
    if (normalized.length === 0) {
      setErrorMessage('הקובץ לא הכיל אף שיבוץ תקין לאחר הסינון. לא ניתן להמשיך עם רשימה ריקה.')
      setStep('error')
      return
    }

    const detectedWeekIso = normalized.reduce(
      (min, a) => (a.work_date < min ? a.work_date : min),
      normalized[0].work_date,
    )

    // The week is locked once chosen (see the selectWeek step) — a file
    // whose own dates land in a different week is never silently accepted
    // under the selected week, nor does the selected week silently change to
    // match the file. The whole flow restarts from week selection instead.
    if (detectedWeekIso !== selectedWeekStart) {
      setErrorMessage(
        `השבוע שנבחר (${selectedWeekStart}) אינו תואם לשבוע שזוהה בקובץ (${detectedWeekIso}). יש לבחור מחדש את השבוע ולהעלות את הקובץ שוב.`,
      )
      setStep('selectWeek')
      return
    }

    const profiles = (profilesQuery.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name }))
    const existingAssignments = await fetchShiftAssignmentsForWeek(selectedWeekStart)
    // Explicit manager links beat automatic matching. The import must work
    // without them (none made yet, or the table not deployed yet), so a failure
    // to read them just means "no explicit links".
    const explicitLinks = await fetchScheduleWorkerLinks().then(linksToMap).catch(() => undefined)
    // Links made earlier survive a re-upload (see carryOverLinks).
    const matched = carryOverLinks(matchNames(normalized, profiles, explicitLinks), existingAssignments)
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
      week_start: selectedWeekStart,
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
    try {
      // An identical re-upload resumes the stored import and uploads nothing —
      // see storeImportFiles.
      await storeImportFiles(scheduleImport, files, selectedWeekStart)

      // Real dry-run against the same RPC that will publish — the preview is
      // now backed by what the write path actually does, not only by the
      // client-side validateSchedule heuristics above.
      const diff = await callPublishScheduleImport({
        importId: scheduleImport.id,
        assignments: toPublishPayload(validated.assignments, new Set()),
        resolutions: {},
        confirmedDeleteIds: [],
        dryRun: true,
      })

      setImportId(scheduleImport.id)
      setAssignments(validated.assignments)
      setWarnings(combinedWarnings)
      setConflicts(validated.conflicts)
      setDetectedWeekStart(selectedWeekStart)
      // Only warnings for rows that were actually dropped count as "skipped";
      // review warnings (unusual hours, guessed category) keep their row.
      setStats({ parseRejected: parseWarnings.filter((w) => w.kind === 'low_confidence_ocr' || w.kind === 'duplicate_slot').length, unmatched_names: validated.stats.unmatched_names })
      setCoverage(coverageInfo)
      setSummary(importSummary)
      setDryRunResult(diff)
      // The preview is ready: the row is no longer "processing".
      await markStatus(scheduleImport.id, 'ready_for_review')
      setStep('preview')
    } catch (error) {
      // Any failure after the row exists must not leave it "processing" forever.
      await markStatus(scheduleImport.id, 'failed')
      throw error
    }
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
      // Anchor day-letter headers to the week the manager picked, as a UTC
      // date (normalizeSchedule reads UTC fields). The file's own numeric
      // dates stay authoritative; this only resolves a header that has none.
      const {
        assignments: normalized,
        warnings: parseWarnings,
        summary: importSummary,
      } = normalizeSchedule(grid, new Date(`${selectedWeekStart}T00:00:00Z`))
      await finishImport(normalized, 'excel', [file], bytes, parseWarnings, user!.id, null, importSummary)
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
        normalized.summary,
      )
      setPendingImages([])
    } catch (error) {
      setErrorMessage(getReadableError(error))
      setStep('error')
    } finally {
      setOcrProgress(null)
    }
  }

  // Third input path, alongside Excel and image: a manager-prepared JSON
  // file. Exists because Gemini's image reading isn't always accurate
  // enough (reported directly) — a manager who wants guaranteed-correct
  // data can convert a screenshot to structured JSON themselves, with any
  // AI tool of their choice, and upload that instead of the raw image.
  // It goes through the exact same validation/dedup/coverage pipeline as
  // the image path (normalizeExtractedAssignments), just skipping the
  // vision-model step — the records are already in ExtractedAssignment
  // shape, whatever produced them.
  async function handleJsonFileSelected(file: File) {
    const precondition = checkPreconditions()
    if (precondition) {
      setErrorMessage(precondition)
      setStep('error')
      return
    }

    setStep('processing')
    setErrorMessage(null)

    try {
      const text = await file.text()

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('קובץ ה-JSON אינו תקין (שגיאת פענוח). ודא שזה JSON תקני.')
      }

      // Two shapes are accepted: the flat array the in-app schema asks for,
      // or a "day-grouped" shape ({ days: [{ date, assignments: [...] }] })
      // — found live, a manager's own AI conversion tool produced the
      // latter unprompted rather than the exact schema given to it, and
      // it's a reasonable enough structure to support directly instead of
      // forcing a re-conversion. See jsonScheduleAdapter.ts.
      let records: ExtractedAssignment[]
      let adapterWarnings: string[] = []

      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          throw new Error('קובץ ה-JSON ריק — אין בו שיבוצים.')
        }
        records = parsed as ExtractedAssignment[]
      } else if (looksLikeDayGroupedSchedule(parsed)) {
        const adapted = adaptDayGroupedSchedule(parsed, new Date().getFullYear())
        if (adapted.records.length === 0) {
          throw new Error('קובץ ה-JSON לא הכיל אף שיבוץ תקין שניתן לזהות.')
        }
        records = adapted.records
        adapterWarnings = adapted.warnings
      } else {
        throw new Error(
          'מבנה קובץ ה-JSON לא מזוהה. חייב להיות מערך שיבוצים ([{...}]), או אובייקט עם מפתח "days".',
        )
      }

      // Field-level validation (date/time/position/etc.) happens inside
      // normalizeExtractedAssignments itself, same as the image path — a
      // malformed record here becomes a named warning there, not a crash.
      const normalized = normalizeExtractedAssignments(records, new Date())

      const bytes = new TextEncoder().encode(text)
      await finishImport(
        normalized.assignments,
        'json',
        [file],
        bytes,
        [
          ...adapterWarnings.map((message) => ({ kind: 'low_confidence_ocr' as const, message })),
          ...normalized.warnings,
        ],
        user!.id,
        normalized.coverage,
        normalized.summary,
      )
    } catch (error) {
      setErrorMessage(getReadableError(error))
      setStep('error')
    }
  }

  if (step === 'selectWeek') {
    const isValidSunday = isSundayIsoDate(selectedWeekStart)
    return (
      <PageShell>
        <PageHeader light="ייבוא" bold="סידור שבועי" />
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
          {errorMessage && <ErrorBanner message={errorMessage} />}
          <Link to="/schedule-links" className="card px-4 py-3 text-sm font-semibold text-primary text-center">
            קישור עובדים לסידור (להצגת ״המשמרות שלי״)
          </Link>
          <div className="card p-4 flex flex-col gap-3">
            <div>
              <p className="font-bold text-text-primary text-sm">לאיזה שבוע מיועד הקובץ?</p>
              <p className="text-xs text-text-muted mt-0.5">
                יש לבחור את יום ראשון שבתחילת השבוע. לא ניתן לשנות את השבוע לאחר תחילת ההעלאה.
              </p>
            </div>
            <input
              type="date"
              value={selectedWeekStart}
              onChange={(e) => setSelectedWeekStart(e.target.value)}
              className="bg-white border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary transition"
            />
            {!isValidSunday && (
              <p className="text-xs text-danger">התאריך שנבחר אינו יום ראשון — יש לבחור את תחילת השבוע.</p>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={!isValidSunday}
              onClick={() => {
                setErrorMessage(null)
                setStep('upload')
              }}
            >
              המשך להעלאת קובץ
            </button>
          </div>
        </div>
      </PageShell>
    )
  }

  if (step === 'upload' || step === 'error') {
    return (
      <PageShell>
        <PageHeader light="ייבוא" bold="סידור שבועי" />
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
          {errorMessage && <ErrorBanner message={errorMessage} />}
          <p className="text-xs text-text-secondary">
            שבוע נבחר: החל מ-{selectedWeekStart} ·{' '}
            <button type="button" className="underline" onClick={() => setStep('selectWeek')}>
              שינוי שבוע
            </button>
          </p>

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

          {IMAGE_IMPORT_ENABLED && (
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
          )}

          <label
            className={`card border-2 border-dashed border-border-strong p-6 flex flex-col items-center text-center gap-2 transition-colors ${
              profilesQuery.isLoading ? 'opacity-50' : 'active:bg-primary-light/40 cursor-pointer'
            }`}
          >
            <input
              type="file"
              accept=".json,application/json"
              disabled={profilesQuery.isLoading}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleJsonFileSelected(file)
                e.target.value = ''
              }}
            />
            <div className="w-11 h-11 rounded-full bg-background-2 flex items-center justify-center text-text-secondary">
              <BracesIcon className="w-5 h-5" />
            </div>
            <p className="font-bold text-text-primary text-sm">קובץ JSON</p>
            <p className="text-xs text-text-muted">מדויק ביותר · להעלאה ידנית של נתונים שהוכנו מראש</p>
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
      summary={summary}
      initialDryRunResult={dryRunResult}
      onCancel={() => {
        // A cancelled import is a full restart, including week selection —
        // nothing about this attempt (the row already created, the dry-run
        // result) should leak into a fresh one. Only importId/dryRunResult
        // need clearing here for correctness; the rest is overwritten by
        // finishImport before the preview is ever shown again.
        if (importId) void markStatus(importId, 'cancelled')
        setImportId(null)
        setDryRunResult(null)
        setStep('selectWeek')
      }}
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

function warningKey(w: ValidationWarning): string {
  return [w.kind, w.work_date, w.shift_category, w.position, w.slot_index, w.original_hours].join('|')
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
  summary,
  initialDryRunResult,
  onCancel,
}: {
  importId: string
  assignments: MatchedAssignment[]
  warnings: ValidationWarning[]
  conflicts: MatchedAssignment[]
  detectedWeekStart: string | null
  stats: { parseRejected: number; unmatched_names: number }
  coverage: NormalizeExtractedResult['coverage'] | null
  summary: NormalizeSummary | null
  initialDryRunResult: PublishResult | null
  onCancel: () => void
}) {
  const [assignments, setAssignments] = useState(initialAssignments)
  // Identity keys (work_date|shift_category|position|slot_index — same format
  // publish_schedule_import expects) of conflicting rows the manager has
  // explicitly chosen to overwrite from the file (Important #5).
  const [overrides, setOverrides] = useState<Set<string>>(new Set())
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [published, setPublished] = useState(false)

  // The dry-run diff currently backing the preview. Any edit to the table
  // below (name, removed row, manual-conflict resolution) marks this stale
  // via isDirty — a fresh publish is blocked until a new dry-run runs, so the
  // manager can never publish against a diff that no longer matches what's
  // on screen.
  const [dryRunResult, setDryRunResult] = useState(initialDryRunResult)
  const [isDirty, setIsDirty] = useState(false)
  const [dryRunRunning, setDryRunRunning] = useState(false)
  const [dryRunError, setDryRunError] = useState<string | null>(null)
  // Ids (from the last dry-run's to_delete) the manager has explicitly
  // checked off as approved for deletion. Publish sends exactly this set as
  // p_confirmed_delete_ids — the RPC rejects the publish if it would delete
  // anything outside it (see phase20k).
  const [confirmedDeleteIds, setConfirmedDeleteIds] = useState<Set<string>>(new Set())
  // Warnings the manager has explicitly acknowledged (unusual hours/duration,
  // an unrecognized group, a category guessed from hours). Publish is blocked
  // until every one of them is ticked — the data is shown exactly as read.
  const [ackedWarnings, setAckedWarnings] = useState<Set<string>>(new Set())

  const conflictKeys = new Set(conflicts.map((c) => identityKey(c)))
  const previewGrid = buildPreviewGrid(assignments, new Set(), detectedWeekStart)

  function markDirty() {
    setIsDirty(true)
    setDryRunError(null)
  }

  function removeRow(index: number) {
    setAssignments((prev) => prev.filter((_, i) => i !== index))
    markDirty()
  }

  function toggleOverride(row: MatchedAssignment) {
    const key = identityKey(row)
    setOverrides((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    markDirty()
  }

  function editName(index: number, name: string) {
    setAssignments((prev) => prev.map((a, i) => (i === index ? { ...a, source_name: name } : a)))
    markDirty()
  }

  function toggleAckedWarning(w: ValidationWarning) {
    const key = warningKey(w)
    setAckedWarnings((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleConfirmedDelete(id: string) {
    setConfirmedDeleteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function buildResolutions(): Record<string, 'revert_to_file'> {
    const resolutions: Record<string, 'revert_to_file'> = {}
    for (const key of overrides) resolutions[key] = 'revert_to_file'
    return resolutions
  }

  async function runDryRun() {
    setDryRunRunning(true)
    setDryRunError(null)
    try {
      const diff = await callPublishScheduleImport({
        importId,
        assignments: toPublishPayload(assignments, new Set()),
        resolutions: buildResolutions(),
        confirmedDeleteIds: [],
        dryRun: true,
      })
      setDryRunResult(diff)
      // A fresh diff means the previous deletion approvals no longer apply —
      // the manager must re-approve against the new list, even if it happens
      // to be identical, rather than carrying stale approvals forward.
      setConfirmedDeleteIds(new Set())
      setIsDirty(false)
    } catch (error) {
      setDryRunError(getReadableError(error))
    } finally {
      setDryRunRunning(false)
    }
  }

  const overlapWarnings =
    !isDirty && dryRunResult
      ? detectOverlaps([...dryRunResult.to_insert, ...dryRunResult.to_update, ...dryRunResult.unchanged, ...dryRunResult.to_keep_manual])
      : []

  const pendingDeletes = !isDirty && dryRunResult ? dryRunResult.to_delete : []

  const visibleWarnings = warnings.filter((w) => w.kind !== 'unmatched_name')
  const ackWarnings = visibleWarnings.filter((w) => ACK_REQUIRED_WARNING_KINDS.includes(w.kind))
  const blockerList = getPublishBlockers({
    isDirty,
    hasDryRun: !!dryRunResult,
    pendingDeleteCount: pendingDeletes.length,
    confirmedDeleteCount: pendingDeletes.filter((row) => row.id && confirmedDeleteIds.has(row.id)).length,
    overlapWarnings: isDirty ? [] : overlapWarnings,
    warnings: visibleWarnings,
    isAcknowledged: (w) => ackedWarnings.has(warningKey(w)),
  })
  // A name with no linked user account is NOT a blocker (see publishGate.ts).
  const publishBlocked = blockerList.length > 0
  const has = (b: (typeof blockerList)[number]) => blockerList.includes(b)

  async function handlePublish() {
    if (publishBlocked) return
    setPublishing(true)
    setPublishError(null)
    try {
      await callPublishScheduleImport({
        importId,
        assignments: toPublishPayload(assignments, new Set()),
        resolutions: buildResolutions(),
        confirmedDeleteIds: Array.from(confirmedDeleteIds),
        dryRun: false,
      })
      setPublished(true)
    } catch (error) {
      // A race (someone else's edit surfaced a new deletion since our last
      // dry-run) comes back from the RPC as a plain exception — treat it the
      // same as any other staleness: require a fresh dry-run before retrying.
      setPublishError(getReadableError(error))
      setIsDirty(true)
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

        <section aria-label="סיכום הקובץ" className="card px-4 py-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-sm text-text-secondary">
            שבוע: <bdi dir="ltr" className="font-bold text-text-primary">{detectedWeekStart ?? '—'}</bdi>
          </p>
          <p className="text-sm text-text-secondary">
            <span className="font-bold text-text-primary tabular-nums">{assignments.length}</span> שיבוצים
          </p>
        </section>

        <div className="flex gap-2 flex-wrap">
          <StatChip label="דולגו בפענוח" value={stats.parseRejected} tone="neutral" />
          {!isDirty && dryRunResult && (
            <>
              <StatChip label="חדשים" value={dryRunResult.to_insert.length} tone="good" />
              <StatChip label="מעודכנים" value={dryRunResult.to_update.length} tone="neutral" />
              <StatChip label="ללא שינוי" value={dryRunResult.unchanged.length} tone="neutral" />
              <StatChip label="שמורים ידנית" value={dryRunResult.to_keep_manual.length} tone="neutral" />
              <StatChip label="ימחקו" value={dryRunResult.to_delete.length} tone={dryRunResult.to_delete.length > 0 ? 'warning' : 'neutral'} />
            </>
          )}
        </div>

        {summary && (
          <div className="card p-4 flex flex-col gap-2">
            <p className="text-sm font-bold text-text-primary">
              נכללו {summary.included} שיבוצים · הוחרגו {summary.excluded.reduce((n, g) => n + g.count, 0)}
            </p>
            {summary.excluded.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-xs text-text-secondary">
                {summary.excluded.map((g) => (
                  <li key={`${g.section}|${g.reason}`}>
                    {g.count} · {g.reason}
                  </li>
                ))}
              </ul>
            )}
            {summary.emptyCells > 0 && (
              <p className="text-xs text-text-muted">{summary.emptyCells} תאים ריקים (ללא עובד) דולגו.</p>
            )}
          </div>
        )}

        <WeeklyPreviewGrid grid={previewGrid} />

        {coverage && <CoverageReport coverage={coverage} />}

        {(isDirty || dryRunRunning) && (
          <div role="alert" className="card p-4 bg-warning-light border-warning/20 flex items-center justify-between gap-2.5">
            <div className="flex gap-2.5">
              <AlertIcon className="shrink-0 w-4 h-4 mt-0.5 text-warning" />
              <p className="text-xs text-warning">
                {dryRunRunning ? 'בודק את הסידור מול השרת…' : 'התצוגה השתנתה — יש להריץ בדיקה מחדש לפני פרסום.'}
              </p>
            </div>
            {!dryRunRunning && (
              <button type="button" className="btn-primary shrink-0 text-xs px-3 py-1.5" onClick={() => void runDryRun()}>
                בדיקה מחדש
              </button>
            )}
          </div>
        )}

        {dryRunError && <ErrorBanner message={dryRunError} />}

        {!isDirty && overlapWarnings.some((w) => w.kind === 'double_booked') && (
          <div role="alert" className="card p-4 bg-danger-light border-danger/20 flex gap-2.5">
            <AlertIcon className="shrink-0 w-4 h-4 mt-0.5 text-danger" />
            <ul className="flex flex-col gap-1 text-xs text-danger">
              {overlapWarnings
                .filter((w) => w.kind === 'double_booked')
                .map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
            </ul>
          </div>
        )}

        {!isDirty && overlapWarnings.some((w) => w.kind === 'possible_double_booking') && (
          <div className="card p-4 bg-warning-light border-warning/20 flex gap-2.5">
            <AlertIcon className="shrink-0 w-4 h-4 mt-0.5 text-warning" />
            <ul className="flex flex-col gap-1 text-xs text-warning">
              {overlapWarnings
                .filter((w) => w.kind === 'possible_double_booking')
                .map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
            </ul>
          </div>
        )}

        {!isDirty && pendingDeletes.length > 0 && (
          <div className="card p-4 bg-danger-light border-danger/20 flex flex-col gap-2">
            <div className="flex gap-2.5">
              <AlertIcon className="shrink-0 w-4 h-4 mt-0.5 text-danger" />
              <p className="text-xs font-bold text-danger">
                השורות הבאות יימחקו לצמיתות בפרסום — יש לאשר כל אחת מהן במפורש:
              </p>
            </div>
            <ul className="flex flex-col gap-1.5">
              {pendingDeletes.map((row) => (
                <li key={row.id} className="text-xs text-danger flex items-start gap-1.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-danger"
                    checked={!!row.id && confirmedDeleteIds.has(row.id)}
                    onChange={() => row.id && toggleConfirmedDelete(row.id)}
                  />
                  <span>
                    {row.work_date} · {row.position} · {row.source_name ?? '(ריק)'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {visibleWarnings.length > 0 && (
          <div className="card p-4 bg-warning-light border-warning/20 flex gap-2.5">
            <AlertIcon className="shrink-0 w-4 h-4 mt-0.5 text-warning" />
            <ul className="flex flex-col gap-1 text-xs text-warning">
              {ackWarnings.length > 1 && (
                <li>
                  <button
                    type="button"
                    className="underline font-bold"
                    onClick={() => setAckedWarnings(new Set(ackWarnings.map(warningKey)))}
                  >
                    אישור כל {ackWarnings.length} החריגות לאחר עיון בהן
                  </button>
                </li>
              )}
              {visibleWarnings.map((w, i) =>
                ACK_REQUIRED_WARNING_KINDS.includes(w.kind) ? (
                  <li key={i} className="flex items-start gap-1.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-warning"
                      checked={ackedWarnings.has(warningKey(w))}
                      onChange={() => toggleAckedWarning(w)}
                    />
                    <span>
                      {w.message}
                      {w.original_hours && <bdi dir="ltr"> [{w.original_hours}]</bdi>}
                    </span>
                  </li>
                ) : (
                  <li key={i}>{w.message}</li>
                ),
              )}
            </ul>
          </div>
        )}

        <details className="card overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-text-primary">
            פירוט שיבוצים ועריכה (שם, קישור למשתמש, הסרת שורה)
          </summary>
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
                      <td className="px-3 py-2 whitespace-nowrap">{SHIFT_CATEGORIES[a.shift_category].label}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{a.worker_kind}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{a.position}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        <bdi dir="ltr">
                          {utcIsoToIsraelHHMM(a.starts_at)}–{utcIsoToIsraelHHMM(a.ends_at)}
                        </bdi>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={a.source_name ?? ''}
                          onChange={(e) => editName(i, e.target.value)}
                          className="w-28 bg-white border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary transition"
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
        </details>

        {publishBlocked && (
          <div role="alert" className="card p-4 bg-warning-light border-warning/20 flex gap-2.5">
            <AlertIcon className="shrink-0 w-4 h-4 mt-0.5 text-warning" />
            <div className="text-xs text-warning flex flex-col gap-0.5">
              {has('no_dry_run') && <p>יש להריץ בדיקה מחדש (dry run) לפני פרסום.</p>}
              {has('stale_preview') && <p>התצוגה השתנתה — יש להריץ בדיקה מחדש לפני פרסום.</p>}
              {has('unconfirmed_deletes') && <p>יש לאשר את כל המחיקות הצפויות לפני פרסום.</p>}
              {has('double_booked') && <p>יש לפתור את השיבוצים הכפולים (המפורטים למעלה) לפני פרסום.</p>}
              {has('unresolved_position') && (
                <p>קיימים שיבוצים שלא ממופים לעמדה קנונית — לא ניתן לפרסם עד שתוגדר ההחלטה (ראו האזהרות למעלה).</p>
              )}
              {has('unacknowledged_warnings') && <p>יש לאשר במפורש את כל החריגות המסומנות (שעות חריגות, קבוצה לא מוכרת) לפני פרסום.</p>}
              {has('over_capacity') && (
                <p>התקבלו יותר מאבטחי-לילה ממספר המקומות המרבי ({NIGHT_GUARD_ROLE.maxCapacity}) — לא ניתן לפרסם עד שהפער יבדק (ראו האזהרות למעלה).</p>
              )}
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
