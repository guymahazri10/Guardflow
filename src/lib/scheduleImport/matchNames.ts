import type { MatchedAssignment, NormalizedAssignment } from './types'

function normalizeForMatch(raw: string): string {
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

export function matchNames(
  assignments: NormalizedAssignment[],
  profiles: { id: string; full_name: string | null }[],
): MatchedAssignment[] {
  const normalizedProfiles = profiles
    .filter((p): p is { id: string; full_name: string } => !!p.full_name)
    .map((p) => ({ id: p.id, normalized: normalizeForMatch(p.full_name) }))

  return assignments.map((assignment) => {
    if (!assignment.source_name) {
      return { ...assignment, planned_user_id: null, match_confidence: 'none' }
    }

    const normalizedSource = normalizeForMatch(assignment.source_name)

    const exact = normalizedProfiles.find((p) => p.normalized === normalizedSource)
    if (exact) {
      return { ...assignment, planned_user_id: exact.id, match_confidence: 'exact' }
    }

    let best: { id: string; distance: number } | null = null
    for (const p of normalizedProfiles) {
      const distance = levenshtein(normalizedSource, p.normalized)
      if (distance <= 2 && (!best || distance <= best.distance)) {
        best = { id: p.id, distance }
      }
    }

    if (best) {
      return { ...assignment, planned_user_id: best.id, match_confidence: 'fuzzy' }
    }

    return { ...assignment, planned_user_id: null, match_confidence: 'none' }
  })
}
