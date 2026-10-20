import type { MatchedAssignment } from './types'
import { normalizeForMatch } from './matchNames'

/**
 * How an assignment's name relates to a user account. The name itself
 * (source_name, as read from the file) is never touched by any of this: a
 * link is optional extra information, not a condition for the assignment to
 * exist, be shown, or be published.
 *
 * - linked:    an account is tied to the name (exact match, or a manager
 *              confirmed / chose it)
 * - suggested: a similar account was found but nobody confirmed it — shown
 *              as a suggestion only, and NOT sent as a link
 * - unlinked:  no account
 */
export type LinkState = 'linked' | 'suggested' | 'unlinked'

export function assignmentIdentityKey(a: {
  work_date: string
  shift_category: string
  position: string
  slot_index: number
}): string {
  return `${a.work_date}|${a.shift_category}|${a.position}|${a.slot_index}`
}

export function linkStateOf(a: MatchedAssignment, confirmedFuzzy: ReadonlySet<string>): LinkState {
  if (!a.planned_user_id) return 'unlinked'
  if (a.match_confidence === 'fuzzy' && !confirmedFuzzy.has(assignmentIdentityKey(a))) return 'suggested'
  if (a.match_confidence === 'none') return 'unlinked'
  return 'linked'
}

export type NameSummary = {
  /** assignments read from the file */
  assignments: number
  /** distinct names after whitespace / punctuation normalisation */
  uniqueNames: number
  /** distinct names whose every assignment has a linked account */
  linkedNames: number
  /** distinct names with at least one assignment lacking a linked account */
  unlinkedNames: number
}

/** Counts by distinct name, not by assignment. The displayed name is never
 *  altered — normalisation is only used to decide that two spellings are the
 *  same name for counting. */
export function summarizeNames(assignments: MatchedAssignment[], confirmedFuzzy: ReadonlySet<string>): NameSummary {
  const byName = new Map<string, boolean>() // normalised name -> all rows linked
  for (const a of assignments) {
    const name = normalizeForMatch(a.source_name ?? '')
    if (!name) continue
    const linked = linkStateOf(a, confirmedFuzzy) === 'linked'
    byName.set(name, (byName.get(name) ?? true) && linked)
  }
  const linkedNames = [...byName.values()].filter(Boolean).length
  return {
    assignments: assignments.length,
    uniqueNames: byName.size,
    linkedNames,
    unlinkedNames: byName.size - linkedNames,
  }
}

/** Ties an account to an assignment. source_name is left exactly as read. */
export function linkAssignmentToUser(a: MatchedAssignment, userId: string): MatchedAssignment {
  return { ...a, planned_user_id: userId, match_confidence: 'exact' }
}

/** What is actually sent to the publish RPC: a suggestion nobody confirmed is
 *  not a link, so it goes out as no link (the name still goes out). */
export function toPublishPayload(assignments: MatchedAssignment[], confirmedFuzzy: ReadonlySet<string>): MatchedAssignment[] {
  return assignments.map((a) =>
    linkStateOf(a, confirmedFuzzy) === 'suggested' ? { ...a, planned_user_id: null, match_confidence: 'none' as const } : a,
  )
}

/**
 * A re-upload must not undo a link made earlier. When the same slot already
 * holds the same name with a linked account, and this upload could not match
 * that name to an account on its own, the earlier link is kept — otherwise
 * every re-import would quietly unlink everyone linked by hand.
 */
export function carryOverLinks(
  assignments: MatchedAssignment[],
  existing: Array<{
    work_date: string
    shift_category: string
    position: string
    slot_index: number
    source_name: string | null
    planned_user_id: string | null
  }>,
): MatchedAssignment[] {
  const byKey = new Map(existing.map((e) => [assignmentIdentityKey(e), e]))
  return assignments.map((a) => {
    if (a.match_confidence === 'exact') return a
    const prior = byKey.get(assignmentIdentityKey(a))
    if (!prior?.planned_user_id) return a
    if (normalizeForMatch(prior.source_name ?? '') !== normalizeForMatch(a.source_name ?? '')) return a
    return { ...a, planned_user_id: prior.planned_user_id, match_confidence: 'exact' as const }
  })
}
