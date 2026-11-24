import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import {
  getActiveCategory,
  type ShiftCategory,
  type ShiftConfig,
} from '../constants/shifts'
import { useShiftTypes } from '../hooks/useShiftTypes'
import {
  rosterBoardKeys,
  usePublishedRosterBoards,
  useRosterBoardsByShiftId,
} from '../hooks/useRosterBoards'
import { useProfiles } from '../hooks/useProfiles'
import { useFeatureEnabled } from '../hooks/useFeatureFlag'
import type { ProfileListItem } from '../lib/profiles'
import type { GuardAssignment, RosterBoard } from '../lib/rosterBoards'
import GuardNameInput from '../components/ui/GuardNameInput'
import { ShiftPicker } from '../components/ShiftPicker'
import { ClipboardIcon } from '../components/ui/StateIcon'
import type { ShiftAssignment } from '../lib/scheduleImports'
import { useShiftAssignmentsForWeek } from '../hooks/useShiftAssignments'
import { useCancelledSlots } from '../hooks/useCancelledSlots'
import {
  workDateForCategory,
  weekStartIsoFor,
  indexDatedBySlot,
  indexCancelledBySlot,
  type CancelledSlotRef,
  keepTemplateNamesForSlots,
  effectiveAssignmentName,
  effectiveAssignmentUserId,
} from '../lib/scheduleImport/boardDatedSync'
import { planDatedWrites } from '../lib/scheduleImport/rosterSave'
import { pickMostRecentlyTouchedBoard } from '../lib/activeBoardSelection'
import { supabase } from '../lib/supabase'

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
  const queryClient = useQueryClient()
  // every signed-in role sees the published dated schedule; only the global switch gates it
  const scheduleImportFlag = useFeatureEnabled('weekly_schedule_import')

  const shiftTypesQuery = useShiftTypes()
  const allShifts = shiftTypesQuery.data ?? []

  const [category, setCategory] = useState<ShiftCategory>(() => getActiveCategory())
  const [pickedShiftId, setSelectedShiftId] = useState<string | null>(null)

  const publishedBoardsQuery = usePublishedRosterBoards()
  const publishedBoards = publishedBoardsQuery.data

  // The variant the live screen is showing for a category — the same pick
  // useActiveBoard makes, so the badge and the default selection here can
  // never disagree with what "שידור חי" renders.
  function liveShiftIdFor(cat: ShiftCategory): string | null {
    const inCategory = new Set(allShifts.filter((s) => s.category === cat).map((s) => s.id))
    const candidates = (publishedBoards ?? []).filter((b) => inCategory.has(b.shift_id))
    return pickMostRecentlyTouchedBoard(candidates)?.shift_id ?? null
  }

  const selectedShiftId = pickedShiftId ?? (publishedBoardsQuery.isLoading ? null :
    liveShiftIdFor(category) ?? allShifts.find((shift) => shift.category === category)?.id ?? null)
  const [guardNames, setGuardNames] = useState<Record<string, GuardAssignment>>({})

  const boardsQuery = useRosterBoardsByShiftId(selectedShiftId)
  const save = useMutation({
    mutationFn: async (input: {
      p_board_id: string
      p_expected_updated_at: string
      p_guard_names: Record<string, GuardAssignment>
      p_work_date: string
      p_replacements: { id: string; expected_at: string; name: string; user_id: string | null }[]
    }) => {
      const { error } = await supabase.rpc('save_shift_setup', input)
      if (error) throw error
    },
  })
  const profilesQuery = useProfiles({ enabled: canEdit })
  const profiles = profilesQuery.data ?? []

  const board = pickBoardToEdit(boardsQuery.data ?? [])

  // The dated layer this board's slots map onto, if the import feature is on.
  // Read here — not just written on save — so this screen shows the same
  // names the live screen does; see indexDatedBySlot for why they diverged.
  const [openedAt] = useState(() => new Date())
  const workDate = workDateForCategory(category, openedAt)
  const week = scheduleImportFlag.enabled ? weekStartIsoFor(new Date(workDate + 'T12:00:00')) : ''
  const assignmentsQuery = useShiftAssignmentsForWeek(week)
  const { slots: cancelledSlots, isLoading: cancelledLoading, isError: cancelledError } = useCancelledSlots(week)
  const datedBySlot = useMemo(
    () =>
      board && scheduleImportFlag.enabled
        ? indexDatedBySlot(assignmentsQuery.data ?? [], board.cols ?? [], board.shift_type, workDate)
        : new Map<string, ShiftAssignment>(),
    [board, assignmentsQuery.data, scheduleImportFlag.enabled, workDate],
  )

  // A shift a manager cancelled in the weekly schedule must show as EMPTY here
  // (never the older name from the board template) and is not editable from this
  // screen: restoring it is done in the weekly schedule.
  const cancelledBySlot = useMemo(
    () =>
      board && scheduleImportFlag.enabled
        ? indexCancelledBySlot(cancelledSlots, assignmentsQuery.data ?? [], board.cols ?? [], board.shift_type, workDate)
        : new Map<string, CancelledSlotRef>(),
    [board, cancelledSlots, assignmentsQuery.data, scheduleImportFlag.enabled, workDate],
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
  const snapshot = useRef<{ board: RosterBoard; dated: Map<string, ShiftAssignment> } | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const initializedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!board) return
    const datedPending = scheduleImportFlag.enabled && assignmentsQuery.isLoading
    if (scheduleImportFlag.loading || datedPending || (scheduleImportFlag.enabled && (cancelledLoading || assignmentsQuery.isError || cancelledError))) return

    const key = `${board.id}|${workDate}|${reloadVersion}|${scheduleImportFlag.enabled}`
    if (initializedKeyRef.current === key) return
    initializedKeyRef.current = key
    snapshot.current = { board, dated: datedBySlot }

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
    for (const role of cancelledBySlot.keys()) next[role] = { name: '', user_id: null }
    setGuardNames(next)
  }, [board, workDate, datedBySlot, cancelledBySlot, scheduleImportFlag.enabled, scheduleImportFlag.loading, assignmentsQuery.isLoading, assignmentsQuery.isError, cancelledError, cancelledLoading, reloadVersion])

  // Picking a shift in the menu selects its category and that variant; loading its board,
  // saving and going on air are unchanged.
  function handleShiftPick(shift: ShiftConfig) {
    setCategory(shift.category)
    setSelectedShiftId(shift.id)
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

    const original = snapshot.current
    if (!original || original.board.id !== board.id || save.isPending) return
    try {
      await save.mutateAsync({
        p_board_id: board.id,
        p_expected_updated_at: original.board.updated_at,
        p_guard_names: keepTemplateNamesForSlots(guardNames, original.board.guard_names, cancelledBySlot.keys()),
        p_work_date: workDate,
        p_replacements: planDatedWrites(original.dated, guardNames)
          .filter(({ role }) => !cancelledBySlot.has(role))
          .map(({ assignment, edited }) => ({
            id: assignment.id, expected_at: assignment.updated_at, ...edited,
          })),
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '40001') {
        await Promise.all([boardsQuery.refetch(), week && assignmentsQuery.refetch()])
        setReloadVersion((v) => v + 1)
        toast.error('השיבוץ השתנה בינתיים. הנתונים נטענו מחדש. בדוק את השמות לפני שמירה נוספת.')
      } else {
        console.error('Shift setup save failed', error)
        toast.error('שמירת השיבוץ נכשלה. בדוק את הלוח ונסה שוב.')
      }
      return
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: rosterBoardKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['shift-assignments'] }),
    ])
    toast.success('השיבוץ נשמר והלוח עודכן לשידור')
    navigate('/shift-live')
  }

  // ── Derived ──
  const cols: string[] = board?.cols ?? []
  const saving = save.isPending
  const loading = boardsQuery.isLoading || scheduleImportFlag.loading || (scheduleImportFlag.enabled && (assignmentsQuery.isLoading || cancelledLoading))
  const noBoard = !loading && !board
  const scheduleError = scheduleImportFlag.isError || (scheduleImportFlag.enabled && (assignmentsQuery.isError || cancelledError))
  const incomplete = !board?.rows.length || !cols.length
  const isDisabled = saving || (canEdit && (loading || scheduleError || incomplete))

  return (
    <div
      className="flex flex-col flex-1 max-w-mobile mx-auto w-full lg:max-w-5xl"
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
      <div className="page-header">
        <h1 className="text-xl font-bold text-text-primary">ניהול משמרת</h1>
        <p className="text-text-secondary text-sm mt-0.5">בחר משמרת, הזן שמות — ולחץ שמור</p>
      </div>

      {/* ── Shift choice: בוקר | צהריים | לילה, each opening a small menu of its shifts ── */}
      <ShiftPicker
        shifts={allShifts}
        category={category}
        selectedShiftId={selectedShiftId}
        liveShiftIds={{
          morning: liveShiftIdFor('morning'),
          afternoon: liveShiftIdFor('afternoon'),
          night: liveShiftIdFor('night'),
        }}
        loading={shiftTypesQuery.isLoading}
        onSelect={handleShiftPick}
      />

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-6">
        {/* Guard name inputs */}
        {scheduleError ? (
          <p role="alert">טעינת הסידור נכשלה. רענן את המסך כדי לנסות שוב.</p>
        ) : loading ? (
          <InputSkeleton />
        ) : noBoard ? (
          <NoBoardState />
        ) : cols.length === 0 ? (
          <NoColsState />
        ) : (
          <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:content-start">
            <p className="text-xs font-medium text-text-muted lg:col-span-2">שמות מאבטחים</p>
            {cancelledBySlot.size > 0 && (
              <div className="card p-3 text-xs text-text-secondary leading-relaxed lg:col-span-2" role="note">
                {cancelledBySlot.size === 1 ? 'שיבוץ אחד בוטל' : `${cancelledBySlot.size} שיבוצים בוטלו`} בלו״ז השבועי ולכן מוצג ריק.{' '}
                <Link to="/weekly-schedule" className="font-bold text-primary underline">
                  לשחזור — ללו״ז השבועי
                </Link>
              </div>
            )}
            {incomplete && (
              <div className="card p-3 text-xs text-text-secondary leading-relaxed lg:col-span-2" role="note">
                חסרים בלוקי זמן בלוח. מנהל יכול להשלים את הלוח לפני העלאה לשידור.
              </div>
            )}
            {cols.map((role) => (
              <GuardNameRow
                key={role}
                role={role}
                value={guardNames[role] ?? { name: '', user_id: null }}
                onChange={(assignment) => handleAssignmentChange(role, assignment)}
                profiles={profiles}
                readOnly={saving || !canEdit || cancelledBySlot.has(role)}
                locked={cancelledBySlot.has(role)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Sticky CTA ── */}
      <div className="page-footer">
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
  locked,
}: {
  role: string
  value: GuardAssignment
  onChange: (value: GuardAssignment) => void
  profiles: ProfileListItem[]
  readOnly: boolean
  locked: boolean
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
      {locked && (
        <span className="px-3 text-[11px] text-text-muted shrink-0" title="שיבוץ שבוטל בסידור השבועי">
          בוטל
        </span>
      )}
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
