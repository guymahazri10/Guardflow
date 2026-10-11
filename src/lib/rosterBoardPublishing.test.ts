import { describe, it, expect } from 'vitest'
import { shouldPublishOnSave, siblingUnpublishFilter } from './rosterBoardPublishing'

describe('siblingUnpublishFilter', () => {
  it('retires siblings in the same category when a board is published', () => {
    const board = { id: '489f7b8e', shift_type: 'morning', published: true }
    expect(siblingUnpublishFilter(board)).toEqual({
      shiftType: 'morning',
      excludeBoardId: '489f7b8e',
    })
  })

  it('does nothing when the board is being unpublished — only publishing retires siblings', () => {
    const board = { id: 'bfff67f9', shift_type: 'morning', published: false }
    expect(siblingUnpublishFilter(board)).toBeNull()
  })

  it('scopes to the published board\'s own shift_type, never a hardcoded category', () => {
    const night = siblingUnpublishFilter({ id: 'n1', shift_type: 'night', published: true })
    expect(night?.shiftType).toBe('night')
  })
})

describe('shouldPublishOnSave', () => {
  const morning6 = { id: 'm6', shift_type: 'morning', published: true }

  it('publishes a staffed variant that is not live yet', () => {
    expect(shouldPublishOnSave({ ...morning6, published: false }, [], true)).toBe(true)
  })

  // Production state on 2026-10-11: morning_6 (staffed) and morning_5 (empty)
  // were both published, and the live screen showed the empty one.
  it('republishes when another variant in the same category is also published', () => {
    const published = [morning6, { id: 'm5', shift_type: 'morning' }]
    expect(shouldPublishOnSave(morning6, published, true)).toBe(true)
  })

  it('skips the write when this board is already the only live one in its category', () => {
    const published = [morning6, { id: 'a4', shift_type: 'afternoon' }]
    expect(shouldPublishOnSave(morning6, published, true)).toBe(false)
  })

  it('publishes when the published list is not known yet — the write is idempotent', () => {
    expect(shouldPublishOnSave(morning6, undefined, true)).toBe(true)
  })

  it('never publishes a board with no columns/rows to show', () => {
    expect(shouldPublishOnSave({ ...morning6, published: false }, [], false)).toBe(false)
  })
})
