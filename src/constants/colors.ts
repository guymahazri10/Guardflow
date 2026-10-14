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
  לובי: '#D2A85C',
  סריקה: '#5f9e72',
  פרימטר: '#5f9e72',
  כונן: '#9868b8',
  הפסקה: '#7C838C',
  הפסקת: '#7C838C',
  'שובר שגרה': '#d6823f',
  חילוף: '#3f9aa8',
  סגירה: '#4f7fc4',
  'עמדה חיצונית': '#c1613f',
  כיכר: '#c1613f',
  ניהול: '#1B56A5',
  ביקורות: '#1B56A5',
};

/**
 * Real position text is long and descriptive (e.g. "כונן - לובי תחתון"), not a
 * bare keyword — so match by substring. When more than one keyword appears
 * (as above), pick whichever one appears earliest in the text rather than
 * whichever key happens to come first in POSITION_COLORS — otherwise a
 * "כונן" duty that mentions "לובי" in passing would wrongly render as לובי.
 */
export function getPositionColor(position: string): string {
  let bestIndex = Infinity;
  let bestColor: string | null = null;

  for (const [keyword, color] of Object.entries(POSITION_COLORS)) {
    const index = position.indexOf(keyword);
    if (index !== -1 && index < bestIndex) {
      bestIndex = index;
      bestColor = color;
    }
  }

  return bestColor ?? '#6b7280';
}

/**
 * Readable text color for a position pill: the position hue pulled 55% toward the
 * near-black text color. The raw hue on its own 22% tint is only 1.9-3.2:1 for most
 * positions; this lands every one of them above 5.8:1 while keeping a trace of the
 * hue. The hue itself is carried by the tint, the border and the dot in GuardCard.
 */
const TEXT_PRIMARY_HEX = '#15171A';
const POSITION_TEXT_WEIGHT = 0.55;

function readableTextOn(hex: string): string {
  const parse = (value: string) => {
    const v = value.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(v.substring(i, i + 2), 16));
  };
  const [r, g, b] = parse(hex);
  const [tr, tg, tb] = parse(TEXT_PRIMARY_HEX);
  const mix = (base: number, dark: number) => Math.round(POSITION_TEXT_WEIGHT * dark + (1 - POSITION_TEXT_WEIGHT) * base);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(r, tr))}${toHex(mix(g, tg))}${toHex(mix(b, tb))}`;
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
    return { color: readableTextOn(base), backgroundColor: 'transparent', borderColor: hexToRgba(base, 0.5) };
  }
  return {
    color: readableTextOn(base),
    backgroundColor: hexToRgba(base, 0.22),
    borderColor: 'transparent',
  };
}
