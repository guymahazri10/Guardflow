import { describe, it, expect } from 'vitest'
import { getImportPositionForSlot } from './liveBoardPositions'
import { CANONICAL_POSITIONS } from './positions'

describe('getImportPositionForSlot', () => {
  it('maps אחמ"ש to the bare position regardless of shift type', () => {
    expect(getImportPositionForSlot('morning', 'אחמ"ש')).toBe('אחמ"ש')
    expect(getImportPositionForSlot('afternoon', 'אחמ"ש')).toBe('אחמ"ש')
    expect(getImportPositionForSlot('night', 'אחמ"ש')).toBe('אחמ"ש')
  })

  it('accepts a different Hebrew quote mark for אחמ"ש', () => {
    expect(getImportPositionForSlot('morning', 'אחמ״ש')).toBe('אחמ"ש')
  })

  // Exact mapping provided by the manager (2026-09) for the live boards'
  // real guard-slot columns.
  it('maps the morning shift slots in order', () => {
    expect(getImportPositionForSlot('morning', 'מאבטח 1')).toBe('לובי עליון')
    expect(getImportPositionForSlot('morning', 'מאבטח 2')).toBe('לובי תחתון')
    expect(getImportPositionForSlot('morning', 'מאבטח 3')).toBe('AB')
    expect(getImportPositionForSlot('morning', 'מאבטח 4')).toBe('CD')
    expect(getImportPositionForSlot('morning', 'מאבטח 5')).toBe('EFG')
    expect(getImportPositionForSlot('morning', 'מאבטח 6')).toBe('רכוב')
  })

  it('maps the afternoon shift slots in order', () => {
    expect(getImportPositionForSlot('afternoon', 'מאבטח 1')).toBe('AB')
    expect(getImportPositionForSlot('afternoon', 'מאבטח 2')).toBe('CD')
    expect(getImportPositionForSlot('afternoon', 'מאבטח 3')).toBe('EFG')
    expect(getImportPositionForSlot('afternoon', 'מאבטח 4')).toBe('רכוב')
  })

  it('maps the night shift slots in order', () => {
    expect(getImportPositionForSlot('night', 'מאבטח 1')).toBe('לובי עליון')
    expect(getImportPositionForSlot('night', 'מאבטח 2')).toBe('לובי תחתון')
  })

  // A smaller-crew board (e.g. morning_5, 5 מאבטח slots instead of 6) simply
  // gets the first N positions from the same ordered list — no separate
  // mapping needed per board variant.
  it('gives a smaller-crew board the first N positions, not the last N', () => {
    expect(getImportPositionForSlot('afternoon', 'מאבטח 3')).toBe('EFG')
  })

  // Every position this returns must be one isKnownPosition (positions.ts)
  // actually accepts — otherwise a matched slot's canonical position would
  // never appear in an import in the first place.
  it('never returns a position outside the canonical מאבטח list', () => {
    for (const shiftType of ['morning', 'afternoon', 'night'] as const) {
      for (let slot = 1; slot <= 6; slot++) {
        const position = getImportPositionForSlot(shiftType, `מאבטח ${slot}`)
        if (position !== null) {
          expect(CANONICAL_POSITIONS['מאבטח']).toContain(position)
        }
      }
    }
  })

  it('returns null for a slot beyond that shift type\'s crew size', () => {
    // afternoon only has 4 known slots
    expect(getImportPositionForSlot('afternoon', 'מאבטח 5')).toBeNull()
    // night only has 2 known slots
    expect(getImportPositionForSlot('night', 'מאבטח 3')).toBeNull()
  })

  it('returns null for an unrecognized shift type or slot label', () => {
    expect(getImportPositionForSlot('bogus', 'מאבטח 1')).toBeNull()
    expect(getImportPositionForSlot('morning', 'משהו אחר')).toBeNull()
    expect(getImportPositionForSlot('morning', 'מאבטח')).toBeNull()
  })
})
