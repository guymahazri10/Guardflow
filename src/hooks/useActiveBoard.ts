import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getActiveCategory, type ShiftCategory } from '../constants/shifts';
import { useShiftTypes } from './useShiftTypes';
import type { RosterBoard } from '../lib/rosterBoards';
import { pickMostRecentlyTouchedBoard } from '../lib/activeBoardSelection';

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

      // Fetch every published candidate rather than letting the database break
      // the tie: multiple shift-type variants in the same category can be
      // published at once (confirmed in production — two morning variants,
      // seeded in the same batch and sharing an identical created_at), and
      // `order(created_at).limit(1)` then returns whichever row Postgres
      // happens to place first, not necessarily the one a manager actually
      // edited most recently. See pickMostRecentlyTouchedBoard for the
      // tie-break this screen actually wants.
      const { data, error: err } = await supabase
        .from('roster_boards')
        .select('*')
        .eq('published', true)
        .in('shift_id', shiftIds);

      if (cancelled) return;
      if (err) setError(err.message);
      else setBoard(pickMostRecentlyTouchedBoard(data ?? []));
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
          // A change to some OTHER published variant must not blindly replace
          // what's shown — that's the same tie the initial fetch above now
          // avoids. Re-run the same tie-break over whichever of the two is
          // currently displayed plus the incoming row, so an edit to the
          // stale variant can't flip the live screen away from the one the
          // manager is actually working on.
          setBoard((prev) =>
            pickMostRecentlyTouchedBoard(prev && prev.id !== updated.id ? [prev, updated] : [updated]),
          );
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
