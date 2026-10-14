import type { AppRole } from '../contexts/AuthContext'
import type { ProfileListItem } from './profiles'

export const APP_ROLES: AppRole[] = ['מנהל', 'אחמ"ש', 'מאבטח']

export type RoleFilter = 'all' | AppRole

/** Anything that isn't one of the three known roles is shown (and filtered) as מאבטח, the default. */
export function normalizeRole(raw: string | null | undefined): AppRole {
  return APP_ROLES.includes(raw as AppRole) ? (raw as AppRole) : 'מאבטח'
}

/** Users matching the search text (name or email, any letter case) and the role filter. */
export function filterProfiles(profiles: ProfileListItem[], query: string, role: RoleFilter): ProfileListItem[] {
  const needle = query.trim().toLowerCase()

  return profiles.filter((profile) => {
    if (role !== 'all' && normalizeRole(profile.app_role) !== role) return false
    if (!needle) return true

    const haystack = `${profile.full_name ?? ''} ${profile.email ?? ''}`.toLowerCase()
    return haystack.includes(needle)
  })
}

export function countByRole(profiles: ProfileListItem[]): Record<RoleFilter, number> {
  const counts: Record<RoleFilter, number> = { all: profiles.length, מנהל: 0, 'אחמ"ש': 0, מאבטח: 0 }
  for (const profile of profiles) {
    counts[normalizeRole(profile.app_role)] += 1
  }
  return counts
}
