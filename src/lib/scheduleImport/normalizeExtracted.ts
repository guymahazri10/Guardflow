import type { NormalizedAssignment, ValidationWarning, WorkerKind } from './types'
import { classifyCategory, israelRangeToUtc } from './assignmentTime'
import { CANONICAL_POSITIONS, isKnownPosition } from './positions'

/**
 * One assignment exactly as the parse function is asked to return it — each
 * field separate, already resolved to a real calendar date.
 *
 * This is the whole point of the image path's design: rather than asking a
 * vision model to reproduce a 2D grid of strings and then re-deriving the
 * structure from it with positional and regex rules, the model returns the
 * finished records and this module only has to validate them. The grid
 * intermediate was the source of every import bug so far — a backslash date
 * separator, a newline instead of a space inside a cell, a section row that
 * didn't look like one — all of them failures of re-parsing a layout the
 * model had already understood correctly.
 */
export type ExtractedAssignment = {
  date: string // YYYY-MM-DD
  worker_kind: string
  position: string
  start: string // HH:MM
  end: string // HH:MM
  name: string
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/

const VALID_WORKER_KINDS: WorkerKind[] = ['אחמ"ש', 'מאבטח']

function normalizeWorkerKind(raw: string): WorkerKind | null {
  // Hebrew quote marks vary (geresh/gershayim vs ASCII), so compare normalized.
  const normalized = raw.trim().replace(/["'׳״]/g, '"').replace(/\s+/g, ' ')
  return VALID_WORKER_KINDS.find((k) => k === normalized) ?? null
}

export type NormalizeExtractedResult = {
  assignments: NormalizedAssignment[]
  warnings: ValidationWarning[]
  /** Which (worker kind, position) pairs actually appeared, and on how many
   *  distinct dates — drives the preview's coverage report so a cropped or
   *  partial screenshot is visible immediately rather than showing up as a
   *  quietly short list. */
  coverage: {
    datesFound: string[]
    positionsFound: { worker_kind: WorkerKind; position: string; days: number }[]
    positionsMissing: { worker_kind: WorkerKind; position: string }[]
  }
}

/**
 * Validates model-extracted records and turns them into NormalizedAssignments.
 *
 * Every rejection produces a warning naming the offending row. Nothing is
 * dropped silently — the previous grid pipeline's worst property was that a
 * parsing mismatch looked identical to "the schedule is empty", which is
 * exactly how three separate bugs stayed invisible behind "ייקלטו: 0".
 */
/**
 * Re-anchors a day/month to the year that puts it closest to `reference`.
 *
 * The source table's headers carry no year — they read "30\8" — so the model
 * has nothing to infer one from and guesses: asked to read a schedule for
 * late August 2026 it confidently returned 2024, which would have filed every
 * assignment two years in the past where nothing would ever display them.
 * Day and month come from the image and are trustworthy; the year does not
 * exist there, so it is derived here instead of being taken on faith. Same
 * approach parseHeaderDate already uses for the Excel path, and it handles a
 * week that straddles New Year, where the nearest year differs per column.
 */
function anchorYear(month: number, day: number, reference: Date): Date {
  const base = reference.getUTCFullYear()
  let best: { date: Date; distance: number } | null = null
  for (const year of [base - 1, base, base + 1]) {
    const candidate = new Date(Date.UTC(year, month - 1, day))
    const distance = Math.abs(candidate.getTime() - reference.getTime())
    if (!best || distance < best.distance) best = { date: candidate, distance }
  }
  return best!.date
}

export function normalizeExtractedAssignments(
  records: ExtractedAssignment[],
  reference: Date = new Date(),
): NormalizeExtractedResult {
  const assignments: NormalizedAssignment[] = []
  const warnings: ValidationWarning[] = []

  // slot_index distinguishes multiple workers filling the same position on
  // the same date and shift (a post that takes two people). It's assigned by
  // order of appearance within that group, and is part of the row's identity
  // in shift_assignments.
  const slotCounters = new Map<string, number>()

  // Guards against an exact duplicate record — same date/category/position/
  // hours/name — being counted as a second worker. Found live in production:
  // 17 positions each got the identical name in both slot_index 0 and 1,
  // always in the 'morning' category, always byte-identical down to the
  // start/end instants. That pattern (always the same person, never two
  // different names) is not "two people happen to share a name" — a person
  // can't work two slots of the same shift at once. The real cause is that
  // multiple uploaded images are concatenated with no deduplication
  // (parseImageSchedule.ts): a follow-up image uploaded to capture a
  // cropped section (e.g. a cut-off night row) can still fully overlap an
  // earlier image's morning section, and every record from both images gets
  // kept. Rather than trying to dedupe images before parsing (which would
  // need to compare pixels, not records), the exact-duplicate record itself
  // is the reliable signal — and it's cheap to catch here regardless of
  // which image path produced it.
  const seenExact = new Set<string>()

  for (const record of records) {
    const rowLabel = `${record.date ?? '?'} · ${record.position ?? '?'}`

    const workerKind = normalizeWorkerKind(record.worker_kind ?? '')
    if (!workerKind) {
      warnings.push({
        kind: 'low_confidence_ocr',
        message: `שורה דולגה (${rowLabel}): סוג עובד לא מזוהה "${record.worker_kind ?? ''}".`,
      })
      continue
    }

    const position = (record.position ?? '').trim()
    if (!isKnownPosition(workerKind, position)) {
      warnings.push({
        kind: 'low_confidence_ocr',
        message: `שורה דולגה (${rowLabel}): עמדה לא מוכרת "${position}" עבור ${workerKind}.`,
        work_date: record.date,
        position,
      })
      continue
    }

    const dateMatch = DATE_PATTERN.exec((record.date ?? '').trim())
    if (!dateMatch) {
      warnings.push({
        kind: 'low_confidence_ocr',
        message: `שורה דולגה (${rowLabel}): תאריך לא תקין "${record.date ?? ''}".`,
        position,
      })
      continue
    }

    const startMatch = TIME_PATTERN.exec((record.start ?? '').trim())
    const endMatch = TIME_PATTERN.exec((record.end ?? '').trim())
    if (!startMatch || !endMatch) {
      warnings.push({
        kind: 'low_confidence_ocr',
        message: `שורה דולגה (${rowLabel}): שעות לא תקינות "${record.start ?? ''}-${record.end ?? ''}".`,
        work_date: record.date,
        position,
      })
      continue
    }

    const name = (record.name ?? '').replace(/\s+/g, ' ').trim()
    if (!name) {
      // An unstaffed slot is normal in the source table, not an error — it
      // just isn't an assignment.
      continue
    }

    const startHour = Number(startMatch[1])
    const startMinute = Number(startMatch[2])
    const endHour = Number(endMatch[1])
    const endMinute = Number(endMatch[2])

    if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) {
      warnings.push({
        kind: 'low_confidence_ocr',
        message: `שורה דולגה (${rowLabel}): שעה מחוץ לטווח "${record.start}-${record.end}".`,
        work_date: record.date,
        position,
      })
      continue
    }

    // Only the day and month are taken from the model — see anchorYear.
    const workDate = anchorYear(Number(dateMatch[2]), Number(dateMatch[3]), reference)
    const shiftCategory = classifyCategory(startHour)
    const { starts_at, ends_at } = israelRangeToUtc(
      workDate,
      startHour,
      startMinute,
      endHour,
      endMinute,
    )

    const workDateIso = workDate.toISOString().slice(0, 10)
    const slotKey = `${workDateIso}|${shiftCategory}|${position}`

    const exactKey = `${slotKey}|${starts_at}|${ends_at}|${name}`
    if (seenExact.has(exactKey)) {
      warnings.push({
        kind: 'duplicate_slot',
        message: `שורה כפולה דולגה (${rowLabel}): "${name}" כבר נקלט לעמדה זו באותה שעה — כנראה מתמונה חופפת.`,
        work_date: workDateIso,
        position,
      })
      continue
    }
    seenExact.add(exactKey)

    const slotIndex = slotCounters.get(slotKey) ?? 0
    slotCounters.set(slotKey, slotIndex + 1)

    assignments.push({
      work_date: workDateIso,
      shift_category: shiftCategory,
      worker_kind: workerKind,
      position,
      slot_index: slotIndex,
      starts_at,
      ends_at,
      source_name: name,
    })
  }

  return { assignments, warnings, coverage: buildCoverage(assignments) }
}

function buildCoverage(assignments: NormalizedAssignment[]): NormalizeExtractedResult['coverage'] {
  const datesFound = [...new Set(assignments.map((a) => a.work_date))].sort()

  const daysByPosition = new Map<string, Set<string>>()
  for (const a of assignments) {
    const key = `${a.worker_kind}|${a.position}`
    const set = daysByPosition.get(key) ?? new Set<string>()
    set.add(a.work_date)
    daysByPosition.set(key, set)
  }

  const positionsFound: NormalizeExtractedResult['coverage']['positionsFound'] = []
  const positionsMissing: NormalizeExtractedResult['coverage']['positionsMissing'] = []

  for (const workerKind of Object.keys(CANONICAL_POSITIONS) as WorkerKind[]) {
    for (const position of CANONICAL_POSITIONS[workerKind]) {
      const days = daysByPosition.get(`${workerKind}|${position}`)?.size ?? 0
      if (days > 0) positionsFound.push({ worker_kind: workerKind, position, days })
      else positionsMissing.push({ worker_kind: workerKind, position })
    }
  }

  return { datesFound, positionsFound, positionsMissing }
}
