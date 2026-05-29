import { useState } from 'react';
import { useClock, formatHHMM, formatDateHebrew, toShiftMinutes } from '../hooks/useClock';
import { useActiveBoard } from '../hooks/useActiveBoard';
import GuardCard from '../components/ui/GuardCard';
import { SHIFT_CATEGORIES, getShiftById } from '../constants/shifts';
import type { RosterBoard, RosterRow } from '../types';

type Tab = 'now' | 'all';

function getCurrentBlock(rows: RosterRow[], now: Date, isNight: boolean): RosterRow | null {
  if (!rows?.length) return null;
  const nowMins = toShiftMinutes(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    isNight,
  );
  let current: RosterRow | null = null;
  for (const row of rows) {
    if (toShiftMinutes(row.time, isNight) <= nowMins) current = row;
  }
  return current ?? rows[0];
}

export default function ShiftLive() {
  const now = useClock();
  const { board, loading, error, category, refetch } = useActiveBoard();
  const [tab, setTab] = useState<Tab>('now');

  const catConfig = SHIFT_CATEGORIES[category];
  const shiftConfig = board ? getShiftById(board.shift_id) : null;
  const isNight = category === 'night';
  const currentBlock = board ? getCurrentBlock(board.rows ?? [], now, isNight) : null;
  const cols: string[] = board?.cols ?? [];

  return (
    <div className="flex flex-col flex-1 gap-0 max-w-mobile mx-auto w-full">
      {/* ── Clock hero ── */}
      <div className="bg-white border-b border-border px-4 py-5">
        <div className="flex items-start justify-between">
          <div>
            <p
              className="text-[52px] font-semibold leading-none tracking-tight text-text-primary"
              style={{ fontFamily: 'JetBrains Mono, monospace' }}
            >
              {formatHHMM(now)}
            </p>
            <p className="text-text-secondary text-sm mt-1">{formatDateHebrew(now)}</p>
          </div>

          <div className="flex flex-col items-end gap-1.5 mt-1">
            <span
              className="text-xs font-bold px-2.5 py-1 rounded-full text-white"
              style={{ backgroundColor: catConfig.color }}
            >
              {catConfig.label}
            </span>
            {shiftConfig && (
              <span className="text-xs text-text-muted">{shiftConfig.label}</span>
            )}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[11px] text-text-muted">שידור חי</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="bg-white border-b border-border flex px-4">
        {(['now', 'all'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t ? 'tab-active' : 'tab-inactive'
            }`}
          >
            {t === 'now' ? 'עכשיו' : 'כל המשמרת'}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 p-4 overflow-y-auto">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !board ? (
          <EmptyState categoryLabel={catConfig.label} hours={catConfig.hours} />
        ) : tab === 'now' ? (
          <NowTab board={board} cols={cols} currentBlock={currentBlock} />
        ) : (
          <AllShiftTab board={board} cols={cols} currentBlock={currentBlock} isNight={isNight} />
        )}
      </div>
    </div>
  );
}

/* ─── Now tab ─────────────────────────────────────────────────── */

function NowTab({
  board,
  cols,
  currentBlock,
}: {
  board: RosterBoard;
  cols: string[];
  currentBlock: RosterRow | null;
}) {
  if (!currentBlock) {
    return <Placeholder icon="⏱️" text="אין בלוק זמן פעיל כרגע" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        בלוק זמן:{' '}
        <span
          className="font-semibold text-text-secondary"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          {currentBlock.time}
        </span>
      </p>

      {cols.map((role) => (
        <GuardCard
          key={role}
          role={role}
          guardName={board.guard_names?.[role] ?? null}
          task={currentBlock.cells?.[role]}
          highlight
        />
      ))}

      {cols.length === 0 && (
        <Placeholder icon="📋" text="אין תפקידים מוגדרים בלוח זה" />
      )}
    </div>
  );
}

/* ─── All-shift tab ───────────────────────────────────────────── */

function AllShiftTab({
  board,
  cols,
  currentBlock,
  isNight,
}: {
  board: RosterBoard;
  cols: string[];
  currentBlock: RosterRow | null;
  isNight: boolean;
}) {
  const rows: RosterRow[] = board.rows ?? [];

  if (!rows.length) return <Placeholder icon="📋" text="אין לוח זמנים לתצוגה" />;

  return (
    <div className="flex flex-col gap-3 pb-4">
      {rows.map((row, i) => {
        const isCurrent = row.time === currentBlock?.time;
        return (
          <div
            key={i}
            className={`card p-4 ${
              isCurrent ? 'ring-2 ring-primary/30' : ''
            }`}
          >
            {/* Row header */}
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-sm font-semibold text-text-primary"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}
              >
                {row.time}
              </span>
              {isCurrent && (
                <span className="flex items-center gap-1 text-[11px] text-primary font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  עכשיו
                </span>
              )}
            </div>

            {/* Roles grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {cols.map((role) => (
                <RoleCell
                  key={role}
                  role={role}
                  task={row.cells?.[role]}
                  guardName={board.guard_names?.[role]}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoleCell({
  role,
  task,
  guardName,
}: {
  role: string;
  task?: string;
  guardName?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wide truncate">
        {role}
      </span>
      {task && (
        <span className="text-xs text-text-secondary truncate">{task}</span>
      )}
      <span className="text-sm font-medium text-text-primary truncate">
        {guardName ?? <span className="text-text-muted italic text-xs">—</span>}
      </span>
    </div>
  );
}

/* ─── States ──────────────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="card p-4 animate-pulse">
          <div className="flex justify-between items-center">
            <div className="h-5 w-16 bg-border rounded-full" />
            <div className="h-4 w-20 bg-border rounded" />
          </div>
          <div className="mt-3 h-6 w-36 bg-border rounded" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card p-6 text-center">
      <p className="text-3xl mb-2">⚠️</p>
      <p className="font-semibold text-text-primary">שגיאה בטעינת הנתונים</p>
      <p className="text-text-secondary text-xs mt-1 mb-4">{message}</p>
      <button onClick={onRetry} className="btn-primary px-6">
        נסה שוב
      </button>
    </div>
  );
}

function EmptyState({ categoryLabel, hours }: { categoryLabel: string; hours: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-4xl mb-3">📋</p>
      <p className="font-semibold text-text-primary">אין לוח משמרת פעיל</p>
      <p className="text-text-secondary text-sm mt-1.5">
        לא נמצא לוח מפורסם למשמרת {categoryLabel}
      </p>
      <p className="text-text-muted text-xs mt-1">{hours}</p>
      <p className="text-text-muted text-xs mt-3">
        המנהל צריך ליצור ולפרסם לוח משמרת
      </p>
    </div>
  );
}

function Placeholder({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-3xl mb-2">{icon}</p>
      <p className="text-text-muted text-sm">{text}</p>
    </div>
  );
}
