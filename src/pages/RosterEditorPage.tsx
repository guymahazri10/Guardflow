import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePublishRosterBoard, useRosterBoard, useUpdateRosterBoard } from '../hooks/useRosterBoards'
import type { RosterBoardRow } from '../lib/rosterBoards'
import {
  addColumn,
  addTimeRow,
  canPublishRosterBoard,
  ensureRowsHaveAllColumns,
  removeColumn,
  removeTimeRow,
  renameColumn,
  updateCell,
} from '../lib/rosterEditorUtils'

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

export function RosterEditorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const boardId = searchParams.get('id')
  const rosterBoardQuery = useRosterBoard(boardId)
  const updateRosterBoardMutation = useUpdateRosterBoard()
  const publishRosterBoardMutation = usePublishRosterBoard()

  const [loadedBoardId, setLoadedBoardId] = useState<string | null>(null)
  const [cols, setCols] = useState<string[]>([])
  const [rows, setRows] = useState<RosterBoardRow[]>([])
  const [notes, setNotes] = useState('')
  const [published, setPublished] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')
  const [newTimeLabel, setNewTimeLabel] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const board = rosterBoardQuery.data ?? null
  const normalizedRows = useMemo(() => ensureRowsHaveAllColumns(cols, rows), [cols, rows])
  const canPublish = canPublishRosterBoard({ cols, rows: normalizedRows })
  const isSaving = updateRosterBoardMutation.isPending || publishRosterBoardMutation.isPending

  useEffect(() => {
    if (!board || loadedBoardId === board.id) {
      return
    }

    setCols(board.cols)
    setRows(ensureRowsHaveAllColumns(board.cols, board.rows))
    setNotes(board.notes ?? '')
    setPublished(board.published)
    setLoadedBoardId(board.id)
    setActionError(null)
  }, [board, loadedBoardId])

  function handleAddColumn() {
    const result = addColumn(cols, normalizedRows, newColumnName)
    setCols(result.cols)
    setRows(result.rows)

    if (result.cols !== cols) {
      setNewColumnName('')
    }
  }

  function handleRemoveColumn(columnName: string) {
    const result = removeColumn(cols, normalizedRows, columnName)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleRenameColumn(oldName: string, newName: string) {
    const result = renameColumn(cols, normalizedRows, oldName, newName)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleAddTimeRow() {
    const nextRows = addTimeRow(normalizedRows, newTimeLabel)
    setRows(ensureRowsHaveAllColumns(cols, nextRows))

    if (nextRows !== normalizedRows) {
      setNewTimeLabel('')
    }
  }

  function handleRemoveTimeRow(time: string) {
    setRows(removeTimeRow(normalizedRows, time))
  }

  function handleUpdateCell(rowTime: string, columnName: string, value: string) {
    setRows(updateCell(normalizedRows, rowTime, columnName, value))
  }

  async function handleSaveDraft() {
    if (!boardId) {
      return
    }

    setActionError(null)

    try {
      const rowsToSave = ensureRowsHaveAllColumns(cols, normalizedRows)
      const updatedBoard = await updateRosterBoardMutation.mutateAsync({
        id: boardId,
        input: {
          cols,
          rows: rowsToSave,
          notes: notes.trim() ? notes : null,
          published,
        },
      })

      setRows(ensureRowsHaveAllColumns(updatedBoard.cols, updatedBoard.rows))
      setCols(updatedBoard.cols)
      setNotes(updatedBoard.notes ?? '')
      setPublished(updatedBoard.published)
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  async function handleTogglePublished() {
    if (!boardId) {
      return
    }

    if (!published && !canPublish) {
      setActionError('כדי לפרסם צריך להוסיף לפחות תפקיד אחד ובלוק זמן אחד.')
      return
    }

    setActionError(null)

    try {
      if (!published) {
        const rowsToSave = ensureRowsHaveAllColumns(cols, normalizedRows)
        await updateRosterBoardMutation.mutateAsync({
          id: boardId,
          input: {
            cols,
            rows: rowsToSave,
            notes: notes.trim() ? notes : null,
            published: false,
          },
        })
      }

      const updatedBoard = await publishRosterBoardMutation.mutateAsync({
        id: boardId,
        published: !published,
      })

      setPublished(updatedBoard.published)
      setCols(updatedBoard.cols)
      setRows(ensureRowsHaveAllColumns(updatedBoard.cols, updatedBoard.rows))
      setNotes(updatedBoard.notes ?? '')
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  if (!boardId) {
    return (
      <section dir="rtl" className="mx-auto w-full max-w-4xl px-4 py-6 text-right">
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">חסר מזהה לו״ז לעריכה.</p>
      </section>
    )
  }

  if (rosterBoardQuery.isLoading) {
    return (
      <section dir="rtl" className="mx-auto w-full max-w-4xl px-4 py-6 text-right">
        <p className="text-slate-700">טוען לו״ז...</p>
      </section>
    )
  }

  if (rosterBoardQuery.isError) {
    return (
      <section dir="rtl" className="mx-auto w-full max-w-4xl px-4 py-6 text-right">
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">טעינת הלו״ז נכשלה.</p>
      </section>
    )
  }

  if (!board) {
    return (
      <section dir="rtl" className="mx-auto w-full max-w-4xl px-4 py-6 text-right">
        <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">הלוז לא נמצא.</p>
      </section>
    )
  }

  return (
    <section dir="rtl" className="mx-auto w-full max-w-6xl px-4 py-6 text-right">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-950">עריכת לו״ז</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span>{board.shift_id}</span>
            <span>•</span>
            <span>{board.shift_type}</span>
            <span
              className={
                published
                  ? 'rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800'
                  : 'rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800'
              }
            >
              {published ? 'פורסם' : 'טיוטה'}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/admin')}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800"
        >
          חזרה לניהול לו״זים
        </button>
      </div>

      {actionError ? (
        <p className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</p>
      ) : null}

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">הוספת תפקיד</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={newColumnName}
              onChange={(event) => setNewColumnName(event.target.value)}
              placeholder="שם תפקיד"
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-slate-900"
            />
            <button
              type="button"
              onClick={handleAddColumn}
              className="rounded bg-slate-900 px-4 py-2 font-medium text-white"
            >
              הוסף תפקיד
            </button>
          </div>
        </section>

        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">הוספת שורת זמן</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={newTimeLabel}
              onChange={(event) => setNewTimeLabel(event.target.value)}
              placeholder="07:00"
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-slate-900"
              dir="ltr"
            />
            <button
              type="button"
              onClick={handleAddTimeRow}
              className="rounded bg-slate-900 px-4 py-2 font-medium text-white"
            >
              הוסף שורת זמן
            </button>
          </div>
        </section>
      </div>

      <section className="mb-6 rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">מבנה לו״ז</h2>
        {cols.length === 0 || normalizedRows.length === 0 ? (
          <p className="mb-4 text-sm text-slate-500">הוסף לפחות תפקיד אחד ושורת זמן אחת כדי להתחיל לערוך את הטבלה.</p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="min-w-32 border border-slate-200 bg-slate-50 p-2 text-right font-medium text-slate-700">
                  זמן
                </th>
                {cols.map((col) => (
                  <th key={col} className="min-w-44 border border-slate-200 bg-slate-50 p-2 text-right align-top">
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={col}
                        onChange={(event) => handleRenameColumn(col, event.target.value)}
                        className="rounded border border-slate-300 px-2 py-1 text-sm font-medium text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveColumn(col)}
                        className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700"
                      >
                        מחק תפקיד
                      </button>
                    </div>
                  </th>
                ))}
                <th className="min-w-24 border border-slate-200 bg-slate-50 p-2 text-right font-medium text-slate-700">
                  פעולות
                </th>
              </tr>
            </thead>
            <tbody>
              {normalizedRows.map((row) => (
                <tr key={row.time}>
                  <th className="border border-slate-200 bg-slate-50 p-2 text-right font-medium text-slate-800">
                    {row.time}
                  </th>
                  {cols.map((col) => (
                    <td key={`${row.time}-${col}`} className="border border-slate-200 p-2">
                      <input
                        type="text"
                        value={row.cells[col] ?? ''}
                        onChange={(event) => handleUpdateCell(row.time, col, event.target.value)}
                        className="w-full min-w-36 rounded border border-slate-300 px-2 py-1 text-slate-900"
                      />
                    </td>
                  ))}
                  <td className="border border-slate-200 p-2">
                    <button
                      type="button"
                      onClick={() => handleRemoveTimeRow(row.time)}
                      className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700"
                    >
                      מחק שורה
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6 rounded border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-700">
          הערות
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
      </section>

      {!canPublish ? (
        <p className="mb-3 text-sm text-slate-500">כדי לפרסם צריך להוסיף לפחות תפקיד אחד ובלוק זמן אחד.</p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            void handleSaveDraft()
          }}
          disabled={isSaving}
          className="rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          שמור טיוטה
        </button>
        <button
          type="button"
          onClick={() => {
            void handleTogglePublished()
          }}
          disabled={isSaving || (!published && !canPublish)}
          className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          {published ? 'החזר לטיוטה' : 'פרסם'}
        </button>
      </div>
    </section>
  )
}
