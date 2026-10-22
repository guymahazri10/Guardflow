import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchMyShifts } from '../lib/scheduleWorkerLinks'

export const myShiftsKey = (weekStart: string) => ['my-shifts', weekStart] as const

/** The signed-in user's own published shifts for a week. Refreshes when any
 *  assignment changes (a publish or a manual replacement). */
export function useMyShifts(weekStart: string) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: myShiftsKey(weekStart),
    queryFn: () => fetchMyShifts(weekStart),
    enabled: !!weekStart,
  })

  useEffect(() => {
    if (!weekStart) return
    const channel = supabase
      .channel(`my-shifts-${weekStart}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_assignments' }, () => {
        queryClient.invalidateQueries({ queryKey: myShiftsKey(weekStart) })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [weekStart, queryClient])

  return query
}
