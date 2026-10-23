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
      // A manager cancelling or moving a shift hides its row from everyone who cannot read
      // unpublished rows, and Realtime does not announce a row that became invisible. Every
      // manager edit also bumps schedule_revisions, which every signed-in user can read, so
      // this screen refetches and drops the shift it still has cached.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schedule_revisions' },
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
