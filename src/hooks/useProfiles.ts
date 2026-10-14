import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteUser,
  fetchProfiles,
  inviteUser,
  setUserAppRole,
  setUserFullName,
  type InviteUserInput,
  type ProfileListItem,
} from '../lib/profiles'
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

type OptimisticContext = { previous: ProfileListItem[] | undefined }

/**
 * Role and name edits show up in the list immediately and roll back if the save fails,
 * so the page never waits on a round trip. The list is always refetched afterwards, so
 * whatever the server actually stored is what ends up on screen.
 */
function useOptimisticProfileMutation<TVariables extends { userId: string }>(
  mutationFn: (variables: TVariables) => Promise<ProfileListItem>,
  apply: (profile: ProfileListItem, variables: TVariables) => ProfileListItem,
) {
  const queryClient = useQueryClient()

  return useMutation<ProfileListItem, Error, TVariables, OptimisticContext>({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: profileKeys.list() })
      const previous = queryClient.getQueryData<ProfileListItem[]>(profileKeys.list())
      queryClient.setQueryData<ProfileListItem[]>(profileKeys.list(), (current) =>
        current?.map((profile) => (profile.id === variables.userId ? apply(profile, variables) : profile)),
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(profileKeys.list(), context.previous)
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.list() })
    },
  })
}

export function useSetUserAppRole() {
  return useOptimisticProfileMutation<SetUserAppRoleVariables>(
    ({ userId, newRole }) => setUserAppRole(userId, newRole),
    (profile, { newRole }) => ({ ...profile, app_role: newRole }),
  )
}

export function useSetUserFullName() {
  return useOptimisticProfileMutation<SetUserFullNameVariables>(
    ({ userId, newFullName }) => setUserFullName(userId, newFullName),
    (profile, { newFullName }) => ({ ...profile, full_name: newFullName }),
  )
}

export function useInviteUser() {
  const queryClient = useQueryClient()

  return useMutation<{ id: string; email: string }, Error, InviteUserInput>({
    mutationFn: inviteUser,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.list() })
    },
  })
}

export function useDeleteUser() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: deleteUser,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.list() })
    },
  })
}
