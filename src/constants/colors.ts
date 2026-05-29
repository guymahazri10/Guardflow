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
  'שובר שגרה': '#f39c12',
  חילוף: '#0f766e',
  סגירה: '#0891b2',
  'עמדה חיצונית': '#b45309',
  כיכר: '#b45309',
  ניהול: '#116dff',
  ביקורות: '#116dff',
};

export function getPositionColor(position: string): string {
  return POSITION_COLORS[position] ?? '#6b7280';
}
