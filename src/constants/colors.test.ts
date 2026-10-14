import { describe, expect, it } from 'vitest'
import { POSITION_COLORS, getPositionBadgeStyle, getPositionColor } from './colors'

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: number[]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function parseHex(hex: string): number[] {
  const v = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.substring(i, i + 2), 16))
}

function parseRgba(value: string): number[] {
  const m = value.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)
  if (!m) throw new Error(`unexpected color: ${value}`)
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
}

function over(white: number[], tint: number[]): number[] {
  const alpha = tint[3]
  return [0, 1, 2].map((i) => Math.round(tint[i] * alpha + white[i] * (1 - alpha)))
}

describe('position badge text contrast', () => {
  const WHITE = [255, 255, 255]
  const samples = [...Object.keys(POSITION_COLORS), 'עמדה לא מוכרת']

  it.each(samples)('assigned pill text for "%s" reads at 4.5:1 or better on its tint', (position) => {
    const style = getPositionBadgeStyle(position, true)
    const background = over(WHITE, parseRgba(style.backgroundColor))
    expect(contrast(parseHex(style.color), background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(samples)('open-slot pill text for "%s" reads at 4.5:1 or better on white', (position) => {
    const style = getPositionBadgeStyle(position, false)
    expect(contrast(parseHex(style.color), WHITE)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('position color groups', () => {
  const GREEN = '#5f9e72'
  const GOLD = '#D2A85C'
  const SKY = '#2A9FC4'
  const PURPLE = '#9868b8'
  const ROSE = '#c9577a'
  const GRAY = '#7C838C'

  it.each([
    ['סריקת חניונים רכובה', GREEN],
    ['סריקה', GREEN],
    ['סגירת קמפוס', GREEN],
    ['פתיחת קמפוס', GREEN],
    ['לובי עליון', GOLD],
    ['לובי תחתון', GOLD],
    ['עמדת קבלה', GOLD],
    ['עמדת כיכר', GOLD],
    ['שובר שגרה', SKY],
    ['אבטחת עובדים', SKY],
    ['כונן - חדר תדריכים', PURPLE],
    ['הפסקת אוכל', ROSE],
  ])('"%s" gets its group color', (position, color) => {
    expect(getPositionColor(position)).toBe(color)
  })

  it('keeps the setup task for the reception post gray', () => {
    expect(getPositionColor('סידור עמדת קבלה + תדריך')).toBe(GRAY)
  })

  it('uses the earliest keyword, so a standby duty is purple even if it mentions the lobby', () => {
    expect(getPositionColor('כונן - לובי תחתון')).toBe(PURPLE)
  })

  it('leaves the commander inspections blue and unlisted posts gray', () => {
    expect(getPositionColor('ביקורות עמדה + רכב')).toBe('#1B56A5')
    expect(getPositionColor('עמדה חיצונית')).toBe(GRAY)
    expect(getPositionColor('משהו לא מוכר')).toBe(GRAY)
  })
})
