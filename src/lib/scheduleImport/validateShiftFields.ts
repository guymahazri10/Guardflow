/**
 * Field-level validation shared by every import path (Excel, image, JSON).
 * Each check here used to live only inside normalizeExtracted.ts (the image
 * path) — the Excel path (normalizeSchedule.ts) skipped hour-range and
 * calendar-date validation entirely, so a garbled cell could silently
 * produce a nonsensical shift instead of a skipped-row warning. Pulling
 * these into one module means all three paths reject the same bad input
 * the same way, rather than drifting as each gets patched independently.
 */

/** Hour/minute pair as read off a cell — rejects anything a clock can't show. */
export function isValidHourRange(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

/**
 * True calendar-date validity for a (year, month, day) triple — rejects
 * "February 30" style values that a naive regex-on-format check lets through.
 * Constructs the UTC date and checks it didn't roll over into a different
 * day/month than requested.
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Rejects a zero-length or inverted shift — starts_at/ends_at are ISO instants. */
export function hasPositiveDuration(startsAtIso: string, endsAtIso: string): boolean {
  const startsAt = new Date(startsAtIso).getTime()
  const endsAt = new Date(endsAtIso).getTime()
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt
}
