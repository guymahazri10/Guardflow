import type { MatchedAssignment, NormalizedAssignment } from './types'

export function normalizeForMatch(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/["'׳״]/g, '')
    .replace(/[-־]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[a.length][b.length]
}

const MIN_TOKEN_LENGTH = 2

// A profile counts as covered by a source name if every one of the
// profile's own words has a close match among the source's words — not the
// other way around, and deliberately not "any one word overlaps". Many real
// profiles in this app are registered under a first name only ("ניר",
// "רום"), while the schedule image always carries a full name ("ניר כהן",
// "רום אוקסהורן"). Comparing the full strings put those a Levenshtein
// distance of 4+ apart — far outside any sane fuzzy threshold — so every
// first-name-only profile went permanently unmatched, regardless of how the
// last name was actually spelled. Requiring every *profile* word (not every
// source word) to be covered means a one-word profile is satisfied by
// finding that one word anywhere in the source, while a two-word profile
// still needs both words present — so "גיא" alone doesn't also swallow
// "גיא מנור"'s slot when both exist.
function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length >= MIN_TOKEN_LENGTH)
}

function wordsClose(a: string, b: string): boolean {
  if (a === b) return true
  return levenshtein(a, b) <= 1
}

/** Returns the profile's word-coverage score if every one of its words
 *  matches some source word (closely), or null if any word is missing. */
function coverageScore(sourceTokens: string[], profileTokens: string[]): number | null {
  if (profileTokens.length === 0) return null
  let totalDistance = 0
  for (const profileToken of profileTokens) {
    let bestForToken: number | null = null
    for (const sourceToken of sourceTokens) {
      if (!wordsClose(profileToken, sourceToken)) continue
      const d = profileToken === sourceToken ? 0 : levenshtein(profileToken, sourceToken)
      if (bestForToken === null || d < bestForToken) bestForToken = d
    }
    if (bestForToken === null) return null
    totalDistance += bestForToken
  }
  return totalDistance
}

/** Conservative key for a person's name: NFC, whitespace collapsed, trimmed,
 *  lower-cased. Punctuation is NOT stripped, so different names are never
 *  merged. Must match public.person_name_key in phase21. */
export function personNameKey(raw: string | null | undefined): string {
  return (raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Explicit manager decisions, keyed by personNameKey: an account id links the
 *  name to that account; null means "do not attribute this name to anyone". */
export type ExplicitLinks = ReadonlyMap<string, string | null>

export function matchNames(
  assignments: NormalizedAssignment[],
  profiles: { id: string; full_name: string | null }[],
  explicitLinks?: ExplicitLinks,
): MatchedAssignment[] {
  const normalizedProfiles = profiles
    .filter((p): p is { id: string; full_name: string } => !!p.full_name)
    .map((p) => {
      const normalized = normalizeForMatch(p.full_name)
      return { id: p.id, normalized, tokens: tokenize(normalized) }
    })

  return assignments.map((assignment) => {
    if (!assignment.source_name) {
      return { ...assignment, planned_user_id: null, match_confidence: 'none' }
    }

    // An explicit manager decision always beats automatic matching.
    const explicitKey = personNameKey(assignment.source_name)
    if (explicitLinks?.has(explicitKey)) {
      const userId = explicitLinks.get(explicitKey) ?? null
      return userId
        ? { ...assignment, planned_user_id: userId, match_confidence: 'explicit' }
        : { ...assignment, planned_user_id: null, match_confidence: 'none' }
    }

    const normalizedSource = normalizeForMatch(assignment.source_name)

    const exactMatches = normalizedProfiles.filter((p) => p.normalized === normalizedSource)
    if (exactMatches.length === 1) {
      return { ...assignment, planned_user_id: exactMatches[0].id, match_confidence: 'exact' }
    }
    if (exactMatches.length > 1) {
      // Two profiles share this exact name: which person the schedule means
      // is unknowable from the name alone, so no account is linked. The name
      // from the file stays as it is; the manager can link one by hand.
      return { ...assignment, planned_user_id: null, match_confidence: 'none' }
    }

    // Strategy 1: whole-string edit distance — catches a single typo'd or
    // misread letter in an otherwise-matching full name.
    let best: { id: string; distance: number; tokenCount: number } | null = null
    for (const p of normalizedProfiles) {
      const distance = levenshtein(normalizedSource, p.normalized)
      if (distance <= 2) {
        best = pickBetter(best, { id: p.id, distance, tokenCount: p.tokens.length })
      }
    }

    // Strategy 2: word-coverage — catches a profile registered under a
    // shorter name (first name only, or first+last while the schedule wrote
    // a middle name/nickname) by requiring every one of the profile's own
    // words to appear, closely, somewhere in the source name. Preferring a
    // higher tokenCount here means "גיא מנור" outranks "גיא" whenever the
    // source name actually contains both words, rather than settling for
    // whichever shorter profile happened to be checked first.
    const sourceTokens = tokenize(normalizedSource)
    for (const p of normalizedProfiles) {
      const distance = coverageScore(sourceTokens, p.tokens)
      if (distance !== null) {
        best = pickBetter(best, { id: p.id, distance, tokenCount: p.tokens.length })
      }
    }

    if (best) {
      // A suggestion for the manager only: it is not a link.
      return { ...assignment, planned_user_id: null, suggested_user_id: best.id, match_confidence: 'fuzzy' }
    }

    return { ...assignment, planned_user_id: null, match_confidence: 'none' }
  })
}

/** More profile words covered wins first (a fuller name match is more
 *  specific and less likely to be a coincidental partial overlap); ties
 *  broken by lower edit distance. */
function pickBetter<T extends { distance: number; tokenCount: number }>(
  current: T | null,
  candidate: T,
): T {
  if (!current) return candidate
  if (candidate.tokenCount !== current.tokenCount) {
    return candidate.tokenCount > current.tokenCount ? candidate : current
  }
  return candidate.distance <= current.distance ? candidate : current
}
