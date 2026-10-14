import { describe, it, expect } from 'vitest'
import { pickMostRecentlyTouchedBoard } from './activeBoardSelection'
import type { RosterBoard } from './rosterBoards'

function board(overrides: Partial<RosterBoard> = {}): RosterBoard {
  return {
    id: 'b1',
    shift_id: 'morning_6',
    shift_type: 'morning',
    cols: [],
    rows: [],
    notes: null,
    published: true,
    guard_names: {},
    created_by: null,
    created_at: '2026-07-30T12:32:19.475868+00:00',
    updated_at: '2026-07-30T12:32:19.475868+00:00',
    ...overrides,
  }
}

describe('pickMostRecentlyTouchedBoard', () => {
  it('returns null with no boards', () => {
    expect(pickMostRecentlyTouchedBoard([])).toBeNull()
  })

  it('returns the only board unchanged', () => {
    const only = board()
    expect(pickMostRecentlyTouchedBoard([only])).toBe(only)
  })

  // The exact production scenario: two morning variants (morning_5, morning_6)
  // both published, created in the same seeding batch (identical created_at),
  // so created_at alone can't break the tie. morning_6 is the one a manager
  // actually edited afterwards (guard_names saved a day later) — that's the
  // board the live screen must show, not whichever the DB places first.
  it('prefers the board with the more recent updated_at over one that merely ties on created_at', () => {
    const staleEmpty = board({
      id: 'bfff67f9-dd02-4cdb-bb48-2253ee1472ce',
      shift_id: 'morning_5',
      guard_names: {},
      updated_at: '2026-09-06T07:57:20.247059+00:00',
    })
    const editedByManager = board({
      id: '489f7b8e-4bfe-46e8-8e14-544276034acf',
      shift_id: 'morning_6',
      guard_names: { 'מאבטח 1': { name: 'איתמר אביטן', user_id: 'u1' } },
      updated_at: '2026-09-07T05:46:53.866526+00:00',
    })

    // Order in the input must not matter — this is what a non-deterministic
    // DB-side tie previously got wrong.
    expect(pickMostRecentlyTouchedBoard([staleEmpty, editedByManager])?.id).toBe(editedByManager.id)
    expect(pickMostRecentlyTouchedBoard([editedByManager, staleEmpty])?.id).toBe(editedByManager.id)
  })

  it('falls back to created_at, then id, when updated_at also ties — never ambiguous', () => {
    const a = board({ id: 'aaa', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
    const b = board({ id: 'bbb', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
    expect(pickMostRecentlyTouchedBoard([a, b])?.id).toBe('bbb')

    const c = board({ id: 'ccc', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
    const d = board({ id: 'ddd', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
    // Same result regardless of call, i.e. deterministic — not "whatever the
    // array happened to be sorted as going in".
    expect(pickMostRecentlyTouchedBoard([c, d])?.id).toBe(pickMostRecentlyTouchedBoard([d, c])?.id)
  })
})
