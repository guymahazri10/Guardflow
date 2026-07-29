export type ShiftCategory = 'morning' | 'afternoon' | 'night';

export interface ShiftConfig {
  id: string;
  label: string;
  category: ShiftCategory;
  startHour: number;
  endHour: number;
  color: string;
  emoji: string;
}

export const SHIFT_CATEGORIES: Record<ShiftCategory, { label: string; color: string; hours: string }> = {
  morning: { label: 'בוקר', color: '#f59e0b', hours: '07:00–15:00' },
  afternoon: { label: 'צהריים', color: '#3b82f6', hours: '15:00–23:00' },
  night: { label: 'לילה', color: '#6366f1', hours: '23:00–07:00' },
};

export const SHIFTS: ShiftConfig[] = [
  {
    id: 'morning_6',
    label: 'בוקר 6 מאבטחים',
    category: 'morning',
    startHour: 7,
    endHour: 15,
    color: '#f59e0b',
    emoji: '🌅',
  },
  {
    id: 'morning_5',
    label: 'בוקר 5 מאבטחים',
    category: 'morning',
    startHour: 7,
    endHour: 15,
    color: '#f59e0b',
    emoji: '🌅',
  },
  {
    id: 'afternoon_4',
    label: 'צהריים 4 מאבטחים',
    category: 'afternoon',
    startHour: 15,
    endHour: 23,
    color: '#3b82f6',
    emoji: '🌤️',
  },
  {
    id: 'afternoon_3',
    label: 'צהריים 3 מאבטחים',
    category: 'afternoon',
    startHour: 15,
    endHour: 23,
    color: '#3b82f6',
    emoji: '🌤️',
  },
  {
    id: 'night',
    label: 'לילה 2 מאבטחים',
    category: 'night',
    startHour: 23,
    endHour: 7,
    color: '#6366f1',
    emoji: '🌙',
  },
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
