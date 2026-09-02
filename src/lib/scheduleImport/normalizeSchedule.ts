// GRID CONVENTION ASSUMPTION — verify against a real weekly schedule file
// before relying on this in production. See design spec "Open questions".
// Expected shape: header row = day names/dates; column-0 section cells
// (אחמ"ש / מאבטח / excluded labels) start a block; subsequent column-0
// cells are position labels; other cells are "HH:MM-HH:MM name" lines.
import type { NormalizedAssignment, RawGrid, WorkerKind } from './types'
import { classifyCategory, israelRangeToUtc } from './assignmentTime'

const WORKER_KIND_LABELS: Record<string, WorkerKind> = {
  'אחמ"ש': 'אחמ"ש',
  'אחמ״ש': 'אחמ"ש',
  מאבטח: 'מאבטח',
}

const EXCLUDED_SECTION_LABELS = new Set([
  'בקרה',
  'היעדרויות',
  'חופש',
  'מחלה',
  'מילואים',
  'קורס',
  'לימודים',
  'תגבור',
])

const HEBREW_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

// Headers in the real source system abbreviate the day to a single letter
// plus a geresh ("א׳ 30\8"), not the full name. Matched only when followed by
// an apostrophe/geresh: a bare `includes` on single Hebrew letters would
// false-match ordinary words — "משמרות", the label of column 0, contains both
// ו and ש — and silently assign column 0 a date.
const HEBREW_DAY_ABBREVIATION_PATTERN = /(?:^|\s)([אבגדהוש])['׳]/

const CELL_ENTRY_PATTERN = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(.+)$/

function normalizeSectionLabel(text: string): string {
  return text.trim().replace(/["'׳״]/g, '"').replace(/\s+/g, ' ')
}

function classifySection(rawLabel: string): { kind: 'worker'; workerKind: WorkerKind } | { kind: 'excluded' } | { kind: 'unknown' } {
  const label = normalizeSectionLabel(rawLabel)
  if (WORKER_KIND_LABELS[label]) {
    return { kind: 'worker', workerKind: WORKER_KIND_LABELS[label] }
  }
  if (EXCLUDED_SECTION_LABELS.has(label)) {
    return { kind: 'excluded' }
  }
  return { kind: 'unknown' }
}

function isSectionRow(row: { text: string }[]): boolean {
  if (row.length === 0) return false
  const first = normalizeSectionLabel(row[0].text)
  return classifySection(first).kind !== 'unknown' && row.slice(1).every((c) => c.text.trim() === '')
}

// A header cell like "ראשון 06/09" carries both the day-of-week name and the
// file's own DD/MM date. The numeric date is authoritative when present —
// it's what actually tells us which real week the file describes, whereas
// the day-of-week name only tells us an offset from whatever `weekStart` the
// caller happened to pass in (see Important #4: the caller no longer has to
// know the real week in advance).
// The separator class includes a backslash because that is what the real
// source system actually emits — its headers read "30\8", not "30/8" or
// "30.8". Without it every column's date failed to parse, parseHeaderDate
// returned null for all of them, and normalizeSchedule skipped every single
// cell — an import that read the table perfectly still produced 0 rows.
const HEADER_DATE_PATTERN = /(\d{1,2})[./\\](\d{1,2})(?:[./\\](\d{2,4}))?/

function parseHeaderDate(rawHeader: string, weekStart: Date): Date | null {
  const dateMatch = HEADER_DATE_PATTERN.exec(rawHeader)
  if (dateMatch) {
    const day = Number(dateMatch[1])
    const month = Number(dateMatch[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year: number
      if (dateMatch[3]) {
        year = Number(dateMatch[3])
        if (year < 100) year += 2000
      } else {
        // No year in the header — anchor to whichever nearby year puts this
        // date closest to weekStart (handles a week crossing Dec 31 → Jan 1).
        const base = weekStart.getUTCFullYear()
        let best: { year: number; diff: number } | null = null
        for (const candidateYear of [base - 1, base, base + 1]) {
          const candidate = Date.UTC(candidateYear, month - 1, day)
          const diff = Math.abs(candidate - weekStart.getTime())
          if (!best || diff < best.diff) best = { year: candidateYear, diff }
        }
        year = best!.year
      }
      return new Date(Date.UTC(year, month - 1, day))
    }
  }

  let dayIndex = HEBREW_DAY_NAMES.findIndex((name) => rawHeader.includes(name))
  if (dayIndex === -1) {
    const abbreviation = HEBREW_DAY_ABBREVIATION_PATTERN.exec(rawHeader)
    if (abbreviation) {
      dayIndex = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].indexOf(abbreviation[1])
    }
  }
  if (dayIndex === -1) return null
  const date = new Date(weekStart)
  date.setUTCDate(date.getUTCDate() + dayIndex)
  return date
}

// classifyCategory / israelRangeToUtc live in assignmentTime.ts: the image
// import path builds assignments directly from structured records rather than
// from a grid, and both paths must derive category and UTC instants
// identically — shift_category and starts_at are what the live page matches
// on, so a divergence between the two importers would surface as assignments
// that exist but never display.

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function normalizeSchedule(
  grid: RawGrid,
  weekStart: Date,
): { assignments: NormalizedAssignment[]; excludedSectionsSeen: string[] } {
  const assignments: NormalizedAssignment[] = []
  const excludedSectionsSeen = new Set<string>()

  if (grid.rows.length === 0) return { assignments: [], excludedSectionsSeen: [] }

  const headerRow = grid.rows[0]
  const columnDates = headerRow.map((c) => parseHeaderDate(c.text, weekStart))

  let currentSection: { kind: 'worker'; workerKind: WorkerKind } | { kind: 'excluded' } | null = null

  for (let rowIndex = 1; rowIndex < grid.rows.length; rowIndex++) {
    const row = grid.rows[rowIndex]
    if (row.length === 0) continue

    if (isSectionRow(row)) {
      const classified = classifySection(row[0].text)
      if (classified.kind === 'excluded') {
        excludedSectionsSeen.add(normalizeSectionLabel(row[0].text))
        currentSection = { kind: 'excluded' }
      } else if (classified.kind === 'worker') {
        currentSection = classified
      } else {
        currentSection = null
      }
      continue
    }

    if (!currentSection || currentSection.kind === 'excluded') {
      continue
    }

    const position = row[0].text.trim()
    if (!position) continue

    for (let colIndex = 1; colIndex < row.length; colIndex++) {
      const date = columnDates[colIndex]
      if (!date) continue

      const cellData = row[colIndex]
      const lines = cellData.entries.length > 0 ? cellData.entries : [cellData.text]

      let slotIndex = 0
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue

        const match = CELL_ENTRY_PATTERN.exec(trimmedLine)
        if (!match) continue

        const [, startHourStr, startMinStr, endHourStr, endMinStr, nameRaw] = match
        const startHour = Number(startHourStr)
        const startMin = Number(startMinStr)
        const endHour = Number(endHourStr)
        const endMin = Number(endMinStr)

        const { starts_at: startsAt, ends_at: endsAt } = israelRangeToUtc(
          date,
          startHour,
          startMin,
          endHour,
          endMin,
        )

        assignments.push({
          work_date: date.toISOString().slice(0, 10),
          shift_category: classifyCategory(startHour),
          worker_kind: currentSection.workerKind,
          position,
          slot_index: slotIndex,
          starts_at: startsAt,
          ends_at: endsAt,
          source_name: cleanName(nameRaw),
        })
        slotIndex += 1
      }
    }
  }

  return { assignments, excludedSectionsSeen: Array.from(excludedSectionsSeen) }
}
