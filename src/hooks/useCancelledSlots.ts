import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchCancelledSlots, type CancelledSlot } from '../lib/scheduleEdits'

export const cancelledSlotsKey = (weekStart: string) => ['cancelled-slots', weekStart] as const

/**
 * Which slots of the week were cancelled by a manager (date / shift / post / slot only —
 * see get_cancelled_slots). Live and Setup need it so a cancelled shift shows as empty and
 * never falls back to the older name in the board template, for every role: a non-manager
 * cannot read the cancelled row itself.
 *
 * A cancelled row becomes invisible to a non-manager, and Realtime does not announce that, so
 * this refetches on the manager-edit signal (schedule_revisions), on any visible assignment
 * change, on window focus, and once a minute as a last resort.
 */
export function useCancelledSlots(weekStart: string): { slots: CancelledSlot[]; isError: boolean } {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: cancelledSlotsKey(weekStart),
    queryFn: () => fetchCancelledSlots(weekStart),
    enabled: !!weekStart,
    refetchInterval: 60_000,
    // not deployed yet / transient failure: behave as "nothing cancelled" rather than break the screen
    retry: 1,
  })

  useEffect(() => {
    if (!weekStart) return
    const refresh = () => queryClient.invalidateQueries({ queryKey: cancelledSlotsKey(weekStart) })
    const channel = supabase
      .channel(`cancelled-slots-${weekStart}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_revisions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_assignments' }, refresh)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [weekStart, queryClient])

  return { slots: query.data ?? [], isError: query.isError }
}
