import type { ExtractedAssignment } from './normalizeExtracted'
import { CANONICAL_POSITIONS, NIGHT_GUARD_LABEL } from './positions'
import { parseExplicitCategory } from './assignmentTime'

/**
 * Adapts a "day-grouped" JSON schedule — the shape a general-purpose AI
 * naturally produces when asked to digitize a schedule screenshot without
 * being given our exact flat schema — into the flat ExtractedAssignment[]
 * shape normalizeExtractedAssignments expects.
 *
 * Found live: a manager converted a screenshot with their own AI tool and
 * got back `{ days: [{ date, assignments: [{ area, role, start, end,
 * employee | employees }] }] }` instead of the flat schema the in-app
 * prompt asks for. Rather than rejecting it and asking for a re-conversion,
 * this understands it directly — the nested-by-day shape is genuinely a
 * reasonable, less repetitive structure for something hand- or
 * AI-authored, so both shapes are accepted going forward.
 */
export function looksLikeDayGroupedSchedule(value: unknown): value is { days: unknown[] } {
  return !!value && typeof value === 'object' && Array.isArray((value as { days?: unknown }).days)
}


export type DayGroupedAdaptResult = {
  records: ExtractedAssignment[]
  /** Plain-text notes about rows that were skipped or only guessed at —
   *  surfaced as parse warnings in the preview, same as any other
   *  low-confidence row from the image path. */
  warnings: string[]
}

function normalizeArea(area: string): string {
  return area.replace(/["'׳״]/g, '"').trim()
}

/**
 * Converts one day's worth of raw assignment entries. `referenceYear` is a
 * placeholder only — the date this schedule's headers carry has no year at
 * all ("09-06"), and normalizeExtractedAssignments's own anchorYear always
 * re-derives the real year from the import's reference date regardless of
 * what year is embedded in the date string, so any 4-digit value works here.
 */
function adaptDay(
  dateMmDd: string,
  isoDate: string,
  assignmentsRaw: unknown[],
  warnings: string[],
): ExtractedAssignment[] {
  const records: ExtractedAssignment[] = []

  for (const entryRaw of assignmentsRaw) {
    if (!entryRaw || typeof entryRaw !== 'object') continue
    const entry = entryRaw as Record<string, unknown>

    const area = typeof entry.area === 'string' ? entry.area : ''
    const role = typeof entry.role === 'string' ? entry.role : ''
    const start = typeof entry.start === 'string' ? entry.start : null
    const end = typeof entry.end === 'string' ? entry.end : null

    const names: string[] = Array.isArray(entry.employees)
      ? entry.employees.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      : typeof entry.employee === 'string' && entry.employee.trim().length > 0
        ? [entry.employee]
        : []

    // An unstaffed slot (null employee/hours) is normal in the source
    // table, not an error — same convention as normalizeExtractedAssignments.
    if (names.length === 0 || !start || !end) continue

    const rowLabel = `${dateMmDd} · ${role || '?'}`
    const normalizedArea = normalizeArea(area)

    // The shift the source itself states: an explicit field if the JSON has
    // one, otherwise the period word in the free-text role ("בוקר מאבטח AB").
    // Left undefined when neither names one — normalizeExtractedAssignments
    // then falls back to the hours and flags the guess.
    const shiftSource = [entry.shift, entry.shift_category, entry.category, role]
      .map((v) => parseExplicitCategory(v))
      .find((v) => v !== null)
    const shift = shiftSource ?? undefined

    if (normalizedArea === 'אחמ"ש') {
      for (const name of names) {
        records.push({ date: isoDate, worker_kind: 'אחמ"ש', position: 'אחמ"ש', start, end, name, shift })
      }
      continue
    }

    // Control and the absence groups are carried through as their own kind so
    // the normalizer can count and exclude them with a reason.
    if (['בקרה', 'היעדרויות', 'חופש', 'מחלה', 'מילואים', 'קורס', 'לימודים', 'תגבור'].includes(normalizedArea)) {
      for (const name of names) {
        records.push({ date: isoDate, worker_kind: normalizedArea, position: role, start, end, name, shift })
      }
      continue
    }

    if (normalizedArea !== 'מאבטח') {
      warnings.push(`שורה דולגה (${rowLabel}): סוג עובד לא מזוהה "${area}".`)
      continue
    }

    // The free-text role embeds the position inconsistently ("בוקר מאבטח
    // לובי עליון - חמוש", "מאבטח רכוב בוקר", "צהריים מאבטח AB") — rather
    // than parsing word order, just check which canonical position name
    // appears anywhere in it. None of the six positions are substrings of
    // each other, so this can't cross-match.
    const found = CANONICAL_POSITIONS['מאבטח'].find((p) => role.includes(p))

    if (found) {
      for (const name of names) {
        records.push({ date: isoDate, worker_kind: 'מאבטח', position: found, start, end, name, shift })
      }
      continue
    }

    // "לילה מאבטח": the night guards are one role with up to two names, not
    // two physical posts — so every name is kept under that role, in order
    // (slot_index 0, 1). Nothing is guessed. A third name is flagged by the
    // normalizer as a capacity mismatch rather than dropped here.
    if (role.includes('לילה')) {
      for (const name of names) {
        records.push({ date: isoDate, worker_kind: 'מאבטח', position: NIGHT_GUARD_LABEL, start, end, name, shift: shift ?? 'night' })
      }
      continue
    }

    warnings.push(`שורה דולגה (${rowLabel}): לא זוהתה עמדה מוכרת בטקסט "${role}".`)
  }

  return records
}

export function adaptDayGroupedSchedule(
  value: { days: unknown[] },
  referenceYear: number,
): DayGroupedAdaptResult {
  const records: ExtractedAssignment[] = []
  const warnings: string[] = []

  for (const dayRaw of value.days) {
    if (!dayRaw || typeof dayRaw !== 'object') continue
    const day = dayRaw as Record<string, unknown>

    const dateMmDd = typeof day.date === 'string' ? day.date.trim() : ''
    const match = /^(\d{2})-(\d{2})$/.exec(dateMmDd)
    if (!match) {
      warnings.push(`יום דולג: תאריך לא תקין "${dateMmDd || '?'}".`)
      continue
    }
    const isoDate = `${referenceYear}-${match[1]}-${match[2]}`

    const assignmentsRaw = Array.isArray(day.assignments) ? day.assignments : []
    records.push(...adaptDay(dateMmDd, isoDate, assignmentsRaw, warnings))
  }

  return { records, warnings }
}
