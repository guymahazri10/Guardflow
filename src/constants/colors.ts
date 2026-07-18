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
export const POSITION_COLORS: Record<string, string> = {
  לובי: '#e67e22',
  סריקה: '#27ae60',
  פרימטר: '#27ae60',
  כונן: '#8e44ad',
  הפסקה: '#7f8c8d',
  הפסקת: '#7f8c8d',
  'שובר שגרה': '#f39c12',
  חילוף: '#0f766e',
  סגירה: '#0891b2',
  'עמדה חיצונית': '#b45309',
  כיכר: '#b45309',
  ניהול: '#116dff',
  ביקורות: '#116dff',
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

/** Light tinted pill style (text/bg/border) derived from the same base color as getPositionColor. */
export function getPositionBadgeStyle(position: string): PositionBadgeStyle {
  const base = getPositionColor(position);
  return {
    color: base,
    backgroundColor: hexToRgba(base, 0.12),
    borderColor: hexToRgba(base, 0.35),
  };
}
