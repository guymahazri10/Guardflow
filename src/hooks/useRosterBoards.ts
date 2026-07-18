import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  createRosterBoard,
  deleteRosterBoard,
  fetchPublishedRosterBoards,
  fetchRosterBoardById,
  fetchRosterBoards,
  fetchRosterBoardsByShiftId,
  publishRosterBoard,
  updateRosterBoard,
  updateRosterBoardGuardNames,
  type CreateRosterBoardInput,
  type GuardAssignment,
  type RosterBoard,
  type UpdateRosterBoardInput,
} from '../lib/rosterBoards'

export const rosterBoardKeys = {
  all: ['rosterBoards'] as const,
  lists: ['rosterBoards', 'list'] as const,
  list: () => rosterBoardKeys.lists,
  published: () => [...rosterBoardKeys.lists, 'published'] as const,
  detail: (id: string) => [...rosterBoardKeys.all, 'detail', id] as const,
  byShiftId: (shiftId: string) => [...rosterBoardKeys.lists, 'shiftId', shiftId] as const,
}

type UpdateRosterBoardVariables = {
  id: string
  input: UpdateRosterBoardInput
}

type PublishRosterBoardVariables = {
  id: string
  published: boolean
}

type UpdateGuardNamesVariables = {
  id: string
  guardNames: Record<string, GuardAssignment>
}

function invalidateRosterBoardLists(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: rosterBoardKeys.lists })
}

export function useRosterBoards() {
  return useQuery({
    queryKey: rosterBoardKeys.list(),
    queryFn: fetchRosterBoards,
  })
}

export function usePublishedRosterBoards() {
  return useQuery({
    queryKey: rosterBoardKeys.published(),
    queryFn: fetchPublishedRosterBoards,
  })
}

export function useRosterBoard(id: string | null | undefined) {
  return useQuery({
    queryKey: rosterBoardKeys.detail(id ?? ''),
    queryFn: () => fetchRosterBoardById(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useRosterBoardsByShiftId(shiftId: string | null | undefined) {
  return useQuery({
    queryKey: rosterBoardKeys.byShiftId(shiftId ?? ''),
    queryFn: () => fetchRosterBoardsByShiftId(shiftId ?? ''),
    enabled: Boolean(shiftId),
  })
}

export function useCreateRosterBoard() {
  const queryClient = useQueryClient()

  return useMutation<RosterBoard, Error, CreateRosterBoardInput>({
    mutationFn: createRosterBoard,
    onSuccess: async () => {
      await invalidateRosterBoardLists(queryClient)
    },
  })
}

export function useUpdateRosterBoard() {
  const queryClient = useQueryClient()

  return useMutation<RosterBoard, Error, UpdateRosterBoardVariables>({
    mutationFn: ({ id, input }) => updateRosterBoard(id, input),
    onSuccess: async (_board, variables) => {
      await Promise.all([
        invalidateRosterBoardLists(queryClient),
        queryClient.invalidateQueries({ queryKey: rosterBoardKeys.detail(variables.id) }),
      ])
    },
  })
}

export function usePublishRosterBoard() {
  const queryClient = useQueryClient()

  return useMutation<RosterBoard, Error, PublishRosterBoardVariables>({
    mutationFn: ({ id, published }) => publishRosterBoard(id, published),
    onSuccess: async (_board, variables) => {
      await Promise.all([
        invalidateRosterBoardLists(queryClient),
        queryClient.invalidateQueries({ queryKey: rosterBoardKeys.published() }),
        queryClient.invalidateQueries({ queryKey: rosterBoardKeys.detail(variables.id) }),
      ])
    },
  })
}

export function useUpdateGuardNames() {
  const queryClient = useQueryClient()

  return useMutation<RosterBoard, Error, UpdateGuardNamesVariables>({
    mutationFn: ({ id, guardNames }) => updateRosterBoardGuardNames(id, guardNames),
    onSuccess: async (_board, variables) => {
      await Promise.all([
        invalidateRosterBoardLists(queryClient),
        queryClient.invalidateQueries({ queryKey: rosterBoardKeys.published() }),
        queryClient.invalidateQueries({ queryKey: rosterBoardKeys.detail(variables.id) }),
      ])
    },
  })
}

export function useDeleteRosterBoard() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: deleteRosterBoard,
    onSuccess: async () => {
      await invalidateRosterBoardLists(queryClient)
    },
  })
}
