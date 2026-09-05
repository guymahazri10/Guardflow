import { Fragment, useMemo } from 'react'
import { useFeatureFlag } from '../hooks/useFeatureFlag'
import { useShiftAssignmentsForWeek } from '../hooks/useShiftAssignments'
import type { ShiftAssignment } from '../lib/scheduleImports'
import { addDaysIso, formatIsraelShortDateLabel } from '../lib/israelTime'
import { weekStartIsoFor } from '../lib/scheduleImport/boardDatedSync'
import { MAAVTACH_POSITION_ORDER } from '../lib/scheduleImport/liveBoardPositions'
import { SHIFT_CATEGORIES, type ShiftCategory } from '../constants/shifts'
import { AlertIcon, ClipboardIcon } from '../components/ui/StateIcon'

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full lg:max-w-none">{children}</div>
}

function PageHeader({ light, bold }: { light: string; bold: string }) {
  return (
    <div className="bg-white border-b border-border px-4 pt-5 pb-4">
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
 * MAAVTACH_POSITION_ORDER (liveBoardPositions.ts) already carries exactly
 * this per-period breakdown, manager-confirmed — reused here instead of a
 * second hand-written list that could drift from it.
 */
const CATEGORIES: ShiftCategory[] = ['morning', 'afternoon', 'night']

type Row = { shiftCategory: ShiftCategory; position: string }

const COMMANDER_ROWS: Row[] = CATEGORIES.map((shiftCategory) => ({ shiftCategory, position: 'אחמ"ש' }))

function cellKey(workDate: string, shiftCategory: string, position: string): string {
  return `${workDate}|${shiftCategory}|${position}`
}

function assignmentLabel(a: ShiftAssignment): string {
  return a.actual_name ?? a.source_name ?? '—'
}

export function WeeklySchedulePage() {
  const flag = useFeatureFlag('weekly_schedule_import')
  const weekStartIso = weekStartIsoFor(new Date())
  const assignmentsQuery = useShiftAssignmentsForWeek(flag.enabled ? weekStartIso : '')

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartIso, i)),
    [weekStartIso],
  )

  // Only published rows are ever shown here — fetchShiftAssignmentsForWeek
  // itself doesn't filter this. Bucketed by slot so a two-person post
  // (slot_index 0, 1) renders both names, in a stable order.
  const assignmentsByKey = useMemo(() => {
    const map = new Map<string, ShiftAssignment[]>()
    for (const a of assignmentsQuery.data ?? []) {
      if (!a.published) continue
      const key = cellKey(a.work_date, a.shift_category, a.position)
      const bucket = map.get(key)
      if (bucket) bucket.push(a)
      else map.set(key, [a])
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.slot_index - b.slot_index)
    return map
  }, [assignmentsQuery.data])

  const hasAnyPublished = assignmentsByKey.size > 0

  if (flag.loading) return null
  if (!flag.enabled) {
    return (
      <PageShell>
        <PageHeader light="לוח" bold="שבועי" />
        <div className="p-4">
          <p className="text-sm text-text-secondary">התכונה אינה זמינה כרגע.</p>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader light="לוח" bold="שבועי" />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
        {assignmentsQuery.isLoading ? (
          <LoadingSkeleton />
        ) : assignmentsQuery.isError ? (
          <ErrorState onRetry={() => assignmentsQuery.refetch()} />
        ) : !hasAnyPublished ? (
          <EmptyState />
        ) : (
          <WeekTable days={days} assignmentsByKey={assignmentsByKey} />
        )}
      </div>
    </PageShell>
  )
}

function WeekTable({
  days,
  assignmentsByKey,
}: {
  days: string[]
  assignmentsByKey: Map<string, ShiftAssignment[]>
}) {
  function Cell({ row, day }: { row: Row; day: string }) {
    const bucket = assignmentsByKey.get(cellKey(day, row.shiftCategory, row.position)) ?? []
    if (bucket.length === 0) {
      return <td className="px-3 py-2 text-center text-text-muted">—</td>
    }
    return (
      <td className="px-3 py-2 text-center">
        <div className="flex flex-col gap-0.5">
          {bucket.map((a) => (
            <span key={a.id}>{assignmentLabel(a)}</span>
          ))}
        </div>
      </td>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-secondary text-xs">
              <th className="px-3 py-2.5 font-bold text-right">עמדה</th>
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
                <td className="px-3 py-2 font-medium whitespace-nowrap">{SHIFT_CATEGORIES[row.shiftCategory].label}</td>
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
                {MAAVTACH_POSITION_ORDER[category].map((position) => {
                  const row: Row = { shiftCategory: category, position }
                  return (
                    <tr key={position} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{position}</td>
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
      <p className="text-text-secondary text-sm mt-1.5">המנהל צריך לייבא ולפרסם את הסידור השבועי</p>
    </div>
  )
}
