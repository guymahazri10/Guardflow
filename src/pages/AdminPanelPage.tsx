import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateRosterBoard, useDeleteRosterBoard, useRosterBoards } from '../hooks/useRosterBoards'
import { findDefaultRosterTemplateByShiftId } from '../lib/defaultRosterTemplates'
import { SHIFT_CATEGORIES, SHIFTS, getShiftHoursLabel, type ShiftConfig } from '../constants/shifts'
import type { RosterBoard } from '../lib/rosterBoards'

type ShiftDisplay = {
  shift: ShiftConfig
  title: string
  subtitle: string
}

/** Guard count comes from defaultRosterTemplates.ts (subLabel); hours use the
 *  canonical category boundary (07:00–15:00 / 15:00–23:00 / 23:00–07:00),
 *  not the template's real-world hours which include a 30min handover
 *  buffer (e.g. morning_6 actually ends 15:30) — that buffer is real
 *  schedule data, not something we want surfaced as "the shift's hours". */
function buildShiftDisplay(shift: ShiftConfig): ShiftDisplay {
  const template = findDefaultRosterTemplateByShiftId(shift.id)
  const hours = getShiftHoursLabel(shift)

  return {
    shift,
    title: template?.label ?? `משמרת ${SHIFT_CATEGORIES[shift.category].label}`,
    subtitle: template ? `${template.subLabel} · ${hours}` : `${shift.label} · ${hours}`,
  }
}

const SHIFT_DISPLAYS: ShiftDisplay[] = SHIFTS.map(buildShiftDisplay)

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

export function AdminPanelPage() {
  const navigate = useNavigate()
  const rosterBoardsQuery = useRosterBoards()
  const createRosterBoardMutation = useCreateRosterBoard()
  const deleteRosterBoardMutation = useDeleteRosterBoard()

  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [creatingShiftId, setCreatingShiftId] = useState<string | null>(null)

  const boards = rosterBoardsQuery.data ?? []

  // Latest board per shift_id — nothing enforces one-board-per-shift at the DB
  // level, so this list intentionally shows the newest and ignores older ones.
  const boardByShiftId = useMemo(() => {
    const map = new Map<string, RosterBoard>()
    for (const board of boards) {
      const current = map.get(board.shift_id)
      if (!current || board.created_at > current.created_at) {
        map.set(board.shift_id, board)
      }
    }
    return map
  }, [boards])

  const existingDisplays = SHIFT_DISPLAYS.filter((display) => boardByShiftId.has(display.shift.id))
  const selectedBoard = selectedShiftId ? (boardByShiftId.get(selectedShiftId) ?? null) : null
  const selectedDisplay = selectedShiftId
    ? (SHIFT_DISPLAYS.find((display) => display.shift.id === selectedShiftId) ?? null)
    : null

  const isDeleting = deleteRosterBoardMutation.isPending

  function handleSelect(shiftId: string) {
    setSelectedShiftId((prev) => (prev === shiftId ? null : shiftId))
  }

  function handleOpenEditor() {
    if (!selectedBoard) return
    navigate(`/roster-editor?id=${encodeURIComponent(selectedBoard.id)}`)
  }

  async function handlePickFromSheet(shiftId: string) {
    setActionError(null)

    if (boardByShiftId.has(shiftId)) {
      setShowPicker(false)
      setSelectedShiftId(shiftId)
      return
    }

    const template = findDefaultRosterTemplateByShiftId(shiftId)

    if (!template) {
      setActionError('לא נמצאה תבנית למשמרת שנבחרה.')
      return
    }

    setCreatingShiftId(shiftId)

    try {
      const board = await createRosterBoardMutation.mutateAsync({
        shift_id: template.shift_id,
        shift_type: template.shift_type,
        cols: template.cols,
        rows: template.rows,
        notes: template.notes,
        published: false,
      })
      setShowPicker(false)
      setSelectedShiftId(board.shift_id)
    } catch (error) {
      setActionError(getReadableError(error))
    } finally {
      setCreatingShiftId(null)
    }
  }

  async function handleDelete(board: RosterBoard, event: React.MouseEvent) {
    event.stopPropagation()

    if (!window.confirm('האם אתה בטוח שברצונך למחוק את הלוז?')) {
      return
    }

    setActionError(null)

    try {
      await deleteRosterBoardMutation.mutateAsync(board.id)
      setSelectedShiftId((prev) => (prev === board.shift_id ? null : prev))
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  return (
    <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
      {/* ── Header ── */}
      <div className="bg-white border-b border-border px-4 pt-5 pb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">ניהול לו״זים</h1>
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold text-primary bg-primary-light border border-primary/20 rounded-xl active:opacity-80 transition-opacity"
        >
          <span className="text-base leading-none">+</span> לוז חדש
        </button>
      </div>

      {/* ── Helper text ── */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs text-text-secondary leading-relaxed">
          📋 <strong className="text-text-primary font-semibold">בחר משמרת מהרשימה</strong> ולאחר מכן לחץ{' '}
          <strong className="text-text-primary font-semibold">פתח לוז</strong> כדי לערוך שיבוצים ולפרסם.
        </p>
      </div>

      {actionError && (
        <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {rosterBoardsQuery.isError && (
        <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          טעינת הלו״זים נכשלה. נסה לרענן את העמוד.
        </div>
      )}

      {/* ── Existing boards list ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5 pb-6">
        {rosterBoardsQuery.isLoading ? (
          <ListSkeleton />
        ) : existingDisplays.length === 0 ? (
          <EmptyState />
        ) : (
          existingDisplays.map(({ shift, title, subtitle }) => {
            const board = boardByShiftId.get(shift.id)
            if (!board) return null
            const selected = selectedShiftId === shift.id

            return (
              <button
                key={shift.id}
                onClick={() => handleSelect(shift.id)}
                className={`card p-3.5 text-right flex items-center gap-3 transition-all active:scale-[0.98] ${
                  selected ? 'ring-2 ring-primary' : ''
                }`}
              >
                <span className="text-2xl shrink-0">{shift.emoji}</span>

                <div className="flex-1 text-right min-w-0">
                  <p className="text-sm font-bold text-text-primary">{title}</p>
                  <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {board.published ? (
                    <span className="text-[11px] font-bold bg-green-100 text-green-800 rounded-badge px-2 py-0.5">
                      ✅ פורסם
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold bg-amber-100 text-amber-800 rounded-badge px-2 py-0.5">
                      טיוטה
                    </span>
                  )}
                  <span
                    role="button"
                    onClick={(event) => {
                      void handleDelete(board, event)
                    }}
                    className={`text-[11px] font-medium text-red-500 active:opacity-70 ${
                      isDeleting ? 'pointer-events-none opacity-40' : ''
                    }`}
                  >
                    מחק
                  </span>
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* ── Sticky CTA ── */}
      <div className="bg-white border-t border-border px-4 py-3 safe-bottom">
        {!selectedBoard ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-text-muted text-center font-medium">בחר משמרת מהרשימה כדי לפתוח את הלוז</p>
            <button disabled className="btn-primary w-full h-14 text-[15px] rounded-[14px] opacity-40 cursor-not-allowed">
              פתח לוז
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-text-secondary text-center font-medium">
              {selectedDisplay?.title} — {selectedDisplay?.subtitle}
            </p>
            <button onClick={handleOpenEditor} className="btn-primary w-full h-14 text-[15px] rounded-[14px]">
              פתח לוז ←
            </button>
          </div>
        )}
      </div>

      {/* ── Shift picker bottom sheet ── */}
      {showPicker && (
        <div
          onClick={() => setShowPicker(false)}
          className="fixed inset-0 bg-black/45 z-[100] flex items-end"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-mobile mx-auto bg-white rounded-t-[20px] safe-bottom"
          >
            <div className="px-5 pt-4.5 pb-3.5 border-b border-border flex items-center justify-between">
              <span className="text-sm font-bold text-text-primary">בחר סוג משמרת</span>
              <button
                onClick={() => setShowPicker(false)}
                className="text-text-muted p-1 active:opacity-70"
                aria-label="סגור"
              >
                ✕
              </button>
            </div>

            <div className="py-2 pb-1">
              {SHIFT_DISPLAYS.map(({ shift, title, subtitle }) => {
                const exists = boardByShiftId.has(shift.id)
                const creating = creatingShiftId === shift.id

                return (
                  <button
                    key={shift.id}
                    disabled={creating}
                    onClick={() => {
                      void handlePickFromSheet(shift.id)
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3.5 min-h-14 text-right disabled:opacity-50"
                  >
                    <span className="text-xl w-8 text-center shrink-0">{shift.emoji}</span>
                    <div className="flex-1">
                      <div className="text-sm font-bold text-text-primary">{title}</div>
                      <div className="text-[11px] text-text-muted mt-0.5">{subtitle}</div>
                    </div>
                    {creating ? (
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
                    ) : exists ? (
                      <span className="text-[11px] font-bold text-green-600 bg-green-50 border border-green-200 rounded-badge px-2 py-0.5 shrink-0">
                        קיים ✓
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-muted shrink-0">+ חדש</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card p-3.5 flex items-center gap-3 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-border shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3.5 w-24 bg-border rounded" />
            <div className="h-3 w-32 bg-border rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="card p-8 text-center mt-2">
      <p className="text-4xl mb-3">📋</p>
      <p className="font-semibold text-text-primary">אין לוזים עדיין</p>
      <p className="text-text-secondary text-sm mt-1.5 leading-relaxed">
        לחץ על <strong className="text-text-primary font-semibold">לוז חדש</strong> למעלה כדי להתחיל.
      </p>
    </div>
  )
}
