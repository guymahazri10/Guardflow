export type ShiftCategory = 'morning' | 'afternoon' | 'night'

export type ActiveShift = {
  category: ShiftCategory
  label: string
  startTime: string
  endTime: string
  shiftIds: string[]
}

const SHIFT_CONFIG: Record<ShiftCategory, Omit<ActiveShift, 'category'>> = {
  morning: {
    label: 'משמרת בוקר',
    startTime: '07:00',
    endTime: '15:00',
    shiftIds: ['morning_6', 'morning_5'],
  },
  afternoon: {
    label: 'משמרת צהריים',
    startTime: '15:00',
    endTime: '23:00',
    shiftIds: ['afternoon_4', 'afternoon_3'],
  },
  night: {
    label: 'משמרת לילה',
    startTime: '23:00',
    endTime: '07:00',
    shiftIds: ['night'],
  },
}

export function getActiveShift(now: Date = new Date()): ActiveShift {
  const hour = now.getHours()
  const category: ShiftCategory =
    hour >= 7 && hour < 15 ? 'morning' : hour >= 15 && hour < 23 ? 'afternoon' : 'night'

  return {
    category,
    ...SHIFT_CONFIG[category],
  }
}
