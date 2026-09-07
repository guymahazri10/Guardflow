/**
 * Decides whether publishing a roster board should retire other published
 * boards sharing its category, and what to filter on if so.
 *
 * `shift_type` on roster_boards IS the category ('morning'/'afternoon'/
 * 'night'); `shift_id` is the specific variant within it (e.g. "5 guards" vs
 * "6 guards"). Before this existed, publishing a new variant left the
 * previous one published too — two boards in the same category both
 * `published = true` — which is exactly what made ShiftLivePage's
 * useActiveBoard have to guess between them (see activeBoardSelection.ts).
 * A manager choosing "6 guards today" means that variant should be the sole
 * active one, not one of two contenders.
 *
 * Kept out of rosterBoards.ts, and takes no supabase types, so the decision
 * itself — publish only vs. publish-and-retire-siblings — is unit testable
 * without a configured Supabase client.
 */
export type SiblingUnpublishFilter = {
  shiftType: string
  excludeBoardId: string
}

export function siblingUnpublishFilter(board: {
  id: string
  shift_type: string
  published: boolean
}): SiblingUnpublishFilter | null {
  // Un-publishing (published: false) retires only this board — there is
  // nothing else to touch, and doing so would incorrectly leave every
  // sibling variant unpublished too.
  if (!board.published) return null
  return { shiftType: board.shift_type, excludeBoardId: board.id }
}
