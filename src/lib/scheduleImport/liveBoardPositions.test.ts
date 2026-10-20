import { describe, it, expect } from 'vitest'
import {
  allKnownPositionsForCategory,
  getImportPositionForSlot,
  getImportSlotTargets,
  guardCountFromCols,
} from './liveBoardPositions'
import { CANONICAL_POSITIONS, NIGHT_GUARD_LABEL } from './positions'

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

  // The one-guard night variant (shift_types guard_count=1): its sole slot
  // is a role (the night board's own rotation), not one of the two-guard
  // board's fixed לובי posts — see positions.ts's NIGHT_GUARD_LABEL.
  it('maps the one-guard night variant\'s sole slot to the night solo-guard role label, not a לובי post', () => {
    expect(getImportPositionForSlot('night', 'מאבטח 1', 1)).toBe(NIGHT_GUARD_LABEL)
    // No second slot exists for this variant.
    expect(getImportPositionForSlot('night', 'מאבטח 2', 1)).toBeNull()
  })

  // אחמ"ש is never affected by a guard-count override — it's resolved before
  // any slot-number/guard-count logic runs at all.
  it('keeps אחמ"ש mapped the same regardless of guardCount', () => {
    expect(getImportPositionForSlot('night', 'אחמ"ש', 1)).toBe('אחמ"ש')
    expect(getImportPositionForSlot('night', 'אחמ"ש', 2)).toBe('אחמ"ש')
  })

  // The two-guard night board (guard_count=2, the one already "on air")
  // must keep its existing mapping byte-for-byte — adding the one-guard
  // override must never retroactively change it.
  it('leaves the two-guard night variant\'s mapping unchanged', () => {
    expect(getImportPositionForSlot('night', 'מאבטח 1', 2)).toBe('לובי עליון')
    expect(getImportPositionForSlot('night', 'מאבטח 2', 2)).toBe('לובי תחתון')
  })

  // Omitting guardCount entirely (every pre-existing call site before this
  // change) must behave exactly as before — the category-wide default list.
  it('falls back to the category-wide default list when guardCount is omitted', () => {
    expect(getImportPositionForSlot('night', 'מאבטח 1')).toBe('לובי עליון')
    expect(getImportPositionForSlot('night', 'מאבטח 2')).toBe('לובי תחתון')
  })

  // A guard count with no specific override (any count other than the one
  // known 1-guard night exception) must not invent a mapping — it falls
  // back to the same category-wide default, never an arbitrary guess.
  it('falls back to the category-wide default for a guard count with no override', () => {
    expect(getImportPositionForSlot('night', 'מאבטח 1', 3)).toBe('לובי עליון')
    expect(getImportPositionForSlot('morning', 'מאבטח 1', 1)).toBe('לובי עליון')
  })
})

describe('guardCountFromCols', () => {
  it('counts מאבטח columns only, excluding אחמ"ש', () => {
    expect(guardCountFromCols(['אחמ"ש', 'מאבטח 1'])).toBe(1)
    expect(guardCountFromCols(['אחמ"ש', 'מאבטח 1', 'מאבטח 2'])).toBe(2)
  })

  it('accepts the alternate אחמ"ש quote mark', () => {
    expect(guardCountFromCols(['אחמ״ש', 'מאבטח 1'])).toBe(1)
  })
})

describe('allKnownPositionsForCategory', () => {
  it('includes the night solo-guard role label alongside the two-guard board\'s fixed posts', () => {
    const positions = allKnownPositionsForCategory('night')
    expect(positions).toEqual(expect.arrayContaining(['לובי עליון', 'לובי תחתון', NIGHT_GUARD_LABEL]))
    expect(new Set(positions).size).toBe(positions.length) // no duplicates
  })

  it('leaves morning/afternoon unchanged (no variant override exists for them)', () => {
    expect(allKnownPositionsForCategory('morning')).toEqual(['לובי עליון', 'לובי תחתון', 'AB', 'CD', 'EFG', 'רכוב'])
    expect(allKnownPositionsForCategory('afternoon')).toEqual(['AB', 'CD', 'EFG', 'רכוב'])
  })
})

describe('getImportSlotTargets', () => {
  it('maps night slot 1 and 2 to separate slot_index of the night guard role (after the legacy לובי posts)', () => {
    expect(getImportSlotTargets('night', 'מאבטח 1', 2)).toEqual([
      { position: 'לובי עליון' },
      { position: NIGHT_GUARD_LABEL, slotIndex: 0 },
    ])
    expect(getImportSlotTargets('night', 'מאבטח 2', 2)).toEqual([
      { position: 'לובי תחתון' },
      { position: NIGHT_GUARD_LABEL, slotIndex: 1 },
    ])
  })

  it('maps the one-guard night variant to slot_index 0 only', () => {
    expect(getImportSlotTargets('night', 'מאבטח 1', 1)).toEqual([{ position: NIGHT_GUARD_LABEL, slotIndex: 0 }])
  })

  it('has no night-guard target past the role capacity', () => {
    expect(getImportSlotTargets('night', 'מאבטח 3', 3)).toEqual([])
  })

  it('leaves day shifts and the commander as position-only targets', () => {
    expect(getImportSlotTargets('morning', 'מאבטח 3', 6)).toEqual([{ position: 'AB' }])
    expect(getImportSlotTargets('night', 'אחמ"ש')).toEqual([{ position: 'אחמ"ש' }])
  })
})
