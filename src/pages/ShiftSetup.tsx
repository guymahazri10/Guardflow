import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  getActiveCategory,
  getShiftsByCategory,
  SHIFT_CATEGORIES,
  SHIFT_IDS_BY_CATEGORY,
  type ShiftCategory,
  type ShiftConfig,
} from '../constants/shifts';
import type { RosterBoard } from '../types';

/* ─── Helpers ─────────────────────────────────────────────────── */

/** Strip category name from label: "בוקר 6 מאבטחים" → "6 מאבטחים" */
function shortLabel(shift: ShiftConfig): string {
  const cat = SHIFT_CATEGORIES[shift.category].label;
  const stripped = shift.label.replace(cat, '').trim();
  return stripped || shift.label;
}

/** "07:00–15:00" from startHour / endHour */
function hoursLabel(shift: ShiftConfig): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(shift.startHour)}:00–${p(shift.endHour)}:00`;
}

/* ─── Main component ──────────────────────────────────────────── */

export default function ShiftSetup() {
  const { isAdmin, isCommander } = useAuth();
  const canEdit = isAdmin || isCommander;
  const navigate = useNavigate();

  // ── State ──
  const [category, setCategory] = useState<ShiftCategory>(() => getActiveCategory());
  const [selectedShiftId, setSelectedShiftId] = useState<string>(
    () => SHIFT_IDS_BY_CATEGORY[getActiveCategory()][0],
  );
  const [guardNames, setGuardNames] = useState<Record<string, string>>({});
  const [board, setBoard] = useState<RosterBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [noBoard, setNoBoard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ── Pull-to-refresh ──
  const touchStartY = useRef(0);
  const [pullY, setPullY] = useState(0);
  const PULL_THRESHOLD = 72;

  // ── Fetch ──
  const fetchBoard = useCallback(async (shiftId: string) => {
    setLoading(true);
    setNoBoard(false);

    const { data, error } = await supabase
      .from('roster_boards')
      .select('*')
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      toast.error('שגיאה בטעינת הנתונים');
      setBoard(null);
    } else if (!data) {
      setBoard(null);
      setNoBoard(true);
      setGuardNames({});
    } else {
      setBoard(data);
      setGuardNames(data.guard_names ?? {});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBoard(selectedShiftId);
  }, [selectedShiftId, fetchBoard]);

  // ── Handlers ──
  function handleCategoryChange(cat: ShiftCategory) {
    setCategory(cat);
    setSelectedShiftId(SHIFT_IDS_BY_CATEGORY[cat][0]);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchBoard(selectedShiftId);
    setRefreshing(false);
  }

  function handleNameChange(role: string, value: string) {
    setGuardNames((prev) => ({ ...prev, [role]: value }));
  }

  async function handleSave() {
    // Guards (read-only) just navigate
    if (!canEdit) {
      navigate('/shift-live');
      return;
    }

    if (!board) {
      toast.error('המנהל צריך ליצור את הלוז תחילה');
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('roster_boards')
      .update({ guard_names: guardNames })
      .eq('id', board.id);

    if (error) {
      toast.error('שגיאה בשמירה — נסה שוב');
    } else {
      toast.success('נשמר בהצלחה!');
      navigate('/shift-live');
    }
    setSaving(false);
  }

  // ── Derived ──
  const shifts = getShiftsByCategory(category);
  const cols: string[] = board?.cols ?? [];
  const hasAnyName = cols.some((role) => guardNames[role]?.trim());
  const isDisabled = saving || (canEdit && !noBoard && cols.length > 0 && !hasAnyName);

  return (
    <div
      className="flex flex-col flex-1 max-w-mobile mx-auto w-full"
      onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY; }}
      onTouchMove={(e) => {
        const dy = e.touches[0].clientY - touchStartY.current;
        if (dy > 0) setPullY(Math.min(dy * 0.4, PULL_THRESHOLD));
      }}
      onTouchEnd={() => {
        if (pullY >= PULL_THRESHOLD) handleRefresh();
        setPullY(0);
      }}
    >
      {/* ── Pull-to-refresh indicator ── */}
      {(pullY > 0 || refreshing) && (
        <div
          className="flex items-center justify-center overflow-hidden transition-[height] duration-150 bg-background"
          style={{ height: refreshing ? 48 : pullY }}
        >
          <div
            className={`w-5 h-5 border-2 border-primary border-t-transparent rounded-full ${
              refreshing ? 'animate-spin' : ''
            }`}
          />
        </div>
      )}

      {/* ── Page header ── */}
      <div className="bg-white border-b border-border px-4 pt-5 pb-4">
        <h1 className="text-xl font-bold text-text-primary">ניהול משמרת</h1>
        <p className="text-text-secondary text-sm mt-0.5">
          בחר משמרת, הזן שמות — ולחץ שמור
        </p>
      </div>

      {/* ── Category tabs: בוקר | צהריים | לילה ── */}
      <div className="bg-white border-b border-border flex px-4">
        {(Object.keys(SHIFT_CATEGORIES) as ShiftCategory[]).map((cat) => (
          <button
            key={cat}
            onClick={() => handleCategoryChange(cat)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              category === cat ? 'tab-active' : 'tab-inactive'
            }`}
          >
            {SHIFT_CATEGORIES[cat].label}
          </button>
        ))}
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">

        {/* Shift variant cards */}
        <div className={`grid gap-3 ${shifts.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {shifts.map((shift) => {
            const selected = shift.id === selectedShiftId;
            return (
              <button
                key={shift.id}
                onClick={() => setSelectedShiftId(shift.id)}
                className={`card p-3.5 text-right transition-all active:scale-[0.98] ${
                  selected ? 'ring-2 ring-primary' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  {/* Checkmark circle */}
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                      selected ? 'border-primary bg-primary' : 'border-border'
                    }`}
                  >
                    {selected && (
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <path
                          d="M1.5 5l2.5 2.5 4.5-4.5"
                          stroke="white"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1 text-right">
                    <p
                      className={`text-sm font-semibold leading-snug ${
                        selected ? 'text-primary' : 'text-text-primary'
                      }`}
                    >
                      {shortLabel(shift)}
                    </p>
                    <p
                      className="text-[11px] text-text-muted mt-0.5 tabular-nums"
                      style={{ fontFamily: 'JetBrains Mono, monospace' }}
                      dir="ltr"
                    >
                      {hoursLabel(shift)}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Guard name inputs */}
        {loading ? (
          <InputSkeleton />
        ) : noBoard ? (
          <NoBoardState />
        ) : cols.length === 0 ? (
          <NoColsState />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-text-muted">שמות מאבטחים</p>
            {cols.map((role) => (
              <GuardNameRow
                key={role}
                role={role}
                value={guardNames[role] ?? ''}
                onChange={(v) => handleNameChange(role, v)}
                readOnly={!canEdit}
              />
            ))}
          </div>
        )}

        {/* Read-only notice for guards */}
        {!canEdit && (
          <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <span className="text-base shrink-0">👁️</span>
            <p className="text-amber-700 text-xs font-medium leading-snug">
              תצוגה בלבד — אין לך הרשאה לערוך שמות
            </p>
          </div>
        )}
      </div>

      {/* ── Sticky CTA ── */}
      <div className="bg-white border-t border-border px-4 py-3 safe-bottom">
        <button
          onClick={handleSave}
          disabled={isDisabled}
          className="btn-primary w-full h-14 text-[15px] rounded-[14px] flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>שומר...</span>
            </>
          ) : canEdit ? (
            <span>שמור ועבור לתצוגה ←</span>
          ) : (
            <span>עבור לתצוגה חיה ←</span>
          )}
        </button>
      </div>
    </div>
  );
}

/* ─── GuardNameRow ────────────────────────────────────────────── */

function GuardNameRow({
  role,
  value,
  onChange,
  readOnly,
}: {
  role: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-border flex items-center overflow-hidden h-[52px] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-shadow">
      {/* Role label — appears on right in RTL */}
      <div className="flex items-center justify-end px-4 shrink-0 min-w-[88px] border-l border-border h-full">
        <span className="text-sm font-medium text-text-secondary">{role}</span>
      </div>

      {/* Text input */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={readOnly ? '—' : 'הזן שם...'}
        readOnly={readOnly}
        className={`flex-1 px-4 text-sm text-text-primary bg-transparent outline-none h-full placeholder:text-text-muted ${
          readOnly ? 'cursor-default text-text-secondary' : ''
        }`}
        dir="rtl"
        autoCorrect="off"
        autoCapitalize="words"
      />
    </div>
  );
}

/* ─── Skeleton ────────────────────────────────────────────────── */

function InputSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-3 w-24 bg-border rounded animate-pulse mb-1" />
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-[52px] bg-white rounded-xl border border-border flex items-center gap-3 px-4 animate-pulse"
        >
          <div className="h-4 w-14 bg-border rounded" />
          <div className="w-px h-6 bg-border" />
          <div className="h-4 w-28 bg-border rounded" />
        </div>
      ))}
    </div>
  );
}

/* ─── Empty states ────────────────────────────────────────────── */

function NoBoardState() {
  return (
    <div className="card p-6 text-center mt-2">
      <p className="text-3xl mb-2">🗒️</p>
      <p className="font-semibold text-text-primary">אין לוח משמרת</p>
      <p className="text-text-secondary text-sm mt-1.5 leading-relaxed">
        המנהל צריך ליצור את הלוז תחילה
      </p>
    </div>
  );
}

function NoColsState() {
  return (
    <div className="card p-6 text-center mt-2">
      <p className="text-3xl mb-2">📋</p>
      <p className="font-semibold text-text-primary">לוח ריק</p>
      <p className="text-text-secondary text-sm mt-1.5">
        לא מוגדרים תפקידים בלוח זה
      </p>
    </div>
  );
}
