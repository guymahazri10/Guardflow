import { useQuery } from '@tanstack/react-query'
import { fetchFeatureFlag } from '../lib/featureFlags'
import { useAuth } from '../contexts/AuthContext'

export function useFeatureFlag(id: string): { enabled: boolean; loading: boolean } {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: ['feature-flag', id],
    queryFn: () => fetchFeatureFlag(id),
  })

  if (query.isLoading) return { enabled: false, loading: true }

  const flag = query.data
  if (!flag || !flag.enabled) return { enabled: false, loading: false }

  if (flag.allowed_user_ids.length === 0) return { enabled: true, loading: false }

  const enabled = !!user && flag.allowed_user_ids.includes(user.id)
  return { enabled, loading: false }
}
