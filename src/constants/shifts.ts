export type ShiftCategory = 'morning' | 'afternoon' | 'night';

export interface ShiftConfig {
  id: string;
  label: string;
  category: ShiftCategory;
  startHour: number;
  endHour: number;
}

export const SHIFT_CATEGORIES: Record<ShiftCategory, { label: string; hours: string; startHour: number; endHour: number }> = {
  morning: { label: 'בוקר', hours: '07:00–15:00', startHour: 7, endHour: 15 },
  afternoon: { label: 'צהריים', hours: '15:00–23:00', startHour: 15, endHour: 23 },
  night: { label: 'לילה', hours: '23:00–07:00', startHour: 23, endHour: 7 },
};

export const SHIFTS: ShiftConfig[] = [
  { id: 'morning_6', label: 'בוקר 6 מאבטחים', category: 'morning', startHour: 7, endHour: 15 },
  { id: 'morning_5', label: 'בוקר 5 מאבטחים', category: 'morning', startHour: 7, endHour: 15 },
  { id: 'afternoon_4', label: 'צהריים 4 מאבטחים', category: 'afternoon', startHour: 15, endHour: 23 },
  { id: 'afternoon_3', label: 'צהריים 3 מאבטחים', category: 'afternoon', startHour: 15, endHour: 23 },
  { id: 'night', label: 'לילה 2 מאבטחים', category: 'night', startHour: 23, endHour: 7 },
];

export const SHIFT_IDS_BY_CATEGORY: Record<ShiftCategory, string[]> = {
  morning: ['morning_6', 'morning_5'],
  afternoon: ['afternoon_4', 'afternoon_3'],
  night: ['night'],
};

export function getActiveCategory(hour?: number): ShiftCategory {
  const h = hour ?? new Date().getHours();
  if (h >= 7 && h < 15) return 'morning';
  if (h >= 15 && h < 23) return 'afternoon';
  return 'night';
}

export function getShiftById(id: string): ShiftConfig | undefined {
  return SHIFTS.find((s) => s.id === id);
}

export function getShiftsByCategory(category: ShiftCategory): ShiftConfig[] {
  return SHIFTS.filter((s) => s.category === category);
}

/** Builds a ShiftConfig from a shift_types row (see useShiftTypes()) — fills
 *  in the derived label and the category's fixed hour boundaries. Once every
 *  page reads from useShiftTypes() instead of the static SHIFTS array
 *  (Task 9), this becomes the only way ShiftConfig objects get built. */
export function buildShiftConfig(row: { id: string; category: ShiftCategory; guard_count: number }): ShiftConfig {
  const catConfig = SHIFT_CATEGORIES[row.category];
  return {
    id: row.id,
    category: row.category,
    label: `${catConfig.label} ${row.guard_count} מאבטחים`,
    startHour: catConfig.startHour,
    endHour: catConfig.endHour,
  };
}

/** Strip the category name from a shift's label: "בוקר 6 מאבטחים" → "6 מאבטחים" */
export function getShiftShortLabel(shift: ShiftConfig): string {
  const cat = SHIFT_CATEGORIES[shift.category].label;
  const stripped = shift.label.replace(cat, '').trim();
  return stripped || shift.label;
}

/** "07:00–15:00" from startHour / endHour */
export function getShiftHoursLabel(shift: ShiftConfig): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(shift.startHour)}:00–${p(shift.endHour)}:00`;
}

/** Full display title for a shift, e.g. "משמרת בוקר" — except night, which
 *  keeps its existing "משמרת לילה / סופ"ש" wording (this shift also covers
 *  weekend day shifts, not just night, hence the suffix). */
export function getShiftFullTitle(shift: ShiftConfig): string {
  if (shift.category === 'night') {
    return 'משמרת לילה / סופ"ש'
  }
  return `משמרת ${SHIFT_CATEGORIES[shift.category].label}`
}
