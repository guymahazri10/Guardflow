export const COLORS = {
  primary: '#116dff',
  primaryDark: '#0d55cc',
  primaryLight: '#e8f0ff',
  surface: '#ffffff',
  background: '#f4f6fb',
  border: '#e5e9f2',
  textPrimary: '#111827',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',

  shift: {
    morning: '#f59e0b',
    afternoon: '#3b82f6',
    night: '#6366f1',
  },
} as const;

// Position → badge color mapping (Hebrew position names)
// Distinct pastel-strong hues — clear enough to tell positions apart at a glance
// even before anyone's assigned. See design.md "פלטת עמדות".
export const POSITION_COLORS: Record<string, string> = {
  לובי: '#c99a4f',
  סריקה: '#5f9e72',
  פרימטר: '#5f9e72',
  כונן: '#9868b8',
  הפסקה: '#a89c8a',
  הפסקת: '#a89c8a',
  'שובר שגרה': '#d6823f',
  חילוף: '#3f9aa8',
  סגירה: '#4f7fc4',
  'עמדה חיצונית': '#c1613f',
  כיכר: '#c1613f',
  ניהול: '#1B56A5',
  ביקורות: '#1B56A5',
};

/** Real position text is long and descriptive (e.g. "סריקת לובי תחתון + CD
 *  פרימטר"), not a bare keyword — so match by substring, not exact key. */
export function getPositionColor(position: string): string {
  const match = Object.entries(POSITION_COLORS).find(([keyword]) => position.includes(keyword));
  return match ? match[1] : '#6b7280';
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type PositionBadgeStyle = {
  color: string;
  backgroundColor: string;
  borderColor: string;
};

/**
 * Tinted pill style (text/bg/border) derived from the same base color as getPositionColor.
 * `assigned` encodes whether a guard is actually filled in, not just the position: a filled
 * tint means "someone's here", a plain outline means "open slot" — the shape/fill carries the
 * state, not color alone (see design.md "תג הקצאה").
 */
export function getPositionBadgeStyle(position: string, assigned = true): PositionBadgeStyle {
  const base = getPositionColor(position);
  if (!assigned) {
    // Still tinted by position — an empty slot for "כונן" should read differently
    // from an empty "לובי" slot. Fill vs. outline carries the assigned/open state.
    return { color: base, backgroundColor: 'transparent', borderColor: hexToRgba(base, 0.5) };
  }
  return {
    color: base,
    backgroundColor: hexToRgba(base, 0.22),
    borderColor: 'transparent',
  };
}
