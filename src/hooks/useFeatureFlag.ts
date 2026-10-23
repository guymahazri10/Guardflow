import { useQuery } from '@tanstack/react-query'
import { fetchFeatureFlag, isFlagAllowedFor, isFlagEnabled } from '../lib/featureFlags'
import { useAuth } from '../contexts/AuthContext'

export function useFeatureFlag(id: string): { enabled: boolean; loading: boolean } {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: ['feature-flag', id],
    queryFn: () => fetchFeatureFlag(id),
  })

  if (query.isLoading) return { enabled: false, loading: true }
  return { enabled: isFlagAllowedFor(query.data, user?.id), loading: false }
}

/**
 * Is the feature switched on at all (global `enabled`), regardless of who is on the rollout
 * allow-list? Used by Live and Setup to show the published dated schedule to every role. It opens
 * no import or manager-edit permission: those are still the allow-list (useFeatureFlag), the
 * admin routes, and the database functions.
 */
export function useFeatureEnabled(id: string): { enabled: boolean; loading: boolean } {
  const query = useQuery({
    queryKey: ['feature-flag', id],
    queryFn: () => fetchFeatureFlag(id),
  })
  if (query.isLoading) return { enabled: false, loading: true }
  return { enabled: isFlagEnabled(query.data), loading: false }
}
