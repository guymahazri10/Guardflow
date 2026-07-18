import { toShiftMinutes } from '../hooks/useClock'
import type { RosterBoardRow } from './rosterBoards'

function nowAsShiftMinutes(now: Date, isNight: boolean): number {
  return toShiftMinutes(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, isNight)
}

/** The last row whose start time has already passed (falls back to the first row). */
export function getCurrentBlock(rows: RosterBoardRow[], now: Date, isNight: boolean): RosterBoardRow | null {
  if (!rows?.length) return null
  const nowMins = nowAsShiftMinutes(now, isNight)
  let current: RosterBoardRow | null = null
  for (const row of rows) {
    if (toShiftMinutes(row.time, isNight) <= nowMins) current = row
  }
  return current ?? rows[0]
}

/** The row scheduled to start right after `current`, or null if `current` is the last block. */
export function getNextBlock(
  rows: RosterBoardRow[],
  current: RosterBoardRow | null,
  isNight: boolean,
): RosterBoardRow | null {
  if (!rows?.length || !current) return null
  const sorted = [...rows].sort((a, b) => toShiftMinutes(a.time, isNight) - toShiftMinutes(b.time, isNight))
  const idx = sorted.findIndex((row) => row.time === current.time)
  if (idx === -1 || idx === sorted.length - 1) return null
  return sorted[idx + 1]
}

export function minutesUntilBlockStart(row: RosterBoardRow, now: Date, isNight: boolean): number {
  return toShiftMinutes(row.time, isNight) - nowAsShiftMinutes(now, isNight)
}
