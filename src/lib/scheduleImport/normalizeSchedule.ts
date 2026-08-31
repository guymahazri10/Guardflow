// GRID CONVENTION ASSUMPTION — verify against a real weekly schedule file
// before relying on this in production. See design spec "Open questions".
// Expected shape: header row = day names/dates; column-0 section cells
// (אחמ"ש / מאבטח / excluded labels) start a block; subsequent column-0
// cells are position labels; other cells are "HH:MM-HH:MM name" lines.
import type { NormalizedAssignment, RawGrid, ShiftCategory, WorkerKind } from './types'

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

function parseHeaderDate(rawHeader: string, weekStart: Date): Date | null {
  const dayIndex = HEBREW_DAY_NAMES.findIndex((name) => rawHeader.includes(name))
  if (dayIndex === -1) return null
  const date = new Date(weekStart)
  date.setUTCDate(date.getUTCDate() + dayIndex)
  return date
}

function classifyCategory(startHour: number): ShiftCategory {
  if (startHour >= 7 && startHour < 15) return 'morning'
  if (startHour >= 15 && startHour < 23) return 'afternoon'
  return 'night'
}

function toIso(date: Date, hour: number, minute: number): string {
  const d = new Date(date)
  d.setUTCHours(hour, minute, 0, 0)
  return d.toISOString()
}

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

        const startsAt = toIso(date, startHour, startMin)
        const crossesMidnight = endHour < startHour || (endHour === startHour && endMin < startMin)
        const endDate = new Date(date)
        if (crossesMidnight) endDate.setUTCDate(endDate.getUTCDate() + 1)
        const endsAt = toIso(endDate, endHour, endMin)

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
