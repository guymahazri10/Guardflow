import type { ShiftCategory } from './types'
import { israelLocalToUtcIso } from '../israelTime'

// Deliberately NOT the same boundaries as src/constants/shifts.ts (07:00 /
// 15:00 / 23:00). Those describe the *clock windows* the live page uses to
// decide which shift is on air right now; these classify a shift by the hour
// it actually STARTS, and real shifts start in the 30-minute handover buffer
// before each canonical boundary — 06:30 or 06:45 (morning), 14:30 or 14:45
// (afternoon), 22:30 or 22:45 (night). Reusing the canonical boundaries here
// pushed every single row one category backwards (a 06:30 morning shift was
// filed as 'night', 14:30 afternoon as 'morning', 22:30 night as
// 'afternoon'), which also broke the live lookup, since shift_category is
// part of shift_assignments' uniqueness key and ShiftLivePage matches on it.
//
// The boundaries below sit in the empty gaps between the real start-time
// clusters (latest observed morning start 08:00, earliest afternoon 14:30;
// latest afternoon 14:45, earliest night 21:00), so each has hours of margin
// on both sides rather than sitting right on top of a cluster. Exceptional
// start times seen in real files — 08:00, 21:00 — land correctly.
const MORNING_START_HOUR = 5
const AFTERNOON_START_HOUR = 13
const NIGHT_START_HOUR = 21

export function classifyCategory(startHour: number): ShiftCategory {
  if (startHour >= MORNING_START_HOUR && startHour < AFTERNOON_START_HOUR) return 'morning'
  if (startHour >= AFTERNOON_START_HOUR && startHour < NIGHT_START_HOUR) return 'afternoon'
  return 'night'
}

/**
 * Converts a work date plus an Israel-local HH:MM range into the UTC instants
 * stored on shift_assignments, rolling the end past midnight when the shift
 * crosses it (a 22:30-07:00 night shift ends the following calendar day).
 *
 * `workDate` is the shift's START date — a night shift stays filed under the
 * day it began, which is the convention ShiftLivePage's lookup relies on.
 *
 * The HH:MM values are always Israel local time (GuardFlow is Israel-only),
 * so they go through the real Asia/Jerusalem offset (DST-aware) rather than
 * being stamped on as if they were already UTC.
 */
export function israelRangeToUtc(
  workDate: Date,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
): { starts_at: string; ends_at: string } {
  const toIso = (date: Date, hour: number, minute: number) =>
    israelLocalToUtcIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute)

  const starts_at = toIso(workDate, startHour, startMinute)

  const crossesMidnight = endHour < startHour || (endHour === startHour && endMinute < startMinute)
  const endDate = new Date(workDate)
  if (crossesMidnight) endDate.setUTCDate(endDate.getUTCDate() + 1)

  return { starts_at, ends_at: toIso(endDate, endHour, endMinute) }
}
