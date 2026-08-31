import { useState } from 'react'
import { detectFileKind } from '../lib/scheduleImport/detectFileKind'
import { parseExcelSchedule } from '../lib/scheduleImport/parseExcelSchedule'
import { normalizeSchedule } from '../lib/scheduleImport/normalizeSchedule'
import { matchNames } from '../lib/scheduleImport/matchNames'
import { validateSchedule, type ExistingAssignmentSummary } from '../lib/scheduleImport/validateSchedule'
import type { MatchedAssignment, ValidationWarning } from '../lib/scheduleImport/types'
import { computeContentHash, createScheduleImport, uploadScheduleFile, updateScheduleImportStoragePath, fetchShiftAssignmentsForWeek } from '../lib/scheduleImports'
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
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFileSelected(file)
          }}
        />
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

// Placeholder signature — implemented in Task 17.
function SchedulePreview(props: {
  importId: string
  assignments: MatchedAssignment[]
  warnings: ValidationWarning[]
  stats: { imported: number; skipped: number; unmatched_names: number }
  onCancel: () => void
}) {
  return <div dir="rtl">Preview placeholder — implemented in Task 17 ({props.assignments.length} assignments, {props.stats.imported} imported)</div>
}
