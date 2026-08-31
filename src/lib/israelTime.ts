// GuardFlow is an Israel-only, single-timezone organization, but the app has
// no timezone library dependency. This is a small, self-contained helper for
// the two things that need to be *correct* (not just consistent) about
// Asia/Jerusalem local time: converting a local wall-clock time to the real
// UTC instant it represents (DST-aware — Israel observes DST, transitioning
// in spring/autumn), and reading "today" as the current local calendar date.
//
// The conversion algorithm is the standard technique used by libraries like
// date-fns-tz: guess a UTC instant, ask Intl what wall-clock time that
// instant reads as in the target zone, and correct the guess by the
// difference. Two iterations always converge because the UTC offset is
// piecewise-constant (it only changes at the DST transition instants
// themselves, which this loop does not cross in practice for a single
// day/time input).

const TIME_ZONE = 'Asia/Jerusalem'

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const hhmmFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
})

function readZonedParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = partsFormatter.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  // Intl can report hour '24' for midnight in some environments; normalize to 0.
  const hour = Number(map.hour) % 24
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/**
 * Converts a wall-clock date/time meant as Asia/Jerusalem local time into the
 * correct UTC instant, returned as an ISO 8601 string (e.g. "2026-09-06T03:00:00.000Z"
 * for 06:00 Israel time, which is UTC+3 in early September under DST).
 */
export function israelLocalToUtcIso(year: number, month: number, day: number, hour: number, minute: number): string {
  // Initial guess: treat the wall-clock values as if they were already UTC.
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)

  for (let i = 0; i < 2; i++) {
    const zoned = readZonedParts(new Date(guess))
    const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second)
    const target = Date.UTC(year, month - 1, day, hour, minute, 0)
    const diff = target - zonedAsUtc
    if (diff === 0) break
    guess += diff
  }

  return new Date(guess).toISOString()
}

/**
 * Returns `date`'s calendar date, in the JS runtime's own local timezone, as
 * YYYY-MM-DD. Deliberately NOT Intl/Asia-Jerusalem-based: this mirrors the
 * existing convention in useClock.ts/shiftBlocks.ts, which already read
 * plain local time throughout on the assumption that GuardFlow only runs on
 * devices physically in Israel. Use this (not `.toISOString().slice(0, 10)`,
 * which is UTC) anywhere a "today"/"this week" boundary needs to match what
 * the person looking at the screen would call today.
 */
export function toLocalDateIso(date: Date): string {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Formats a UTC ISO instant (e.g. a `starts_at`/`ends_at` value) as its
 * Asia/Jerusalem wall-clock "HH:MM", DST-aware. This is the inverse of
 * `israelLocalToUtcIso`'s conversion — use it anywhere a stored UTC instant
 * needs to be shown back to a manager as the local time they expect (e.g. a
 * schedule-import preview table), instead of `.toISOString().slice(11, 16)`,
 * which reads the UTC clock time, not Israel local time.
 */
export function utcIsoToIsraelHHMM(isoString: string): string {
  return hhmmFormatter.format(new Date(isoString))
}

/**
 * Shifts a YYYY-MM-DD calendar date by `days` (may be negative), returning
 * the result as YYYY-MM-DD. Pure calendar-date arithmetic — no timezone
 * conversion involved, since the input/output are already local dates (e.g.
 * `toLocalDateIso`'s output).
 */
export function addDaysIso(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  d.setDate(d.getDate() + days)
  return toLocalDateIso(d)
}
