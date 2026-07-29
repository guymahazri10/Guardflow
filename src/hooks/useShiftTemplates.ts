import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchShiftTemplateByShiftId,
  fetchShiftTemplates,
  updateShiftTemplate,
  type ShiftTemplate,
  type UpdateShiftTemplateInput,
} from '../lib/shiftTemplates'

export const shiftTemplateKeys = {
  all: ['shiftTemplates'] as const,
  list: () => [...shiftTemplateKeys.all, 'list'] as const,
  detail: (shiftId: string) => [...shiftTemplateKeys.all, 'detail', shiftId] as const,
}

type UpdateShiftTemplateVariables = {
  shiftId: string
  input: UpdateShiftTemplateInput
}

export function useShiftTemplates() {
  return useQuery({
    queryKey: shiftTemplateKeys.list(),
    queryFn: fetchShiftTemplates,
  })
}

export function useShiftTemplate(shiftId: string | null | undefined) {
  return useQuery({
    queryKey: shiftTemplateKeys.detail(shiftId ?? ''),
    queryFn: () => fetchShiftTemplateByShiftId(shiftId ?? ''),
    enabled: Boolean(shiftId),
  })
}

export function useUpdateShiftTemplate() {
  const queryClient = useQueryClient()

  return useMutation<ShiftTemplate, Error, UpdateShiftTemplateVariables>({
    mutationFn: ({ shiftId, input }) => updateShiftTemplate(shiftId, input),
    onSuccess: async (_template, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shiftTemplateKeys.list() }),
        queryClient.invalidateQueries({ queryKey: shiftTemplateKeys.detail(variables.shiftId) }),
      ])
    },
  })
}
