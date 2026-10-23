import { matchNames, normalizeForMatch, personNameKey, type ExplicitLinks } from './matchNames'
import type { NormalizedAssignment } from './types'
import type { ScheduleWorkerLink, SchedulePerson } from '../scheduleWorkerLinks'

/**
 * How one name from the schedule relates to accounts, for the manager's link
 * screen. Mirrors what public.get_my_shifts does, plus suggestions:
 *
 * - explicit:         the manager linked the name to an account
 * - marked_ambiguous: the manager decided "do not attribute this name"
 * - exact:            exactly one account carries this exact name (automatic)
 * - ambiguous:        needs a decision — two accounts carry the name
 * - unlinked:         no account found; may carry a fuzzy SUGGESTION, which is
 *                     never applied by itself
 */
export type NameStatus = 'explicit' | 'marked_ambiguous' | 'exact' | 'ambiguous' | 'unlinked'

export type ScheduleNameRow = {
  key: string
  displayName: string
  spellings: string[]
  shifts: number
  status: NameStatus
  userId: string | null
  suggestedUserId: string | null
  reason: 'duplicate_accounts' | null
}

export function classifyScheduleNames(
  people: SchedulePerson[],
  profiles: { id: string; full_name: string | null }[],
  links: ScheduleWorkerLink[],
): ScheduleNameRow[] {
  const linkByKey = new Map(links.map((l) => [l.source_key, l]))
  const profileKeys = new Map<string, string[]>()
  for (const p of profiles) {
    const k = personNameKey(p.full_name)
    if (!k) continue
    profileKeys.set(k, [...(profileKeys.get(k) ?? []), p.id])
  }

  const byKey = new Map<string, SchedulePerson[]>()
  for (const row of people) {
    const k = personNameKey(row.source_name)
    if (!k) continue
    byKey.set(k, [...(byKey.get(k) ?? []), row])
  }

  const out: ScheduleNameRow[] = []
  for (const [key, rows] of byKey) {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.source_name ?? '', (counts.get(r.source_name ?? '') ?? 0) + 1)
    const spellings = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
    const base = {
      key,
      displayName: spellings[0],
      spellings,
      shifts: rows.length,
      suggestedUserId: null as string | null,
    }

    const link = linkByKey.get(key)
    if (link) {
      out.push({ ...base, status: link.user_id ? 'explicit' : 'marked_ambiguous', userId: link.user_id, reason: null })
      continue
    }

    const owners = profileKeys.get(key) ?? []
    if (owners.length > 1) {
      out.push({ ...base, status: 'ambiguous', userId: null, reason: 'duplicate_accounts' })
      continue
    }
    if (owners.length === 1) {
      // Overlapping times do not matter for identification: they are a
      // schedule matter, shown to the worker as a warning.
      out.push({ ...base, status: 'exact', userId: owners[0], reason: null })
      continue
    }

    // No exact account: look for a similar one, as a suggestion only.
    const stub = { source_name: spellings[0] } as unknown as NormalizedAssignment
    const [m] = matchNames([stub], profiles)
    out.push({
      ...base,
      status: 'unlinked',
      userId: null,
      suggestedUserId: m?.suggested_user_id ?? null,
      reason: null,
    })
  }

  const rank: Record<NameStatus, number> = { ambiguous: 0, unlinked: 1, marked_ambiguous: 2, explicit: 3, exact: 4 }
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.displayName.localeCompare(b.displayName, 'he'))
}

export function linksToMap(links: ScheduleWorkerLink[]): ExplicitLinks {
  return new Map(links.map((l) => [l.source_key, l.user_id]))
}

// kept for callers that only need the old name-normalisation
export { normalizeForMatch }
