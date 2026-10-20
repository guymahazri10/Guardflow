// GRID CONVENTION — verified against a real weekly export from the source
// system (mishmarot.co.il, HTML-as-.xls) on 2026-10-19. Two header rows
// precede the first section: a day-letter row ("א'".."ש'") and a separate
// row holding the real numeric date per column ("10\18" — month\day, not
// day\month — see buildColumnDates). A "section" cell in column 0 starts a
// block: either a worker-kind section (אחמ"ש / מאבטח) or an excluded
// section (בקרה/היעדרויות/חופש/מחלה/מילואים/קורס/לימודים/תגבור); an excluded
// label always starts an excluded block even if its own row also happens to
// carry stray data (see classifyRowTransition — a real "קורס" row did).
// Within a worker-kind section, each row's own column-0 label is a position
// (for מאבטח, often bundled with the period/hours, e.g. "בוקר מאבטח AB
// 06:45-15:10" — see extractGuardPosition), and the other cells (aligned to
// the header's day columns) hold the shift's hours and the worker's name —
// either on one line ("HH:MM-HH:MM name") or on two separate lines (an
// hours-only line, then a name-only line) — both are real, observed formats.
import type {
  ExcludedGroupSummary,
  NormalizedAssignment,
  NormalizeSummary,
  RawCell,
  RawGrid,
  ValidationWarning,
  WorkerKind,
} from './types'
import {
  MAX_PLAUSIBLE_SHIFT_MINUTES,
  categoryFromRowLabel,
  checkShiftEnvelope,
  classifyCategory,
  israelRangeToUtc,
} from './assignmentTime'
import { CANONICAL_POSITIONS, NIGHT_GUARD_LABEL, NIGHT_GUARD_ROLE, resolveGuardPosition } from './positions'
import { hasPositiveDuration, isValidCalendarDate, isValidHourRange } from './validateShiftFields'

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
// plus a geresh ("א' 30\8"), not the full name. Matched only when followed by
// an apostrophe/geresh: a bare `includes` on single Hebrew letters would
// false-match ordinary words — "משמרות", the label of column 0, contains both
// ו and ש — and silently assign column 0 a date.
const HEBREW_DAY_ABBREVIATION_PATTERN = /(?:^|\s)([אבגדהוש])['׳]/

// Matches "HH:MM-HH:MM" with or without a trailing name on the same line —
// capture group 5 is empty/undefined when there's no trailing text.
const CELL_ENTRY_PATTERN = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(?:\s+(.+))?$/

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

/**
 * Decides whether a row is a section-transition row, and if so which kind.
 *
 * An excluded label (בקרה/קורס/...) always starts an excluded block, even
 * when the row's own other cells are not empty — a real "קורס" row carried
 * actual shift data in its own cells (the row never got a clean label-only
 * line in that export), and the previous, stricter all-cells-empty check
 * would have missed it as a section row entirely, silently falling through
 * to whatever section preceded it. A worker-kind label keeps the stricter
 * check: no real worker-section row has ever been observed carrying its own
 * inline data, so loosening that side isn't justified by evidence and would
 * risk a stray "אחמ"ש"/"מאבטח" value elsewhere being misread as a transition.
 */
function classifyRowTransition(row: { text: string }[]): { kind: 'worker'; workerKind: WorkerKind } | { kind: 'excluded' } | null {
  if (row.length === 0) return null
  const classified = classifySection(row[0].text)
  if (classified.kind === 'excluded') return classified
  if (classified.kind === 'worker' && row.slice(1).every((c) => c.text.trim() === '')) return classified
  return null
}

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

// --- Guard position extraction (Finding B: composite row labels) ---------

const SHIFT_PERIOD_WORDS = ['בוקר', 'צהריים', 'לילה']

function splitWords(label: string): string[] {
  return label.split(/[\s-]+/).filter((w) => w.length > 0)
}

function containsWordSequence(labelWords: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= labelWords.length; i++) {
    if (needle.every((w, j) => labelWords[i + j] === w)) return true
  }
  return false
}

type GuardTokenMatcher = { token: string; test: (rawLabel: string, labelWords: string[]) => boolean }

// Built from positions.ts's own canonical list (the single source of truth
// it already documents itself as) rather than a second hardcoded copy here.
// Latin tokens (AB/CD/EFG) match on a word boundary over the raw label text;
// Hebrew multi-word tokens (לובי עליון/לובי תחתון) match as an exact
// contiguous word sequence. Both are explicit whole-token matches — never a
// bare substring test — so "AB" can't match inside a longer alphanumeric run
// and "לובי" alone can't match a position it isn't ("לובי עליון" needs both
// words present together).
const GUARD_TOKEN_MATCHERS: GuardTokenMatcher[] = CANONICAL_POSITIONS['מאבטח'].map((token) => {
  if (/^[A-Za-z]+$/.test(token)) {
    const boundary = new RegExp(`\\b${token}\\b`)
    return { token, test: (rawLabel) => boundary.test(rawLabel) }
  }
  const words = token.split(' ')
  return { token, test: (_rawLabel, labelWords) => containsWordSequence(labelWords, words) }
})

/**
 * Resolves a מאבטח row's canonical position out of a composite label like
 * "בוקר מאבטח AB 06:45-15:10" or "בוקר מאבטח 06:45-15:10 לובי עליון - חמוש".
 * Returns null when zero or more than one canonical token matches — an
 * ambiguous or unrecognized label is never guessed at; the caller decides
 * what to do with null (see looksLikeUnresolvedGuardRow below).
 */
function extractGuardPosition(rawLabel: string): string | null {
  const labelWords = splitWords(rawLabel)
  const matches = GUARD_TOKEN_MATCHERS.filter((m) => m.test(rawLabel, labelWords))
  return matches.length === 1 ? matches[0].token : null
}

/**
 * A label that's clearly a real מאבטח roster row (names a shift period and
 * says מאבטח) but carries no canonical position token at all AND isn't the
 * one specifically supported case (NIGHT_GUARD_LABEL, checked by the
 * caller before this) — e.g. some other label this exact shape that hasn't
 * been mapped yet. Distinguished from a genuinely unrecognized/garbage label
 * (e.g. a typo'd position) so the latter still gets dropped with the
 * existing "position not recognized" warning instead of silently becoming a
 * permanent new kind of row. Still blocked/unresolved — only the one named
 * case above is resolved.
 */
function looksLikeUnresolvedGuardRow(rawLabel: string): boolean {
  const words = splitWords(rawLabel)
  return words.includes('מאבטח') && SHIFT_PERIOD_WORDS.some((w) => words.includes(w))
}

// --- Column date resolution (Finding A: wrong/missing header row) --------

// Accepts "." / "/" / "\" as the separator (the real export uses a literal
// backslash: "10\18"). Captures two 1-2 digit numbers plus an optional year;
// which number is the day and which is the month is NOT assumed here — see
// resolveColumnDate, which tries both and keeps only calendar-valid ones.
const NUMERIC_DATE_PATTERN = /(\d{1,2})[./\\](\d{1,2})(?:[./\\](\d{2,4}))?/

function yearClosestTo(month: number, day: number, weekStart: Date): number {
  const base = weekStart.getUTCFullYear()
  let best = { year: base, diff: Infinity }
  for (const year of [base - 1, base, base + 1]) {
    const diff = Math.abs(Date.UTC(year, month - 1, day) - weekStart.getTime())
    if (diff < best.diff) best = { year, diff }
  }
  return best.year
}

function sameCalendarDate(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime()
}

/**
 * Every valid calendar-date reading of a "A<sep>B" header token — both
 * day=A/month=B and day=B/month=A, de-duplicated. A token where only one
 * ordering is calendar-valid (e.g. "10\18": month=10/day=18 valid, day=10/
 * month=18 impossible) returns exactly one candidate; a token where both
 * orderings are valid (e.g. "05\08") returns two — genuinely ambiguous,
 * resolved by the caller against the unambiguous day-letter anchor instead
 * of being guessed at here.
 */
function numericDateCandidates(text: string, weekStart: Date): Date[] {
  const match = NUMERIC_DATE_PATTERN.exec(text)
  if (!match) return []
  const [, aStr, bStr, yearStr] = match
  const a = Number(aStr)
  const b = Number(bStr)
  const explicitYear = yearStr ? (yearStr.length < 4 ? Number(yearStr) + 2000 : Number(yearStr)) : null

  const candidates: Date[] = []
  const tryOrdering = (day: number, month: number) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return
    const year = explicitYear ?? yearClosestTo(month, day, weekStart)
    if (!isValidCalendarDate(year, month, day)) return
    candidates.push(new Date(Date.UTC(year, month - 1, day)))
  }
  tryOrdering(a, b) // day=a, month=b
  if (b !== a) tryOrdering(b, a) // day=b, month=a — skip the identical re-check when a === b

  return candidates.filter((d, i) => candidates.findIndex((d2) => sameCalendarDate(d, d2)) === i)
}

function dayIndexFromLetterOrName(rawHeader: string): number | null {
  const byName = HEBREW_DAY_NAMES.findIndex((name) => rawHeader.includes(name))
  if (byName !== -1) return byName
  const abbreviation = HEBREW_DAY_ABBREVIATION_PATTERN.exec(rawHeader)
  if (abbreviation) return ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].indexOf(abbreviation[1])
  return null
}

function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

/**
 * Resolves one column's real date from whatever the header rows supply:
 * an unambiguous day-of-week (letter/name, relative to weekStart) and/or a
 * numeric token. Never guesses between two equally-valid numeric orderings —
 * when genuinely ambiguous, prefers the day-of-week anchor and flags a
 * warning instead of picking one.
 */
function resolveColumnDate(
  dayIndex: number | null,
  numericCandidates: Date[],
  weekStart: Date,
  columnLabel: string,
): { date: Date | null; warning?: ValidationWarning } {
  const anchorDate = dayIndex !== null ? addDaysUtc(weekStart, dayIndex) : null

  if (numericCandidates.length === 0) {
    return { date: anchorDate }
  }

  if (numericCandidates.length === 1) {
    const numeric = numericCandidates[0]
    if (anchorDate && !sameCalendarDate(numeric, anchorDate)) {
      // The file's own date is authoritative when unambiguous, even against
      // a disagreeing day-letter — but the disagreement itself is always
      // surfaced, never silently overridden.
      return {
        date: numeric,
        warning: {
          kind: 'week_mismatch',
          message: `תאריך בכותרת "${columnLabel}" (${numeric.toISOString().slice(0, 10)}) אינו תואם ליום השבוע הצפוי (${anchorDate.toISOString().slice(0, 10)}).`,
        },
      }
    }
    return { date: numeric }
  }

  // Two valid orderings: genuinely ambiguous. If one of them happens to
  // match the unambiguous day-letter anchor, that resolves it with no
  // guessing involved. Otherwise, don't pick — fall back to the anchor (or
  // to null if there isn't one), with a warning either way.
  const matchingAnchor = anchorDate ? numericCandidates.find((d) => sameCalendarDate(d, anchorDate)) : undefined
  if (matchingAnchor) return { date: matchingAnchor }

  return {
    date: anchorDate,
    warning: {
      kind: 'week_mismatch',
      message: `תאריך בכותרת "${columnLabel}" עמום (ניתן לקרוא כיום/חודש או חודש/יום) ולא נפתר חד-משמעית — ${
        anchorDate ? 'נעשה שימוש ביום השבוע.' : 'לא ניתן לקבוע תאריך.'
      }`,
    },
  }
}

/**
 * Scans every row before the first section-transition row (there may be one
 * combined header row, or two separate ones — a day-letter row and a
 * numeric-date row, as in the real export) and resolves a date per column.
 */
function buildColumnDates(
  grid: RawGrid,
  weekStart: Date,
): { dates: (Date | null)[]; warnings: ValidationWarning[]; headerRowCount: number } {
  let headerRowCount = 0
  while (
    headerRowCount < grid.rows.length &&
    !classifyRowTransition(grid.rows[headerRowCount]) &&
    // an unrecognized group header is a section, not another header row
    !isUnknownSectionRow(grid.rows[headerRowCount])
  ) {
    headerRowCount++
  }
  const headerRows = grid.rows.slice(0, headerRowCount)
  const width = Math.max(0, ...headerRows.map((r) => r.length))

  const dates: (Date | null)[] = []
  const warnings: ValidationWarning[] = []

  for (let col = 0; col < width; col++) {
    let dayIndex: number | null = null
    let numericCandidates: Date[] = []
    let label = ''
    for (const row of headerRows) {
      const text = row[col]?.text ?? ''
      if (!text.trim()) continue
      label = label || text
      if (dayIndex === null) {
        const found = dayIndexFromLetterOrName(text)
        if (found !== null) dayIndex = found
      }
      if (numericCandidates.length === 0) {
        numericCandidates = numericDateCandidates(text, weekStart)
      }
    }
    const resolved = resolveColumnDate(dayIndex, numericCandidates, weekStart, label)
    dates.push(resolved.date)
    if (resolved.warning) warnings.push(resolved.warning)
  }

  return { dates, warnings, headerRowCount }
}

// --- Cell line consumption (Finding B: same-line vs two-line formats) ----

type ParsedLine = { startHour: number; startMin: number; endHour: number; endMin: number; name: string | null }

const TIME_ONLY_PATTERN = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/

/**
 * Consumes a cell's lines into (hours, name) pairs. Two real formats are
 * supported without either one breaking the other: "HH:MM-HH:MM name" on a
 * single line (the original/synthetic-test format), and an hours-only line
 * immediately followed by a name-only line (the real export's format, where
 * the site's per-cell combo-box widget puts them on separate lines). A line
 * that fits neither — not a time, and not consumed as the name following a
 * time-only line — is never silently dropped: it becomes a warning naming
 * the cell's position/date and the exact unreadable text.
 */
function consumeCellLines(
  lines: string[],
  ctx: { position: string; workDateIso: string },
): { parsed: ParsedLine[]; warnings: ValidationWarning[] } {
  const parsed: ParsedLine[] = []
  const warnings: ValidationWarning[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    const full = CELL_ENTRY_PATTERN.exec(line)
    if (full && full[5] !== undefined) {
      parsed.push({
        startHour: Number(full[1]),
        startMin: Number(full[2]),
        endHour: Number(full[3]),
        endMin: Number(full[4]),
        name: cleanName(full[5]),
      })
      i += 1
      continue
    }

    const timeOnly = TIME_ONLY_PATTERN.exec(line)
    if (timeOnly) {
      const next = lines[i + 1]
      const nextIsTime = next !== undefined && (TIME_ONLY_PATTERN.test(next) || CELL_ENTRY_PATTERN.test(next))
      const name = next !== undefined && !nextIsTime ? cleanName(next) : null
      parsed.push({
        startHour: Number(timeOnly[1]),
        startMin: Number(timeOnly[2]),
        endHour: Number(timeOnly[3]),
        endMin: Number(timeOnly[4]),
        name,
      })
      i += name !== null ? 2 : 1
      continue
    }

    warnings.push({
      kind: 'low_confidence_ocr',
      message: `שורה לא מפוענחת בתא (${ctx.position}, ${ctx.workDateIso}): "${line}"`,
      work_date: ctx.workDateIso,
      position: ctx.position,
    })
    i += 1
  }

  return { parsed, warnings }
}

type Section =
  | { kind: 'worker'; workerKind: WorkerKind }
  | { kind: 'excluded'; label: string }
  | { kind: 'unknown'; label: string }

function formatHours(line: { startHour: number; startMin: number; endHour: number; endMin: number }): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(line.startHour)}:${pad(line.startMin)}-${pad(line.endHour)}:${pad(line.endMin)}`
}

/** A group header spans the whole table; an unrecognized one is never guessed
 *  at. Only a row whose first cell actually spans columns counts, so a real
 *  position row that happens to be empty all week is not mistaken for one. */
function isUnknownSectionRow(row: RawCell[]): boolean {
  return (
    row.length > 0 &&
    (row[0].colspan ?? 1) > 1 &&
    row[0].text.trim() !== '' &&
    row.slice(1).every((c) => c.text.trim() === '')
  )
}

function excludedReason(label: string, rowLabel: string): { section: string; reason: string } {
  if (label === 'בקרה') return { section: 'בקרה', reason: 'קבוצת בקרה — לא נכללת בסידור' }
  const absence = rowLabel || label
  return { section: absence, reason: `היעדרות (${absence}) — לא נכללת בסידור` }
}

export function normalizeSchedule(
  grid: RawGrid,
  weekStart: Date,
): {
  assignments: NormalizedAssignment[]
  warnings: ValidationWarning[]
  excludedSectionsSeen: string[]
  summary: NormalizeSummary
} {
  const assignments: NormalizedAssignment[] = []
  const warnings: ValidationWarning[] = []
  const excludedSectionsSeen = new Set<string>()
  const excludedCounts = new Map<string, ExcludedGroupSummary>()
  let emptyCells = 0

  const emptyResult = () => ({
    assignments: [] as NormalizedAssignment[],
    warnings: [] as ValidationWarning[],
    excludedSectionsSeen: [] as string[],
    summary: { included: 0, excluded: [], emptyCells: 0 } satisfies NormalizeSummary,
  })
  if (grid.rows.length === 0) return emptyResult()

  const { dates: columnDates, warnings: dateWarnings, headerRowCount } = buildColumnDates(grid, weekStart)
  warnings.push(...dateWarnings)

  // Counts the workers an excluded/unknown row holds, so the preview can say
  // how many shifts were left out and why. Read-only: nothing here is imported.
  function countExcludedRow(row: RawCell[], section: string, reason: string) {
    let count = 0
    for (let colIndex = 1; colIndex < row.length; colIndex++) {
      if (!columnDates[colIndex]) continue
      const lines = (row[colIndex].entries.length > 0 ? row[colIndex].entries : [row[colIndex].text])
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      if (lines.length === 0) continue
      count += consumeCellLines(lines, { position: section, workDateIso: '' }).parsed.length
    }
    if (count === 0) return
    const key = `${section}|${reason}`
    const existing = excludedCounts.get(key)
    if (existing) existing.count += count
    else excludedCounts.set(key, { section, reason, count })
  }

  let currentSection: Section | null = null

  for (let rowIndex = headerRowCount; rowIndex < grid.rows.length; rowIndex++) {
    const row = grid.rows[rowIndex]
    if (row.length === 0) continue

    const transition = classifyRowTransition(row)
    if (transition) {
      if (transition.kind === 'excluded') {
        const label = normalizeSectionLabel(row[0].text)
        excludedSectionsSeen.add(label)
        // A bare absence row ("קורס") is its own header AND carries data;
        // count it here. A group header like "בקרה" has no data of its own.
        const { section, reason } = excludedReason(label, label)
        countExcludedRow(row, section, reason)
        currentSection = { kind: 'excluded', label }
      } else {
        currentSection = transition
      }
      continue
    }

    if (isUnknownSectionRow(row)) {
      const label = normalizeSectionLabel(row[0].text)
      currentSection = { kind: 'unknown', label }
      warnings.push({
        kind: 'unknown_section',
        message: `קבוצה לא מוכרת "${label}" — השורות שלה לא יובאו ולא סווגו. יש לבדוק ולאשר.`,
        position: label,
      })
      continue
    }

    if (!currentSection) continue
    if (currentSection.kind === 'excluded') {
      const { section, reason } = excludedReason(currentSection.label, normalizeSectionLabel(row[0].text))
      countExcludedRow(row, currentSection.label === 'בקרה' ? 'בקרה' : section, reason)
      continue
    }
    if (currentSection.kind === 'unknown') {
      countExcludedRow(row, currentSection.label, `קבוצה לא מוכרת (${currentSection.label}) — דורשת בדיקה`)
      continue
    }

    const rawLabel = row[0].text.trim()
    if (!rawLabel) continue

    // The source table splits אחמ"ש into per-shift row labels ("אחמ"ש בוקר"/
    // "אחמ"ש צהריים"/"אחמ"ש לילה") even though shift_category already
    // distinguishes them — CANONICAL_POSITIONS deliberately has one bare
    // "אחמ"ש" entry (see positions.ts), so coerce here too rather than
    // storing the raw per-shift label.
    let position: string
    let unresolvedGuardMapping = false
    const isNightGuard = currentSection.workerKind === 'מאבטח' && rawLabel.trim() === NIGHT_GUARD_LABEL

    if (currentSection.workerKind === 'אחמ"ש') {
      position = 'אחמ"ש'
    } else if (isNightGuard) {
      // The night shift's guard(s) — a role, not a fixed physical post (see
      // positions.ts). Kept as its own label, never coerced into a canonical
      // AB/CD/EFG/לובי/רכוב token; resolveGuardPosition checks its capacity
      // (NIGHT_GUARD_ROLE.maxCapacity) per date down in the per-line loop
      // below, once slotIndex is known.
      position = rawLabel
    } else {
      const resolved = extractGuardPosition(rawLabel)
      if (resolved) {
        position = resolved
      } else if (looksLikeUnresolvedGuardRow(rawLabel)) {
        // A real מאבטח row (names a period + "מאבטח") with no canonical
        // position token at all and not the one known label above —
        // extracted as-is (never coerced into an invented position) and
        // flagged so publish is blocked until the real mapping is decided.
        position = rawLabel
        unresolvedGuardMapping = true
      } else {
        warnings.push({
          kind: 'low_confidence_ocr',
          message: `שורה דולגה: עמדה לא מוכרת "${rawLabel}" עבור מאבטח.`,
          position: rawLabel,
        })
        continue
      }
    }

    // The category comes from the row's own title. Hours never decide it —
    // an early start, a late finish or a partial shift stays in its category.
    const titleCategory = categoryFromRowLabel(rawLabel)

    for (let colIndex = 1; colIndex < row.length; colIndex++) {
      const date = columnDates[colIndex]
      if (!date) continue
      const workDateIso = date.toISOString().slice(0, 10)

      const cellData = row[colIndex]
      const lines = (cellData.entries.length > 0 ? cellData.entries : [cellData.text])
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      if (lines.length === 0) {
        emptyCells += 1 // genuinely empty cell — counted, not a warning
        continue
      }

      const { parsed, warnings: cellWarnings } = consumeCellLines(lines, { position, workDateIso })
      warnings.push(...cellWarnings)

      let slotIndex = 0
      for (const line of parsed) {
        if (!isValidHourRange(line.startHour, line.startMin) || !isValidHourRange(line.endHour, line.endMin)) {
          warnings.push({
            kind: 'low_confidence_ocr',
            message: `שורה דולגה (${position}): שעה מחוץ לטווח.`,
            work_date: workDateIso,
            position,
          })
          continue
        }

        const { starts_at: startsAt, ends_at: endsAt } = israelRangeToUtc(
          date,
          line.startHour,
          line.startMin,
          line.endHour,
          line.endMin,
        )

        if (!hasPositiveDuration(startsAt, endsAt)) {
          warnings.push({
            kind: 'low_confidence_ocr',
            message: `שורה דולגה (${position}): משך משמרת לא חיובי.`,
            work_date: workDateIso,
            position,
          })
          continue
        }

        const category = titleCategory ?? classifyCategory(line.startHour)
        const originalHours = formatHours(line)
        const identity = { work_date: workDateIso, position, shift_category: category, slot_index: slotIndex }

        if (!titleCategory) {
          warnings.push({
            kind: 'category_guessed_from_hours',
            message: `שורה "${rawLabel}" (${workDateIso}) ללא ציון בוקר/צהריים/לילה — הקטגוריה נקבעה לפי שעת ההתחלה בלבד (${originalHours}).`,
            ...identity,
            original_hours: originalHours,
          })
        }

        const { outsideWindow, durationMinutes } = checkShiftEnvelope(
          category,
          line.startHour,
          line.startMin,
          line.endHour,
          line.endMin,
        )
        if (outsideWindow) {
          warnings.push({
            kind: 'unusual_shift_hours',
            message: `שעות חריגות: ${position} ${workDateIso} (${line.name ?? '—'}) ${originalHours} חורגות מחלון המשמרת. השעות נשמרו כפי שהן ללא תיקון.`,
            ...identity,
            original_hours: originalHours,
          })
        }
        if (durationMinutes > MAX_PLAUSIBLE_SHIFT_MINUTES) {
          warnings.push({
            kind: 'unusual_shift_duration',
            message: `משך חריג: ${position} ${workDateIso} (${line.name ?? '—'}) ${originalHours} (${Math.round((durationMinutes / 60) * 10) / 10} שעות). השעות נשמרו כפי שהן ללא תיקון.`,
            ...identity,
            original_hours: originalHours,
          })
        }

        assignments.push({
          work_date: workDateIso,
          shift_category: category,
          worker_kind: currentSection.workerKind,
          position,
          slot_index: slotIndex,
          starts_at: startsAt,
          ends_at: endsAt,
          source_name: line.name,
        })

        if (unresolvedGuardMapping) {
          warnings.push({
            kind: 'unresolved_position_mapping',
            message: `שיבוץ "${position}" (${workDateIso}) אינו ממופה לעמדה קנונית — נדרשת החלטה לפני פרסום.`,
            work_date: workDateIso,
            position,
          })
        } else if (isNightGuard && resolveGuardPosition(position, slotIndex) === 'capacity_exceeded') {
          // More names under the night guard label on this date than its
          // capacity — a real crew-size mismatch, kept in the output (never
          // omitted to fit) and flagged for a human to resolve.
          warnings.push({
            kind: 'position_capacity_mismatch',
            message: `שיבוץ "${position}" (${workDateIso}) חורג ממספר המקומות הידוע (${NIGHT_GUARD_ROLE.maxCapacity}) — נדרשת בדיקה לפני פרסום.`,
            work_date: workDateIso,
            position,
          })
        }

        slotIndex += 1
      }
    }
  }

  return {
    assignments,
    warnings,
    excludedSectionsSeen: Array.from(excludedSectionsSeen),
    summary: { included: assignments.length, excluded: Array.from(excludedCounts.values()), emptyCells },
  }
}
