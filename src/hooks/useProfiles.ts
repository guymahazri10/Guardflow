import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchProfiles, setUserAppRole, setUserFullName, type ProfileListItem } from '../lib/profiles'
import type { AppRole } from '../contexts/AuthContext'

export const profileKeys = {
  all: ['profiles'] as const,
  list: () => [...profileKeys.all, 'list'] as const,
}

type SetUserAppRoleVariables = {
  userId: string
  newRole: AppRole
}

type SetUserFullNameVariables = {
  userId: string
  newFullName: string
}

export function useProfiles(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: profileKeys.list(),
    queryFn: fetchProfiles,
    enabled: options?.enabled ?? true,
  })
}

export function useSetUserAppRole() {
  const queryClient = useQueryClient()

  return useMutation<ProfileListItem, Error, SetUserAppRoleVariables>({
    mutationFn: ({ userId, newRole }) => setUserAppRole(userId, newRole),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.list() })
    },
  })
}

export function useSetUserFullName() {
  const queryClient = useQueryClient()

  return useMutation<ProfileListItem, Error, SetUserFullNameVariables>({
    mutationFn: ({ userId, newFullName }) => setUserFullName(userId, newFullName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.list() })
    },
  })
}
