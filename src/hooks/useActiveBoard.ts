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

    let request = 0;
    async function load() {
      const current = ++request;
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

      if (cancelled || current !== request) return;
      if (err) setError(err.message);
      else setBoard(pickMostRecentlyTouchedBoard(data ?? []));
      setLoading(false);
    }

    setLoading(true);
    void load();

    const channel = supabase
      .channel(`roster-board-${instanceIdRef.current}-${category}-${tick}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_boards' }, () => { void load(); })
      .subscribe((status) => {
        // Catch commits made between the initial fetch and the subscription handshake.
        if (status === 'SUBSCRIBED') void load();
      });

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
