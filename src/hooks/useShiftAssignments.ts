import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchShiftAssignmentsForWeek, type ShiftAssignment } from '../lib/scheduleImports'

export function useShiftAssignmentsForWeek(weekStart: string) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['shift-assignments', weekStart], [weekStart])

  const query = useQuery({
    queryKey,
    queryFn: () => fetchShiftAssignmentsForWeek(weekStart),
    enabled: !!weekStart,
  })

  useEffect(() => {
    if (!weekStart) return

    const channel = supabase
      .channel(`shift-assignments-${weekStart}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shift_assignments' },
        () => {
          queryClient.invalidateQueries({ queryKey })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [weekStart, queryClient, queryKey])

  return query
}

export type { ShiftAssignment }
