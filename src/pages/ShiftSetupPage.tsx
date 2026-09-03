import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import {
  getActiveCategory,
  getShiftHoursLabel,
  getShiftShortLabel,
  SHIFT_CATEGORIES,
  type ShiftCategory,
} from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'
import { useRosterBoardsByShiftId, useUpdateGuardNames } from '../hooks/useRosterBoards'
import { useProfiles } from '../hooks/useProfiles'
import { useFeatureFlag } from '../hooks/useFeatureFlag'
import type { ProfileListItem } from '../lib/profiles'
import type { GuardAssignment, RosterBoard } from '../lib/rosterBoards'
import GuardNameInput from '../components/ui/GuardNameInput'
import { ClipboardIcon } from '../components/ui/StateIcon'
import { callReplaceAssignmentWorker, type ShiftAssignment } from '../lib/scheduleImports'
import { useShiftAssignmentsForWeek } from '../hooks/useShiftAssignments'
import {
  workDateForCategory,
  weekStartIsoFor,
  indexDatedBySlot,
  effectiveAssignmentName,
  effectiveAssignmentUserId,
} from '../lib/scheduleImport/boardDatedSync'

/* ─── Helpers ─────────────────────────────────────────────────── */

/** Among boards sharing a shift_id, edit the published one; fall back to the newest draft. */
function pickBoardToEdit(boards: RosterBoard[]): RosterBoard | null {
  if (boards.length === 0) return null
  const sorted = [...boards].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return sorted.find((board) => board.published) ?? sorted[0]
}

/* ─── Main component ──────────────────────────────────────────── */

export function ShiftSetupPage() {
  const { isAdmin, isCommander } = useAuth()
  const canEdit = isAdmin || isCommander
  const navigate = useNavigate()
  const scheduleImportFlag = useFeatureFlag('weekly_schedule_import')

  const shiftTypesQuery = useShiftTypes()
  const allShifts = shiftTypesQuery.data ?? []

  const [category, setCategory] = useState<ShiftCategory>(() => getActiveCategory())
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)

  // Picks the first variant in the active category once shift types load —
  // can't do this synchronously anymore since the catalog is now async.
  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current || allShifts.length === 0) return
    const firstInCategory = allShifts.find((s) => s.category === category)
    if (firstInCategory) {
      setSelectedShiftId(firstInCategory.id)
      didInitRef.current = true
    }
  }, [allShifts, category])
  const [guardNames, setGuardNames] = useState<Record<string, GuardAssignment>>({})

  const boardsQuery = useRosterBoardsByShiftId(selectedShiftId)
  const updateGuardNamesMutation = useUpdateGuardNames()
  const profilesQuery = useProfiles({ enabled: canEdit })
  const profiles = profilesQuery.data ?? []

  const board = pickBoardToEdit(boardsQuery.data ?? [])

  // The dated layer this board's slots map onto, if the import feature is on.
  // Read here — not just written on save — so this screen shows the same
  // names the live screen does; see indexDatedBySlot for why they diverged.
  const nowRef = useRef(new Date())
  const workDate = workDateForCategory(category, nowRef.current)
  const assignmentsQuery = useShiftAssignmentsForWeek(
    scheduleImportFlag.enabled ? weekStartIsoFor(nowRef.current) : '',
  )
  const datedBySlot = useMemo(
    () =>
      board && scheduleImportFlag.enabled
        ? indexDatedBySlot(assignmentsQuery.data ?? [], board.cols ?? [], board.shift_type, workDate)
        : new Map<string, ShiftAssignment>(),
    [board, assignmentsQuery.data, scheduleImportFlag.enabled, workDate],
  )

  // ── Pull-to-refresh ──
  const touchStartY = useRef(0)
  const [pullY, setPullY] = useState(0)
  const PULL_THRESHOLD = 72

  // Re-initializes only when the selected board (or its work date) actually
  // changes — not on every background refetch of the same board (React Query
  // refetches on window focus/mount by default), which would silently
  // overwrite whatever the manager just typed. Waits for the dated query to
  // settle first when the feature is on, so the inputs aren't briefly seeded
  // from guard_names and then rewritten once the assignments arrive.
  const initializedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!board) return
    const datedPending = scheduleImportFlag.enabled && assignmentsQuery.isLoading
    if (datedPending) return

    const key = `${board.id}|${workDate}`
    if (initializedKeyRef.current === key) return
    initializedKeyRef.current = key

    // A slot backed by a published dated assignment shows that assignment's
    // effective name (a manual swap wins over the imported plan); every other
    // slot keeps using the legacy guard_names value.
    const next: Record<string, GuardAssignment> = { ...board.guard_names }
    for (const [role, assignment] of datedBySlot) {
      next[role] = {
        name: effectiveAssignmentName(assignment),
        user_id: effectiveAssignmentUserId(assignment),
      }
    }
    setGuardNames(next)
  }, [board, workDate, datedBySlot, scheduleImportFlag.enabled, assignmentsQuery.isLoading])

  function handleCategoryChange(cat: ShiftCategory) {
    setCategory(cat)
    const firstInCategory = allShifts.find((s) => s.category === cat)
    setSelectedShiftId(firstInCategory?.id ?? null)
  }

  function handleAssignmentChange(role: string, assignment: GuardAssignment) {
    setGuardNames((prev) => ({ ...prev, [role]: assignment }))
  }

  async function handleSave() {
    // Guards (read-only) just navigate
    if (!canEdit) {
      navigate('/shift-live')
      return
    }

    if (!board) {
      toast.error('המנהל צריך ליצור את הלוז תחילה')
      return
    }

    // A slot backed by a dated assignment must be written to that assignment
    // — writing only guard_names would save successfully and then never be
    // displayed, because the live screen reads the dated row for that slot.
    // Slots with no dated row still go to guard_names as before.
    const datedWrites = [...datedBySlot.entries()].filter(([role, assignment]) => {
      const edited = guardNames[role] ?? { name: '', user_id: null }
      const current = effectiveAssignmentName(assignment)
      return edited.name.trim() !== current.trim()
    })

    try {
      await updateGuardNamesMutation.mutateAsync({ id: board.id, guardNames })
    } catch {
      toast.error('שגיאה בשמירה — נסה שוב')
      return
    }

    // replace_assignment_worker restricts an אחמ"ש caller to an assignment
    // currently in progress; this bulk-edit screen has no per-slot "is this
    // live right now" notion the way ShiftLivePage's swap modal does, so
    // commanders keep using that flow for a same-shift correction.
    if (isAdmin && datedWrites.length > 0) {
      try {
        for (const [role, assignment] of datedWrites) {
          const edited = guardNames[role] ?? { name: '', user_id: null }
          await callReplaceAssignmentWorker({
            assignmentId: assignment.id,
            newUserId: edited.user_id,
            newName: edited.name,
            reason: 'עדכון ידני דרך מסך שיבוץ',
          })
        }
      } catch (err) {
        console.error('Failed to write guard names to dated assignments', err)
        // The guard_names save above genuinely succeeded, so this isn't a
        // rollback — it's a partial save, and saying so is more useful than
        // a blanket success toast the live screen would then contradict.
        toast.error('הלוח נשמר, אך עדכון התצוגה החיה נכשל — בדוק במסך שידור חי.')
        navigate('/shift-live')
        return
      }
    }

    toast.success('נשמר בהצלחה!')
    navigate('/shift-live')
  }

  // ── Derived ──
  const shifts = allShifts.filter((s) => s.category === category)
  const cols: string[] = board?.cols ?? []
  const hasAnyName = cols.some((role) => guardNames[role]?.name.trim())
  const saving = updateGuardNamesMutation.isPending
  const loading = boardsQuery.isLoading
  const noBoard = !loading && !board
  const isDisabled = saving || (canEdit && !noBoard && cols.length > 0 && !hasAnyName)

  return (
    <div
      className="flex flex-col flex-1 max-w-mobile mx-auto w-full lg:max-w-none"
      onTouchStart={(e) => {
        touchStartY.current = e.touches[0].clientY
      }}
      onTouchMove={(e) => {
        const dy = e.touches[0].clientY - touchStartY.current
        if (dy > 0) setPullY(Math.min(dy * 0.4, PULL_THRESHOLD))
      }}
      onTouchEnd={() => {
        if (pullY >= PULL_THRESHOLD) boardsQuery.refetch()
        setPullY(0)
      }}
    >
      {/* ── Pull-to-refresh indicator ── */}
      {(pullY > 0 || boardsQuery.isFetching) && (
        <div
          className="flex items-center justify-center overflow-hidden transition-[height] duration-150 bg-background"
          style={{ height: boardsQuery.isFetching ? 48 : pullY }}
        >
          <div
            className={`w-5 h-5 border-2 border-primary border-t-transparent rounded-full ${
              boardsQuery.isFetching ? 'animate-spin' : ''
            }`}
          />
        </div>
      )}

      {/* ── Page header ── */}
      <div className="bg-white border-b border-border px-4 pt-5 pb-4">
        <h1 className="text-xl font-bold text-text-primary">ניהול משמרת</h1>
        <p className="text-text-secondary text-sm mt-0.5">בחר משמרת, הזן שמות — ולחץ שמור</p>
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
        {shiftTypesQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2].map((i) => (
              <div key={i} className="card p-3.5 h-[72px] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className={`grid gap-3 ${shifts.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {shifts.map((shift) => {
              const selected = shift.id === selectedShiftId
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
                        {getShiftShortLabel(shift)}
                      </p>
                      <p className="text-[11px] text-text-muted mt-0.5 tabular-nums" dir="ltr">
                        {getShiftHoursLabel(shift)}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

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
                value={guardNames[role] ?? { name: '', user_id: null }}
                onChange={(assignment) => handleAssignmentChange(role, assignment)}
                profiles={profiles}
                readOnly={!canEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Sticky CTA ── */}
      <div className="bg-white border-t border-border px-4 py-3 safe-bottom">
        <button
          onClick={() => {
            void handleSave()
          }}
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
  )
}

/* ─── GuardNameRow ────────────────────────────────────────────── */

function GuardNameRow({
  role,
  value,
  onChange,
  profiles,
  readOnly,
}: {
  role: string
  value: GuardAssignment
  onChange: (value: GuardAssignment) => void
  profiles: ProfileListItem[]
  readOnly: boolean
}) {
  return (
    <div className="bg-white rounded-xl border border-border flex items-center h-[52px] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-shadow">
      {/* No overflow-hidden here: GuardNameInput's suggestion dropdown is
          absolutely positioned below this row and would get clipped by it. */}
      {/* Role label — appears on right in RTL */}
      <div className="flex items-center justify-end px-4 shrink-0 min-w-[88px] border-l border-border h-full">
        <span className="text-sm font-medium text-text-secondary">{role}</span>
      </div>

      <GuardNameInput value={value} profiles={profiles} onChange={onChange} readOnly={readOnly} />
    </div>
  )
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
  )
}

/* ─── Empty states ────────────────────────────────────────────── */

function NoBoardState() {
  return (
    <div className="card p-6 text-center mt-2">
      <div className="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-3 text-text-secondary">
        <ClipboardIcon />
      </div>
      <p className="font-semibold text-text-primary">אין לוח משמרת</p>
      <p className="text-text-secondary text-sm mt-1.5 leading-relaxed">המנהל צריך ליצור את הלוז תחילה</p>
    </div>
  )
}

function NoColsState() {
  return (
    <div className="card p-6 text-center mt-2">
      <div className="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-3 text-text-secondary">
        <ClipboardIcon />
      </div>
      <p className="font-semibold text-text-primary">לוח ריק</p>
      <p className="text-text-secondary text-sm mt-1.5">לא מוגדרים תפקידים בלוח זה</p>
    </div>
  )
}
