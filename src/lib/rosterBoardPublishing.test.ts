import { describe, it, expect } from 'vitest'
import { siblingUnpublishFilter } from './rosterBoardPublishing'

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
