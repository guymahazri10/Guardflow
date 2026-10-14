import { SHIFT_CATEGORIES, type ShiftCategory } from '../constants/shifts'

/**
 * How far through its fixed hours the shift is, from 0 (start) to 1 (end), by the device's
 * local clock (the same local time the live screen already reads everywhere else).
 * The night shift wraps midnight (23:00-07:00), so its end is moved to the next day.
 * Values outside the shift's hours clamp to 0 or 1.
 */
export function getShiftProgress(category: ShiftCategory, now: Date): number {
  const { startHour, endHour } = SHIFT_CATEGORIES[category]
  const startMin = startHour * 60
  let endMin = endHour * 60
  let nowMin = now.getHours() * 60 + now.getMinutes()

  if (endMin <= startMin) {
    endMin += 24 * 60
    if (nowMin < startMin) nowMin += 24 * 60
  }

  const progress = (nowMin - startMin) / (endMin - startMin)
  return Math.min(1, Math.max(0, progress))
}
