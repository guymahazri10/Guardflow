import { useState, type ReactNode } from 'react'
import { useClock, formatHHMM } from '../hooks/useClock'
import { useActiveBoard } from '../hooks/useActiveBoard'
import GuardCard from '../components/ui/GuardCard'
import { NotificationBell } from '../components/ui/NotificationBell'
import { ClipboardIcon, AlertIcon, ClockIcon } from '../components/ui/StateIcon'
import { SHIFT_CATEGORIES, getShiftById, getShiftFullTitle, getShiftHoursLabel } from '../constants/shifts'
import { getCurrentBlock } from '../lib/shiftBlocks'
import type { RosterBoard, RosterBoardRow } from '../lib/rosterBoards'

type Tab = 'now' | 'all'

export function ShiftLivePage() {
  const now = useClock()
  const { board, loading, error, category, refetch } = useActiveBoard()
  const [tab, setTab] = useState<Tab>('now')

  const catConfig = SHIFT_CATEGORIES[category]
  const shift = board ? getShiftById(board.shift_id) : undefined
  const shiftLabel = shift ? getShiftFullTitle(shift) : `משמרת ${catConfig.label}`
  // Canonical category hours (07:00–15:00 / 15:00–23:00 / 23:00–07:00), not the
  // board's real-world hours which include a 30min handover buffer.
  const shiftHours = shift ? getShiftHoursLabel(shift) : catConfig.hours
  const isNight = category === 'night'
  const currentBlock = board ? getCurrentBlock(board.rows ?? [], now, isNight) : null
  const cols: string[] = board?.cols ?? []

  return (
    <div className="flex flex-col flex-1 gap-0 max-w-mobile mx-auto w-full">
      {/* ── Clock hero ── */}
      <div className="relative bg-white border-b border-border px-4 py-6 flex flex-col items-center">
        <div className="absolute top-3 left-3">
          <NotificationBell />
        </div>
        <span className="text-[11px] font-bold text-text-secondary mb-1">• פעיל עכשיו</span>
        <p className="text-[52px] font-black leading-none tracking-tight text-text-primary tabular-nums">
          {formatHHMM(now)}
        </p>
        <div className="flex items-center gap-1.5 mt-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-bold text-primary tracking-wide">
            {shiftLabel} · {shiftHours}
          </span>
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
          <AllShiftTab board={board} cols={cols} currentBlock={currentBlock} />
        )}
      </div>
    </div>
  )
}

/* ─── Now tab ─────────────────────────────────────────────────── */

function NowTab({
  board,
  cols,
  currentBlock,
}: {
  board: RosterBoard
  cols: string[]
  currentBlock: RosterBoardRow | null
}) {
  if (!currentBlock) {
    return <Placeholder icon={<ClockIcon />} text="אין בלוק זמן פעיל כרגע" />
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Shift-wide hours already shown in the clock hero above — this only
          needs the active-guard count, not another time range. */}
      <div className="flex items-center justify-end px-0.5">
        <span className="text-[11px] font-bold text-white bg-primary rounded-full px-2.5 py-1">
          {cols.length} פעיל
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {cols.map((role) => (
          <GuardCard
            key={role}
            role={role}
            guardName={board.guard_names?.[role]?.name ?? null}
            task={currentBlock.cells?.[role]}
          />
        ))}
      </div>

      {cols.length === 0 && <Placeholder icon={<ClipboardIcon />} text="אין תפקידים מוגדרים בלוח זה" />}
    </div>
  )
}

/* ─── All-shift tab ───────────────────────────────────────────── */

function AllShiftTab({
  board,
  cols,
  currentBlock,
}: {
  board: RosterBoard
  cols: string[]
  currentBlock: RosterBoardRow | null
}) {
  const allRows: RosterBoardRow[] = board.rows ?? []
  const currentIndex = currentBlock ? allRows.findIndex((row) => row.time === currentBlock.time) : -1
  const rows = currentIndex >= 0 ? allRows.slice(currentIndex) : allRows

  if (!rows.length) return <Placeholder icon={<ClipboardIcon />} text="אין לוח זמנים לתצוגה" />

  return (
    <div className="flex flex-col gap-5 pb-4">
      {rows.map((row, i) => {
        const isCurrent = row.time === currentBlock?.time
        const nextTime = rows[i + 1]?.time

        return (
          <div key={row.time}>
            <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
              <span
                className={`text-sm font-extrabold tabular-nums ${isCurrent ? 'text-primary' : 'text-text-secondary'}`}
              >
                {row.time}
                {nextTime ? ` – ${nextTime}` : ''}
              </span>
              {isCurrent && (
                <span className="text-[10px] font-bold text-white bg-primary rounded-full px-2 py-0.5">עכשיו</span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {cols.map((role) => (
                <GuardCard
                  key={role}
                  role={role}
                  guardName={board.guard_names?.[role]?.name ?? null}
                  task={row.cells?.[role]}
                  dim={!isCurrent}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ─── States ──────────────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="card h-16 px-3.5 flex items-center gap-2.5 animate-pulse">
          <div className="h-3 w-14 bg-border rounded" />
          <div className="w-px h-7 bg-border" />
          <div className="h-4 w-28 bg-border rounded flex-1" />
          <div className="h-5 w-16 bg-border rounded-full" />
        </div>
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card p-6 text-center">
      <div className="w-11 h-11 rounded-full bg-danger-light flex items-center justify-center mx-auto mb-3 text-danger">
        <AlertIcon />
      </div>
      <p className="font-semibold text-text-primary">שגיאה בטעינת הנתונים</p>
      <p className="text-text-secondary text-xs mt-1 mb-4">{message}</p>
      <button onClick={onRetry} className="btn-primary px-6">
        נסה שוב
      </button>
    </div>
  )
}

function EmptyState({ categoryLabel, hours }: { categoryLabel: string; hours: string }) {
  return (
    <div className="card p-8 text-center">
      <div className="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-3 text-text-secondary">
        <ClipboardIcon />
      </div>
      <p className="font-semibold text-text-primary">אין לוח משמרת פעיל</p>
      <p className="text-text-secondary text-sm mt-1.5">לא נמצא לוח מפורסם למשמרת {categoryLabel}</p>
      <p className="text-text-muted text-xs mt-1">{hours}</p>
      <p className="text-text-muted text-xs mt-3">המנהל צריך ליצור ולפרסם לוח משמרת</p>
    </div>
  )
}

function Placeholder({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="text-center py-12">
      <div className="flex items-center justify-center mb-2 text-text-muted">{icon}</div>
      <p className="text-text-muted text-sm">{text}</p>
    </div>
  )
}
