import { Fragment, useMemo, useState } from 'react'
import { useShiftAssignmentsForWeek } from '../hooks/useShiftAssignments'
import type { ShiftAssignment } from '../lib/scheduleImports'
import { addDaysIso, formatIsraelShortDateLabel, utcIsoToIsraelHHMM } from '../lib/israelTime'
import { weekStartIsoFor } from '../lib/scheduleImport/boardDatedSync'
import { bucketPublishedAssignments, extraGuardPositions, weeklyCellKey } from '../lib/scheduleImport/weeklyView'
import { allKnownPositionsForCategory } from '../lib/scheduleImport/liveBoardPositions'
import { SHIFT_CATEGORIES, type ShiftCategory } from '../constants/shifts'
import { AlertIcon, ClipboardIcon } from '../components/ui/StateIcon'
import { MyShiftsList } from '../components/MyShiftsList'

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full lg:max-w-7xl">{children}</div>
}

function PageHeader({ light, bold }: { light: string; bold: string }) {
  return (
    <div className="page-header">
      <h1 className="text-lg">
        <span className="font-light text-text-secondary">{light}</span>{' '}
        <b className="font-extrabold">{bold}</b>
      </h1>
    </div>
  )
}

/**
 * The table's row structure, in display order — mirrors the source table's
 * own layout (grouped by worker kind, then by shift period) rather than
 * CANONICAL_POSITIONS' flat union list, which has no per-period breakdown.
 * allKnownPositionsForCategory (liveBoardPositions.ts) already carries
 * exactly this per-period breakdown, manager-confirmed, plus every known
 * variant-specific role label (e.g. the night solo-guard's "לילה מאבטח",
 * which isn't a fixed post the two-guard board's לובי positions already
 * cover) — reused here instead of a second hand-written list that could
 * drift from it.
 */
const CATEGORIES: ShiftCategory[] = ['morning', 'afternoon', 'night']

type Row = { shiftCategory: ShiftCategory; position: string }

const COMMANDER_ROWS: Row[] = CATEGORIES.map((shiftCategory) => ({ shiftCategory, position: 'אחמ"ש' }))

function assignmentLabel(a: ShiftAssignment): string {
  return a.actual_name ?? a.source_name ?? '—'
}

export function WeeklySchedulePage() {
  // Viewing is open to every signed-in role (manager, אחמ"ש, מאבטח): the
  // published schedule is not behind the import feature flag, which only
  // gates the manager's import tooling. Row-level security already limits
  // non-managers to published rows.
  const currentWeekIso = weekStartIsoFor(new Date())
  const [weekStartIso, setWeekStartIso] = useState(currentWeekIso)
  const [tab, setTab] = useState<'all' | 'mine'>('all')
  const assignmentsQuery = useShiftAssignmentsForWeek(weekStartIso)

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartIso, i)),
    [weekStartIso],
  )

  const assignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data])
  const assignmentsByKey = useMemo(() => bucketPublishedAssignments(assignments), [assignments])
  const hasAnyPublished = useMemo(
    () => days.some((day) => assignments.some((a) => a.published && a.work_date === day)),
    [days, assignments],
  )

  return (
    <PageShell>
      <PageHeader light="לו״ז" bold="שבועי" />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
        <WeekPicker
          weekStartIso={weekStartIso}
          isCurrent={weekStartIso === currentWeekIso}
          onPrev={() => setWeekStartIso(addDaysIso(weekStartIso, -7))}
          onNext={() => setWeekStartIso(addDaysIso(weekStartIso, 7))}
          onToday={() => setWeekStartIso(currentWeekIso)}
        />
        <div role="tablist" aria-label="תצוגת לו״ז" className="flex gap-1 rounded-full bg-primary-light p-1">
          {(
            [
              ['all', 'כל הסידור'],
              ['mine', 'המשמרות שלי'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`weekly-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`weekly-panel-${id}`}
              onClick={() => setTab(id)}
              className={`flex-1 rounded-full px-3 py-2 text-sm font-bold transition-colors ${
                tab === id ? 'bg-white text-primary shadow-sm' : 'text-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'mine' ? (
          <div role="tabpanel" id="weekly-panel-mine" aria-labelledby="weekly-tab-mine">
            <MyShiftsList weekStartIso={weekStartIso} />
          </div>
        ) : assignmentsQuery.isLoading ? (
          <LoadingSkeleton />
        ) : assignmentsQuery.isError ? (
          <ErrorState onRetry={() => assignmentsQuery.refetch()} />
        ) : !hasAnyPublished ? (
          <EmptyState />
        ) : (
          <WeekTable days={days} assignments={assignments} assignmentsByKey={assignmentsByKey} />
        )}
      </div>
    </PageShell>
  )
}

function WeekPicker({
  weekStartIso,
  isCurrent,
  onPrev,
  onNext,
  onToday,
}: {
  weekStartIso: string
  isCurrent: boolean
  onPrev: () => void
  onNext: () => void
  onToday: () => void
}) {
  const range = `${formatIsraelShortDateLabel(weekStartIso)} – ${formatIsraelShortDateLabel(addDaysIso(weekStartIso, 6))}`
  return (
    <div className="card px-3 py-2 flex items-center justify-between gap-2" aria-label="בחירת שבוע">
      <button type="button" onClick={onPrev} className="btn-ghost px-3 py-1.5 text-sm" aria-label="השבוע הקודם">
        ‹ הקודם
      </button>
      <div className="text-center">
        <div className="text-sm font-bold" aria-live="polite">{range}</div>
        {!isCurrent && (
          <button type="button" onClick={onToday} className="text-xs text-primary font-semibold">
            חזרה לשבוע הנוכחי
          </button>
        )}
      </div>
      <button type="button" onClick={onNext} className="btn-ghost px-3 py-1.5 text-sm" aria-label="השבוע הבא">
        הבא ›
      </button>
    </div>
  )
}

function hoursLabel(a: ShiftAssignment): string {
  return `${utcIsoToIsraelHHMM(a.starts_at)}–${utcIsoToIsraelHHMM(a.ends_at)}`
}

function WeekTable({
  days,
  assignments,
  assignmentsByKey,
}: {
  days: string[]
  assignments: ShiftAssignment[]
  assignmentsByKey: Map<string, ShiftAssignment[]>
}) {
  // Reported directly: scrolling to see later days lost the position label
  // entirely, so a cell was unreadable without scrolling back. `right-0`
  // (not `left-0`) because in this RTL table the label column already sits
  // at the right edge — sticky pins to a physical edge of the scroll
  // container, not a logical/direction-aware one, so this has to match
  // where the column actually is, not where "start" would be in LTR.
  function Cell({ row, day }: { row: Row; day: string }) {
    const bucket = assignmentsByKey.get(weeklyCellKey(day, row.shiftCategory, row.position)) ?? []
    if (bucket.length === 0) {
      return <td className="px-3 py-2 text-center text-text-muted">—</td>
    }
    return (
      <td className="px-3 py-2 text-center">
        <div className="flex flex-col gap-0.5">
          {bucket.map((a) => (
            <span key={a.id}>
              <span className="block font-medium">{assignmentLabel(a)}</span>
              <span dir="ltr" className="block text-[11px] text-text-secondary">{hoursLabel(a)}</span>
            </span>
          ))}
        </div>
      </td>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">לו״ז שבועי: ימים, משמרות, עמדות ושעות</caption>
          <thead>
            <tr className="border-b border-border text-text-secondary text-xs">
              <th className="sticky right-0 z-10 bg-white px-3 py-2.5 font-bold text-right border-l border-border">
                עמדה
              </th>
              {days.map((day) => (
                <th key={day} className="px-3 py-2.5 font-bold text-center whitespace-nowrap">
                  {formatIsraelShortDateLabel(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-background-2">
              <td colSpan={days.length + 1} className="px-3 py-1.5 font-bold text-text-secondary text-xs">
                אחמ"ש
              </td>
            </tr>
            {COMMANDER_ROWS.map((row) => (
              <tr key={`${row.shiftCategory}-${row.position}`} className="border-b border-border last:border-0">
                <td className="sticky right-0 z-10 bg-white px-3 py-2 font-medium whitespace-nowrap border-l border-border">
                  {SHIFT_CATEGORIES[row.shiftCategory].label}
                </td>
                {days.map((day) => (
                  <Cell key={day} row={row} day={day} />
                ))}
              </tr>
            ))}
          </tbody>
          <tbody>
            <tr className="bg-background-2">
              <td colSpan={days.length + 1} className="px-3 py-1.5 font-bold text-text-secondary text-xs">
                מאבטח
              </td>
            </tr>
            {CATEGORIES.map((category) => (
              <Fragment key={category}>
                <tr className="border-b border-border">
                  <td colSpan={days.length + 1} className="px-3 py-1 text-[11px] font-semibold text-text-muted">
                    {SHIFT_CATEGORIES[category].label}
                  </td>
                </tr>
                {[
                  ...allKnownPositionsForCategory(category),
                  ...extraGuardPositions(assignments, category, allKnownPositionsForCategory(category)),
                ].map((position) => {
                  const row: Row = { shiftCategory: category, position }
                  return (
                    <tr key={position} className="border-b border-border last:border-0">
                      <td className="sticky right-0 z-10 bg-white px-3 py-2 font-medium whitespace-nowrap border-l border-border">
                        {position}
                      </td>
                      {days.map((day) => (
                        <Cell key={day} row={row} day={day} />
                      ))}
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── States ──────────────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="card h-10 px-3.5 flex items-center gap-2.5 animate-pulse">
          <div className="h-3 w-16 bg-border rounded" />
          <div className="h-3 flex-1 bg-border rounded" />
        </div>
      ))}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card p-6 text-center">
      <div className="w-11 h-11 rounded-full bg-danger-light flex items-center justify-center mx-auto mb-3 text-danger">
        <AlertIcon />
      </div>
      <p className="font-semibold text-text-primary">שגיאה בטעינת הנתונים</p>
      <p className="text-text-secondary text-xs mt-1 mb-4">נסה שוב, או פנה למנהל אם זה ממשיך.</p>
      <button onClick={onRetry} className="btn-primary px-6">
        נסה שוב
      </button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="card p-8 text-center">
      <div className="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-3 text-text-secondary">
        <ClipboardIcon />
      </div>
      <p className="font-semibold text-text-primary">לא פורסם סידור לשבוע זה</p>
      <p className="text-text-secondary text-sm mt-1.5">אפשר לעבור לשבוע אחר, או לפנות למנהל כדי לפרסם את הסידור</p>
    </div>
  )
}
