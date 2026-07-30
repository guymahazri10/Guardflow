import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getActiveCategory, type ShiftCategory } from '../constants/shifts';
import { useShiftTypes } from './useShiftTypes';
import type { RosterBoard } from '../lib/rosterBoards';

interface ActiveBoardResult {
  board: RosterBoard | null;
  loading: boolean;
  error: string | null;
  category: ShiftCategory;
  refetch: () => void;
}

let instanceCounter = 0;

export function useActiveBoard(): ActiveBoardResult {
  const shiftTypesQuery = useShiftTypes();
  const [board, setBoard] = useState<RosterBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Supabase returns the same channel object for a topic that's already
  // subscribed, so concurrent useActiveBoard() callers (e.g. ShiftLivePage
  // and PositionChangeNotifier mounted at the same time) need distinct
  // topic names or the second .subscribe() collides with the first.
  const instanceIdRef = useRef<number | undefined>(undefined);
  if (instanceIdRef.current === undefined) {
    instanceCounter += 1;
    instanceIdRef.current = instanceCounter;
  }

  const category = getActiveCategory();
  const shiftIds = useMemo(
    () => (shiftTypesQuery.data ?? []).filter((s) => s.category === category).map((s) => s.id),
    [shiftTypesQuery.data, category],
  );

  useEffect(() => {
    if (shiftTypesQuery.isLoading) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase
        .from('roster_boards')
        .select('*')
        .eq('published', true)
        .in('shift_id', shiftIds)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (err) setError(err.message);
      else setBoard(data ?? null);
      setLoading(false);
    }

    load();

    const channel = supabase
      .channel(`roster-board-${instanceIdRef.current}-${category}-${tick}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_boards' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as { id: string }).id;
          setBoard((prev) => (prev?.id === deletedId ? null : prev));
          return;
        }
        const updated = payload.new as RosterBoard;
        if (!shiftIds.includes(updated.shift_id)) return;
        if (updated.published) {
          setBoard(updated);
        } else {
          setBoard((prev) => (prev?.id === updated.id ? null : prev));
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [category, tick, shiftTypesQuery.isLoading, shiftIds]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    board,
    loading: loading || shiftTypesQuery.isLoading,
    error: error ?? (shiftTypesQuery.isError ? 'טעינת סוגי המשמרות נכשלה.' : null),
    category,
    refetch: () => setTick((t) => t + 1),
  };
}
