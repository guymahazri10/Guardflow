import { describe, expect, it } from 'vitest'
import { POSITION_COLORS, getPositionBadgeStyle } from './colors'

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
