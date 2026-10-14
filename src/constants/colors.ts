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

// Position → badge color mapping (Hebrew position names).
// One color per *kind* of post, so a guard can tell the kind at a glance even before
// anyone's assigned. Keywords are stems so one entry covers the variants
// ("סריק" matches סריקה / סריקת / סריקות). Anything not listed falls back to gray.
// See design.md "צבע — עמדות".
const GRAY = '#7C838C';
const GREEN = '#5f9e72'; // scans, opening and closing the campus
const GOLD = '#D2A85C'; // static posts: lobby, reception, square
const ORANGE = '#d6823f'; // employee security, routine breaker
const PURPLE = '#9868b8'; // standby
const ROSE = '#c9577a'; // meal break
const BLUE = '#1B56A5'; // management / the commander's inspections (unchanged)

export const POSITION_COLORS: Record<string, string> = {
  סריק: GREEN,
  סגיר: GREEN,
  פתיח: GREEN,
  פרימטר: GREEN,
  לובי: GOLD,
  קבלה: GOLD,
  כיכר: GOLD,
  'שובר שגרה': ORANGE,
  'אבטחת עובד': ORANGE,
  כונן: PURPLE,
  'הפסקת אוכל': ROSE,
  ניהול: BLUE,
  ביקורות: BLUE,
  // Explicitly gray: "סידור עמדת קבלה + תדריך" is a setup task, not the reception post itself,
  // and as the earliest keyword it wins over "קבלה" later in the text.
  סידור: GRAY,
  הפסקה: GRAY,
  הפסקת: GRAY,
};

/**
 * Real position text is long and descriptive (e.g. "כונן - לובי תחתון"), not a
 * bare keyword — so match by substring. When more than one keyword appears,
 * pick whichever one appears earliest in the text rather than whichever key
 * happens to come first in POSITION_COLORS — otherwise a "כונן" duty that
 * mentions "לובי" in passing would wrongly render as לובי. When two keywords
 * start at the same place, the longer one wins ("הפסקת אוכל" over "הפסקת").
 */
export function getPositionColor(position: string): string {
  let bestIndex = Infinity;
  let bestLength = 0;
  let bestColor: string | null = null;

  for (const [keyword, color] of Object.entries(POSITION_COLORS)) {
    const index = position.indexOf(keyword);
    if (index === -1) continue;
    if (index < bestIndex || (index === bestIndex && keyword.length > bestLength)) {
      bestIndex = index;
      bestLength = keyword.length;
      bestColor = color;
    }
  }

  return bestColor ?? GRAY;
}

/**
 * Readable text color for a position pill: the position hue pulled 55% toward the
 * near-black text color. The raw hue on its own 22% tint is only 1.9-3.2:1 for most
 * positions; this lands every one of them above 5.8:1 while keeping a trace of the
 * hue. The hue itself is carried by the tint, the border and the dot in GuardCard.
 */
const TEXT_PRIMARY_HEX = '#0C084A';
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
