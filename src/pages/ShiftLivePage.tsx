import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useClock, formatHHMM } from '../hooks/useClock'
import { useActiveBoard } from '../hooks/useActiveBoard'
import GuardCard from '../components/ui/GuardCard'
import { NotificationBell } from '../components/ui/NotificationBell'
import { ClipboardIcon, AlertIcon, ClockIcon } from '../components/ui/StateIcon'
import { SHIFT_CATEGORIES, getShiftFullTitle, getShiftHoursLabel, type ShiftCategory } from '../constants/shifts'
import { toLocalDateIso, addDaysIso } from '../lib/israelTime'
import { useShiftTypes } from '../hooks/useShiftTypes'
import { getCurrentBlock } from '../lib/shiftBlocks'
import type { RosterBoard, RosterBoardRow } from '../lib/rosterBoards'
import { useFeatureFlag } from '../hooks/useFeatureFlag'
import { useShiftAssignmentsForWeek } from '../hooks/useShiftAssignments'
import { useAuth } from '../contexts/AuthContext'
import { AssignmentSwapModal } from '../components/AssignmentSwapModal'

/** Shared "dated assignment vs legacy roster name" state, threaded from the
 *  page root down into NowTab/AllShiftTab so both tabs share one query. */
type DatedAssignmentContext = {
  scheduleImportEnabled: boolean
  assignmentsQuery: ReturnType<typeof useShiftAssignmentsForWeek>
  // The work_date to match the active assignment against — NOT necessarily
  // calendar-today. A night shift's work_date is the date it *started* (see
  // normalizeSchedule.ts), even though it's still active into the next
  // calendar day. Between local midnight and the night category's end hour,
  // calendar-today has already advanced while the active assignment is still
  // filed under yesterday's date, so this is resolved below to yesterday in
  // that window. See lookupWorkDate in ShiftLivePage().
  lookupWorkDate: string
  // shift_category is part of shift_assignments' real uniqueness key
  // (work_date, shift_category, position, slot_index) — the same position can
  // have a different assignment per category on the same date, so matching
  // must be scoped to the board's own active category, not just date+position.
  category: ShiftCategory
  canSwap: boolean
  onSwapClick: (assignmentId: string) => void
}

type Tab = 'now' | 'all'

export function ShiftLivePage() {
  const now = useClock()
  const { board, loading, error, category, refetch } = useActiveBoard()
  const [tab, setTab] = useState<Tab>('now')

  const catConfig = SHIFT_CATEGORIES[category]
  const shiftTypesQuery = useShiftTypes()
  const shift = board ? shiftTypesQuery.data?.find((s) => s.id === board.shift_id) : undefined
  const shiftLabel = shift ? getShiftFullTitle(shift) : `משמרת ${catConfig.label}`
  // Canonical category hours (07:00–15:00 / 15:00–23:00 / 23:00–07:00), not the
  // board's real-world hours which include a 30min handover buffer.
  const shiftHours = shift ? getShiftHoursLabel(shift) : catConfig.hours
  const isNight = category === 'night'
  const currentBlock = board ? getCurrentBlock(board.rows ?? [], now, isNight) : null
  const cols: string[] = board?.cols ?? []

  const scheduleImportFlag = useFeatureFlag('weekly_schedule_import')
  // Local calendar date, not UTC — using toISOString() here computed the UTC
  // date, which is wrong for ~3 hours after Israel midnight (Israel is
  // UTC+2/+3), showing night-shift crews the wrong day's assignments during
  // exactly the hours the night shift is live. Consistent with useClock.ts /
  // shiftBlocks.ts, which already read local (not UTC) time throughout —
  // this app runs on devices physically in Israel, so local time is Israel
  // time.
  const todayIso = toLocalDateIso(now)
  // The active night assignment's work_date is still "yesterday" (per
  // normalizeSchedule.ts's convention — work_date is the shift's start date)
  // during the window between local midnight and the night category's end
  // hour, even though todayIso has already rolled over. Resolve the correct
  // work_date to look up for whichever assignment is actually active right
  // now, rather than blindly using calendar-today.
  const lookupWorkDate =
    category === 'night' && now.getHours() < SHIFT_CATEGORIES.night.endHour
      ? addDaysIso(todayIso, -1)
      : todayIso
  const weekStartIso = (() => {
    const d = new Date(now)
    d.setDate(d.getDate() - d.getDay())
    return toLocalDateIso(d)
  })()
  const assignmentsQuery = useShiftAssignmentsForWeek(scheduleImportFlag.enabled ? weekStartIso : '')
  const { isAdmin, isCommander } = useAuth()
  const canSwap = isAdmin || isCommander
  const [swapAssignmentId, setSwapAssignmentId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  // Realtime (Task 14's postgres_changes subscription) is the primary refresh
  // path for other open sessions, but the acting user's own screen shouldn't
  // depend on Realtime's health to see their own just-saved change — so also
  // invalidate the same query key directly on save. Must match the exact key
  // shape useShiftAssignmentsForWeek builds internally: ['shift-assignments', weekStart].
  function handleSwapSaved() {
    setSwapAssignmentId(null)
    queryClient.invalidateQueries({ queryKey: ['shift-assignments', weekStartIso] })
  }
  const datedCtx: DatedAssignmentContext = {
    scheduleImportEnabled: scheduleImportFlag.enabled,
    assignmentsQuery,
    lookupWorkDate,
    category,
    canSwap,
    onSwapClick: setSwapAssignmentId,
  }

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
          <NowTab board={board} cols={cols} currentBlock={currentBlock} datedCtx={datedCtx} />
        ) : (
          <AllShiftTab board={board} cols={cols} currentBlock={currentBlock} datedCtx={datedCtx} />
        )}
      </div>

      {swapAssignmentId && (
        <AssignmentSwapModal
          assignmentId={swapAssignmentId}
          onClose={() => setSwapAssignmentId(null)}
          onSaved={handleSwapSaved}
        />
      )}
    </div>
  )
}

/* ─── Now tab ─────────────────────────────────────────────────── */

function NowTab({
  board,
  cols,
  currentBlock,
  datedCtx,
}: {
  board: RosterBoard
  cols: string[]
  currentBlock: RosterBoardRow | null
  datedCtx: DatedAssignmentContext
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
            guardName={datedOrLegacyName({
              legacyName: board.guard_names?.[role]?.name ?? null,
              position: role,
              ...datedCtx,
            })}
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
  datedCtx,
}: {
  board: RosterBoard
  cols: string[]
  currentBlock: RosterBoardRow | null
  datedCtx: DatedAssignmentContext
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
                  guardName={datedOrLegacyName({
                    legacyName: board.guard_names?.[role]?.name ?? null,
                    position: role,
                    ...datedCtx,
                  })}
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

/* ─── Dated-assignment overlay ───────────────────────────────────
 * When the weekly_schedule_import flag is on and a published dated
 * shift_assignments row exists for today/this position, show it
 * ("תוכנן:"/"בפועל:") instead of the legacy roster_boards.guard_names
 * value. Otherwise (flag off, or no matching row) this returns the
 * legacy value completely unchanged, so GuardCard's rendering — including
 * its "לא הוגדר" fallback for an unassigned role — stays byte-for-byte
 * identical to before this feature existed. */
function datedOrLegacyName({
  legacyName,
  position,
  scheduleImportEnabled,
  assignmentsQuery,
  lookupWorkDate,
  category,
  canSwap,
  onSwapClick,
}: {
  legacyName: string | null
  position: string
} & DatedAssignmentContext): ReactNode {
  if (!scheduleImportEnabled) return legacyName

  // shift_category must be part of the match — the table's real uniqueness
  // key is (work_date, shift_category, position, slot_index), so the same
  // position can have a different assignment per category on the same date.
  // Omitting this let the wrong shift's assignment be shown (and the swap
  // modal act on the wrong assignment id).
  const dated = assignmentsQuery.data?.find(
    (a) => a.work_date === lookupWorkDate && a.position === position && a.shift_category === category && a.published,
  )

  if (!dated) return legacyName

  const plannedLabel = dated.source_name ?? '—'
  const actualLabel = dated.actual_name ?? plannedLabel

  const content = (
    <div>
      <div>תוכנן: {plannedLabel}</div>
      {dated.is_manually_edited && <div>בפועל: {actualLabel}</div>}
    </div>
  )

  if (!canSwap) return content

  return (
    <button type="button" onClick={() => onSwapClick(dated.id)} className="text-right w-full">
      {content}
    </button>
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
