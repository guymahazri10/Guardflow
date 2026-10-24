import { describe, expect, it } from 'vitest'
import { nextMenuIndex } from './menuNavigation'

describe('nextMenuIndex', () => {
  it('moves with the arrows and wraps at both ends', () => {
    expect(nextMenuIndex(0, 'ArrowDown', 3)).toBe(1)
    expect(nextMenuIndex(2, 'ArrowDown', 3)).toBe(0)
    expect(nextMenuIndex(0, 'ArrowUp', 3)).toBe(2)
  })
  it('jumps with Home and End and ignores other keys', () => {
    expect(nextMenuIndex(1, 'Home', 3)).toBe(0)
    expect(nextMenuIndex(1, 'End', 3)).toBe(2)
    expect(nextMenuIndex(1, 'a', 3)).toBe(1)
  })
  it('has nowhere to go in an empty menu', () => {
    expect(nextMenuIndex(0, 'ArrowDown', 0)).toBe(-1)
  })
})
