import type { RosterBoard } from './rosterBoards'

/**
 * Among several published boards that could all be "the active one" for a
 * live view (e.g. two shift-type variants in the same category both left
 * published), picks the one a manager actually touched most recently.
 *
 * Exists because ShiftLivePage's useActiveBoard queries across every
 * variant's shift_id at once and only wants a single row back — with two
 * published boards sharing the exact same created_at (both variants were
 * created in the same seeding batch), created_at alone is not a reliable
 * tie-break: it can deterministically pick the wrong, stale board forever.
 * updated_at changes on every guard_names save, so it's the signal that
 * actually reflects "which board is someone actively managing" — confirmed
 * against production: a board last saved a day after the other one it ties
 * with on created_at is the one the manager meant to be live.
 * Falls back to created_at, then id, purely to keep the result deterministic
 * when updated_at also ties (e.g. neither board has been edited yet).
 *
 * Kept out of rosterBoards.ts deliberately — that module initializes the
 * Supabase client on import, which throws outside a browser/runtime env with
 * VITE_SUPABASE_* set (e.g. under vitest), so this pure decision would not be
 * unit-testable from there. RosterBoard is imported as a type only, so this
 * file carries none of that baggage.
 */
export function pickMostRecentlyTouchedBoard(boards: RosterBoard[]): RosterBoard | null {
  if (boards.length === 0) return null
  const sorted = [...boards].sort(
    (a, b) =>
      b.updated_at.localeCompare(a.updated_at) ||
      b.created_at.localeCompare(a.created_at) ||
      b.id.localeCompare(a.id),
  )
  return sorted[0]
}
