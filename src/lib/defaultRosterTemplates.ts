import type { RosterBoardRow } from './rosterBoards'

export type DefaultRosterTemplate = {
  shift_id: 'morning_6' | 'morning_5' | 'afternoon_3' | 'afternoon_4' | 'night'
  shift_type: 'morning' | 'afternoon' | 'night'
  label: string
  subLabel: string
  hours: string
  cols: string[]
  rows: RosterBoardRow[]
  notes: string | null
}

type RawDefaultRosterTemplate = Omit<DefaultRosterTemplate, 'rows'> & {
  timeBlocks: string[]
  positions: Record<string, string[]>
}

const RAW_DEFAULT_ROSTER_TEMPLATES: RawDefaultRosterTemplate[] = [
  {
    shift_id: 'morning_6',
    shift_type: 'morning',
    label: 'בוקר 6',
    subLabel: 'תבנית בוקר מלאה לשישה תפקידים',
    hours: '07:00-15:00',
    cols: ['שער ראשי', 'שער רכבים', 'לובי', 'סיור', 'חמ״ל', 'גיבוי'],
    timeBlocks: ['07:00', '09:00', '11:00', '13:00', '15:00'],
    positions: {
      'שער ראשי': ['שער ראשי', 'שער ראשי', 'שער ראשי', 'שער ראשי'],
      'שער רכבים': ['שער רכבים', 'שער רכבים', 'שער רכבים', 'שער רכבים'],
      לובי: ['לובי', 'לובי', 'לובי', 'לובי'],
      סיור: ['סיור', 'סיור', 'סיור', 'סיור'],
      'חמ״ל': ['חמ״ל', 'חמ״ל', 'חמ״ל', 'חמ״ל'],
      גיבוי: ['גיבוי', 'גיבוי', 'גיבוי', 'גיבוי'],
    },
    notes: 'תבנית ברירת מחדל למשמרת בוקר עם שישה תפקידים.',
  },
  {
    shift_id: 'morning_5',
    shift_type: 'morning',
    label: 'בוקר 5',
    subLabel: 'תבנית בוקר מצומצמת לחמישה תפקידים',
    hours: '07:00-15:00',
    cols: ['שער ראשי', 'שער רכבים', 'לובי', 'סיור', 'חמ״ל'],
    timeBlocks: ['07:00', '09:00', '11:00', '13:00', '15:00'],
    positions: {
      'שער ראשי': ['שער ראשי', 'שער ראשי', 'שער ראשי', 'שער ראשי'],
      'שער רכבים': ['שער רכבים', 'שער רכבים', 'שער רכבים', 'שער רכבים'],
      לובי: ['לובי', 'לובי', 'לובי', 'לובי'],
      סיור: ['סיור', 'סיור', 'סיור', 'סיור'],
      'חמ״ל': ['חמ״ל', 'חמ״ל', 'חמ״ל', 'חמ״ל'],
    },
    notes: 'תבנית ברירת מחדל למשמרת בוקר עם חמישה תפקידים.',
  },
  {
    shift_id: 'afternoon_4',
    shift_type: 'afternoon',
    label: 'צהריים 4',
    subLabel: 'תבנית צהריים לארבעה תפקידים',
    hours: '15:00-23:00',
    cols: ['שער ראשי', 'שער רכבים', 'סיור', 'חמ״ל'],
    timeBlocks: ['15:00', '17:00', '19:00', '21:00', '23:00'],
    positions: {
      'שער ראשי': ['שער ראשי', 'שער ראשי', 'שער ראשי', 'שער ראשי'],
      'שער רכבים': ['שער רכבים', 'שער רכבים', 'שער רכבים', 'שער רכבים'],
      סיור: ['סיור', 'סיור', 'סיור', 'סיור'],
      'חמ״ל': ['חמ״ל', 'חמ״ל', 'חמ״ל', 'חמ״ל'],
    },
    notes: 'תבנית ברירת מחדל למשמרת צהריים עם ארבעה תפקידים.',
  },
  {
    shift_id: 'afternoon_3',
    shift_type: 'afternoon',
    label: 'צהריים 3',
    subLabel: 'תבנית צהריים לשלושה תפקידים',
    hours: '15:00-23:00',
    cols: ['שער ראשי', 'סיור', 'חמ״ל'],
    timeBlocks: ['15:00', '17:00', '19:00', '21:00', '23:00'],
    positions: {
      'שער ראשי': ['שער ראשי', 'שער ראשי', 'שער ראשי', 'שער ראשי'],
      סיור: ['סיור', 'סיור', 'סיור', 'סיור'],
      'חמ״ל': ['חמ״ל', 'חמ״ל', 'חמ״ל', 'חמ״ל'],
    },
    notes: 'תבנית ברירת מחדל למשמרת צהריים עם שלושה תפקידים.',
  },
  {
    shift_id: 'night',
    shift_type: 'night',
    label: 'לילה',
    subLabel: 'תבנית לילה בסיסית',
    hours: '23:00-07:00',
    cols: ['שער ראשי', 'סיור', 'חמ״ל'],
    timeBlocks: ['23:00', '01:00', '03:00', '05:00', '07:00'],
    positions: {
      'שער ראשי': ['שער ראשי', 'שער ראשי', 'שער ראשי', 'שער ראשי'],
      סיור: ['סיור', 'סיור', 'סיור', 'סיור'],
      'חמ״ל': ['חמ״ל', 'חמ״ל', 'חמ״ל', 'חמ״ל'],
    },
    notes: 'תבנית ברירת מחדל למשמרת לילה.',
  },
]

function mapRawTemplate(template: RawDefaultRosterTemplate): DefaultRosterTemplate {
  const rowTimes = template.timeBlocks.slice(0, -1)

  return {
    shift_id: template.shift_id,
    shift_type: template.shift_type,
    label: template.label,
    subLabel: template.subLabel,
    hours: template.hours,
    cols: template.cols,
    rows: rowTimes.map((time, rowIndex) => ({
      time,
      cells: template.cols.reduce<Record<string, string>>((cells, col) => {
        return {
          ...cells,
          [col]: template.positions[col]?.[rowIndex] ?? '',
        }
      }, {}),
    })),
    notes: template.notes,
  }
}

export const DEFAULT_ROSTER_TEMPLATES = RAW_DEFAULT_ROSTER_TEMPLATES.map(mapRawTemplate)

export function findDefaultRosterTemplateByShiftId(shiftId: string) {
  return DEFAULT_ROSTER_TEMPLATES.find((template) => template.shift_id === shiftId) ?? null
}
