import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useCreateRosterBoard,
  useDeleteRosterBoard,
  usePublishRosterBoard,
  useRosterBoards,
} from '../hooks/useRosterBoards'
import { findDefaultRosterTemplateByShiftId } from '../lib/defaultRosterTemplates'
import type { RosterBoard } from '../lib/rosterBoards'

type ShiftVariant = {
  id: string
  label: string
  shiftType: 'morning' | 'afternoon' | 'night'
}

type ShiftGroup = {
  key: ShiftVariant['shiftType']
  label: string
  shiftIds: string[]
}

const SHIFT_VARIANTS: ShiftVariant[] = [
  { id: 'morning_6', label: 'בוקר 6', shiftType: 'morning' },
  { id: 'morning_5', label: 'בוקר 5', shiftType: 'morning' },
  { id: 'afternoon_4', label: 'צהריים 4', shiftType: 'afternoon' },
  { id: 'afternoon_3', label: 'צהריים 3', shiftType: 'afternoon' },
  { id: 'night', label: 'לילה', shiftType: 'night' },
]

const SHIFT_GROUPS: ShiftGroup[] = [
  { key: 'morning', label: 'בוקר', shiftIds: ['morning_6', 'morning_5'] },
  { key: 'afternoon', label: 'צהריים', shiftIds: ['afternoon_4', 'afternoon_3'] },
  { key: 'night', label: 'לילה', shiftIds: ['night'] },
]

function canPublishBoard(board: RosterBoard) {
  return board.cols.length > 0 && board.rows.length > 0
}

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

export function AdminPanelPage() {
  const navigate = useNavigate()
  const [selectedShiftId, setSelectedShiftId] = useState(SHIFT_VARIANTS[0].id)
  const [actionError, setActionError] = useState<string | null>(null)
  const rosterBoardsQuery = useRosterBoards()
  const createRosterBoardMutation = useCreateRosterBoard()
  const publishRosterBoardMutation = usePublishRosterBoard()
  const deleteRosterBoardMutation = useDeleteRosterBoard()

  const boards = rosterBoardsQuery.data ?? []
  const groupedBoards = useMemo(
    () =>
      SHIFT_GROUPS.map((group) => ({
        ...group,
        boards: boards.filter((board) => group.shiftIds.includes(board.shift_id)),
      })),
    [boards],
  )

  const isMutating =
    createRosterBoardMutation.isPending ||
    publishRosterBoardMutation.isPending ||
    deleteRosterBoardMutation.isPending

  async function handleCreateRosterBoard() {
    const selectedVariant = SHIFT_VARIANTS.find((variant) => variant.id === selectedShiftId)

    if (!selectedVariant) {
      setActionError('סוג המשמרת שנבחר אינו תקין.')
      return
    }

    setActionError(null)

    try {
      await createRosterBoardMutation.mutateAsync({
        shift_id: selectedVariant.id,
        shift_type: selectedVariant.shiftType,
        cols: [],
        rows: [],
        notes: null,
        published: false,
      })
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  async function handleCreateRosterBoardFromTemplate() {
    const template = findDefaultRosterTemplateByShiftId(selectedShiftId)

    if (!template) {
      setActionError('לא נמצאה תבנית למשמרת שנבחרה.')
      return
    }

    setActionError(null)

    try {
      await createRosterBoardMutation.mutateAsync({
        shift_id: template.shift_id,
        shift_type: template.shift_type,
        cols: template.cols,
        rows: template.rows,
        notes: template.notes,
        published: false,
      })
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  async function handleTogglePublished(board: RosterBoard) {
    if (!board.published && !canPublishBoard(board)) {
      setActionError('כדי לפרסם צריך להוסיף לפחות תפקיד אחד ובלוק זמן אחד.')
      return
    }

    setActionError(null)

    try {
      await publishRosterBoardMutation.mutateAsync({ id: board.id, published: !board.published })
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  async function handleDeleteRosterBoard(board: RosterBoard) {
    if (!window.confirm('האם אתה בטוח שברצונך למחוק את הלוז?')) {
      return
    }

    setActionError(null)

    try {
      await deleteRosterBoardMutation.mutateAsync(board.id)
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  return (
    <section dir="rtl" className="mx-auto w-full max-w-5xl px-4 py-6 text-right">
      <div className="mb-6 space-y-2">
        <h1 className="text-2xl font-bold text-slate-950">ניהול לו״זים</h1>
        <p className="text-sm text-slate-600">יצירה וניהול של תבניות לו״ז למשמרות.</p>
      </div>

      <section className="mb-6 rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">יצירת לו״ז חדש</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-slate-700">
            משמרת
            <select
              value={selectedShiftId}
              onChange={(event) => setSelectedShiftId(event.target.value)}
              disabled={isMutating}
              className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 disabled:bg-slate-100"
            >
              {SHIFT_VARIANTS.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.label} ({variant.id})
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                void handleCreateRosterBoard()
              }}
              disabled={isMutating}
              className="rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              צור לו״ז
            </button>
            <button
              type="button"
              onClick={() => {
                void handleCreateRosterBoardFromTemplate()
              }}
              disabled={isMutating}
              className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              צור מתבנית
            </button>
          </div>
        </div>
      </section>

      {rosterBoardsQuery.isLoading ? <p className="text-slate-700">טוען לו״זים...</p> : null}

      {rosterBoardsQuery.isError ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          טעינת הלו״זים נכשלה. נסה לרענן את העמוד.
        </p>
      ) : null}

      {actionError ? (
        <p className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</p>
      ) : null}

      {!rosterBoardsQuery.isLoading && !rosterBoardsQuery.isError && boards.length === 0 ? (
        <p className="rounded border border-slate-200 bg-slate-50 p-4 text-slate-600">עדיין לא נוצרו לו״זים.</p>
      ) : null}

      <div className="space-y-8">
        {groupedBoards.map((group) => (
          <section key={group.key} className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">{group.label}</h2>
            {group.boards.length === 0 ? (
              <p className="text-sm text-slate-500">אין לו״זים בקבוצה זו.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {group.boards.map((board) => {
                  const publishDisabled = !board.published && !canPublishBoard(board)

                  return (
                    <article key={board.id} className="rounded border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-slate-950">{board.shift_id}</h3>
                          <p className="text-sm text-slate-600">{board.shift_type}</p>
                        </div>
                        <span
                          className={
                            board.published
                              ? 'rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800'
                              : 'rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800'
                          }
                        >
                          {board.published ? 'פורסם' : 'טיוטה'}
                        </span>
                      </div>

                      <dl className="mb-3 grid grid-cols-2 gap-3 text-sm text-slate-700">
                        <div>
                          <dt className="text-slate-500">עמודות / תפקידים</dt>
                          <dd className="font-medium text-slate-900">{board.cols.length}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">שורות / זמני פעילות</dt>
                          <dd className="font-medium text-slate-900">{board.rows.length}</dd>
                        </div>
                      </dl>

                      {board.notes ? <p className="mb-4 text-sm text-slate-600">{board.notes}</p> : null}

                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <button
                          type="button"
                          onClick={() => navigate(`/roster-editor?id=${encodeURIComponent(board.id)}`)}
                          className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800"
                        >
                          ערוך לוז
                        </button>
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              void handleTogglePublished(board)
                            }}
                            disabled={isMutating || publishDisabled}
                            title={
                              publishDisabled
                                ? 'כדי לפרסם צריך להוסיף לפחות תפקיד אחד ובלוק זמן אחד.'
                                : undefined
                            }
                            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            {board.published ? 'החזר לטיוטה' : 'פרסם'}
                          </button>
                          {publishDisabled ? (
                            <p className="max-w-56 text-xs text-slate-500">
                              כדי לפרסם צריך להוסיף לפחות תפקיד אחד ובלוק זמן אחד.
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void handleDeleteRosterBoard(board)
                          }}
                          disabled={isMutating}
                          className="rounded border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                        >
                          מחק
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  )
}
