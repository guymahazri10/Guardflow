import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createShiftTypeVariant,
  deleteShiftTypeVariant,
  fetchShiftTypes,
  type CreateShiftTypeVariantInput,
} from '../lib/shiftTypes'
import { buildShiftConfig, type ShiftConfig } from '../constants/shifts'
import { shiftTemplateKeys } from './useShiftTemplates'

export const shiftTypeKeys = {
  all: ['shiftTypes'] as const,
  list: () => [...shiftTypeKeys.all, 'list'] as const,
}

export function useShiftTypes() {
  return useQuery({
    queryKey: shiftTypeKeys.list(),
    queryFn: fetchShiftTypes,
    select: (rows): ShiftConfig[] => rows.map(buildShiftConfig),
  })
}

export function useCreateShiftTypeVariant() {
  const queryClient = useQueryClient()

  return useMutation<string, Error, CreateShiftTypeVariantInput>({
    mutationFn: createShiftTypeVariant,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shiftTypeKeys.list() }),
        queryClient.invalidateQueries({ queryKey: shiftTemplateKeys.list() }),
      ])
    },
  })
}

export function useDeleteShiftTypeVariant() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: deleteShiftTypeVariant,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shiftTypeKeys.list() }),
        queryClient.invalidateQueries({ queryKey: shiftTemplateKeys.list() }),
      ])
    },
  })
}
