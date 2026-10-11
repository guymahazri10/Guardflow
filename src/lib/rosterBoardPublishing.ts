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

/**
 * Whether saving names on the setup screen should also make this board the
 * live one for its category.
 *
 * The setup screen is where a manager picks a variant ("6 guards" vs "5
 * guards") and staffs it, but nothing there published it — so names landed on
 * a board the live screen was not showing, and the save looked like it did
 * nothing. Saving now broadcasts the variant being staffed.
 *
 * Skipped for a board with no structure (nothing to show, and the editor's own
 * canPublishRosterBoard rule forbids publishing it). When the published list
 * is not known yet we publish anyway: publishRosterBoard is idempotent, so the
 * worst case is one redundant write.
 */
export function shouldPublishOnSave(
  board: { id: string; shift_type: string; published: boolean },
  publishedBoards: ReadonlyArray<{ id: string; shift_type: string }> | undefined,
  hasStructure: boolean,
): boolean {
  if (!hasStructure) return false
  if (!board.published) return true
  if (!publishedBoards) return true
  return publishedBoards.some((b) => b.shift_type === board.shift_type && b.id !== board.id)
}
