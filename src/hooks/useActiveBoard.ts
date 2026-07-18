import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getActiveCategory, SHIFT_IDS_BY_CATEGORY, type ShiftCategory } from '../constants/shifts';
import type { RosterBoard } from '../lib/rosterBoards';

interface ActiveBoardResult {
  board: RosterBoard | null;
  loading: boolean;
  error: string | null;
  category: ShiftCategory;
  refetch: () => void;
}

export function useActiveBoard(): ActiveBoardResult {
  const [board, setBoard] = useState<RosterBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const category = getActiveCategory();
  const shiftIds = SHIFT_IDS_BY_CATEGORY[category];

  useEffect(() => {
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
      .channel(`roster-board-${category}-${tick}`)
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
  }, [category, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { board, loading, error, category, refetch: () => setTick((t) => t + 1) };
}
