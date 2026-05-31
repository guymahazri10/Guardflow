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

const publishHelperText = 'כדי לפרסם צריך להוסיף לפחות תפקיד אחד ובלוק זמן אחד.'

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
  const hasEditableStructure = cols.length > 0 && normalizedRows.length > 0

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

  function handleColumnRenameBlur(oldName: string, value: string, input: HTMLInputElement) {
    const trimmedValue = value.trim()

    if (!trimmedValue || (trimmedValue !== oldName && cols.includes(trimmedValue))) {
      input.value = oldName
      return
    }

    handleRenameColumn(oldName, trimmedValue)
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
      setActionError(publishHelperText)
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
      <section dir="rtl" className="mx-auto w-full max-w-7xl px-4 py-6 text-right sm:px-6 lg:px-8">
        <p className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">חסר מזהה לו״ז לעריכה.</p>
      </section>
    )
  }

  if (rosterBoardQuery.isLoading) {
    return (
      <section dir="rtl" className="mx-auto w-full max-w-7xl px-4 py-6 text-right sm:px-6 lg:px-8">
        <p className="text-base text-slate-700">טוען לו״ז...</p>
      </section>
    )
  }

  if (rosterBoardQuery.isError) {
    return (
      <section dir="rtl" className="mx-auto w-full max-w-7xl px-4 py-6 text-right sm:px-6 lg:px-8">
        <p className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">טעינת הלו״ז נכשלה.</p>
      </section>
    )
  }

  if (!board) {
    return (
      <section dir="rtl" className="mx-auto w-full max-w-7xl px-4 py-6 text-right sm:px-6 lg:px-8">
        <p className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">הלוז לא נמצא.</p>
      </section>
    )
  }

  return (
    <section dir="rtl" className="mx-auto w-full max-w-7xl px-4 py-6 text-right sm:px-6 lg:px-8">
      <header className="mb-5 rounded border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">עריכת לו״ז</h1>
              <span
                className={
                  published
                    ? 'rounded bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800'
                    : 'rounded bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800'
                }
              >
                {published ? 'פורסם' : 'טיוטה'}
              </span>
            </div>
            <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <span className="block font-medium text-slate-800">מזהה משמרת</span>
                <span>{board.shift_id}</span>
              </div>
              <div>
                <span className="block font-medium text-slate-800">סוג משמרת</span>
                <span>{board.shift_type}</span>
              </div>
              <div>
                <span className="block font-medium text-slate-800">תפקידים</span>
                <span>{cols.length}</span>
              </div>
              <div>
                <span className="block font-medium text-slate-800">בלוקי זמן</span>
                <span>{normalizedRows.length}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="w-full rounded border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 sm:w-auto"
          >
            חזרה לניהול לו״זים
          </button>
        </div>
      </header>

      {actionError ? (
        <p className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{actionError}</p>
      ) : null}

      <section className="mb-5 rounded border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
          <div>
            <h2 className="mb-2 text-base font-semibold text-slate-900">הוספת תפקיד</h2>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                type="text"
                value={newColumnName}
                onChange={(event) => setNewColumnName(event.target.value)}
                placeholder="שם תפקיד"
                className="min-h-11 w-full rounded border border-slate-300 px-3 py-2 text-base text-slate-900"
              />
              <button
                type="button"
                onClick={handleAddColumn}
                className="min-h-11 rounded bg-slate-900 px-4 py-2 font-medium text-white sm:whitespace-nowrap"
              >
                הוסף תפקיד
              </button>
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-base font-semibold text-slate-900">הוספת שורת זמן</h2>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                type="text"
                value={newTimeLabel}
                onChange={(event) => setNewTimeLabel(event.target.value)}
                placeholder="07:00"
                className="min-h-11 w-full rounded border border-slate-300 px-3 py-2 text-base text-slate-900"
                dir="ltr"
              />
              <button
                type="button"
                onClick={handleAddTimeRow}
                className="min-h-11 rounded bg-slate-900 px-4 py-2 font-medium text-white sm:whitespace-nowrap"
              >
                הוסף שורת זמן
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row xl:min-w-72 xl:flex-col">
            <button
              type="button"
              onClick={() => {
                void handleSaveDraft()
              }}
              disabled={isSaving}
              className="min-h-11 rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              שמור טיוטה
            </button>
            <button
              type="button"
              onClick={() => {
                void handleTogglePublished()
              }}
              disabled={isSaving || (!published && !canPublish)}
              className="min-h-11 rounded border border-slate-300 px-4 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              {published ? 'החזר לטיוטה' : 'פרסם'}
            </button>
          </div>
        </div>
        {!canPublish ? <p className="mt-3 text-sm text-slate-500">{publishHelperText}</p> : null}
      </section>

      <section className="mb-5 rounded border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">מבנה לו״ז</h2>
            <p className="mt-1 text-sm text-slate-500">עריכת תפקידים, בלוקי זמן ותוכן התאים.</p>
          </div>
          <div className="text-sm text-slate-600">
            {cols.length} תפקידים · {normalizedRows.length} בלוקי זמן
          </div>
        </div>

        {!hasEditableStructure ? (
          <div className="p-6 text-center text-base text-slate-600">
            כדי להתחיל, הוסף לפחות תפקיד אחד ושורת זמן אחת.
          </div>
        ) : (
          <div className="overflow-x-auto p-3 sm:p-4" dir="rtl">
            <table className="w-max min-w-full border-separate border-spacing-0 text-base">
              <thead>
                <tr>
                  <th className="sticky right-0 z-20 min-w-32 border border-slate-200 bg-slate-100 p-3 text-right font-semibold text-slate-800">
                    זמן
                  </th>
                  {cols.map((col) => (
                    <th key={col} className="min-w-56 border-y border-l border-slate-200 bg-slate-100 p-3 text-right align-top">
                      <div className="flex min-w-52 flex-col gap-2">
                        <input
                          type="text"
                          defaultValue={col}
                          onBlur={(event) => handleColumnRenameBlur(col, event.currentTarget.value, event.currentTarget)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            }
                          }}
                          className="min-h-10 rounded border border-slate-300 bg-white px-3 py-2 text-base font-medium text-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveColumn(col)}
                          className="rounded border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700"
                        >
                          מחק תפקיד
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="min-w-28 border-y border-l border-slate-200 bg-slate-100 p-3 text-right font-semibold text-slate-800">
                    פעולות
                  </th>
                </tr>
              </thead>
              <tbody>
                {normalizedRows.map((row) => (
                  <tr key={row.time}>
                    <th className="sticky right-0 z-10 border-x border-b border-slate-200 bg-slate-50 p-3 text-right text-base font-semibold text-slate-800">
                      {row.time}
                    </th>
                    {cols.map((col) => (
                      <td key={`${row.time}-${col}`} className="border-b border-l border-slate-200 bg-white p-2.5">
                        <input
                          type="text"
                          value={row.cells[col] ?? ''}
                          onChange={(event) => handleUpdateCell(row.time, col, event.target.value)}
                          className="min-h-11 w-full min-w-48 rounded border border-slate-300 px-3 py-2 text-base text-slate-900"
                        />
                      </td>
                    ))}
                    <td className="border-b border-l border-slate-200 bg-white p-2.5">
                      <button
                        type="button"
                        onClick={() => handleRemoveTimeRow(row.time)}
                        className="min-h-10 rounded border border-red-200 px-3 py-2 text-sm font-medium text-red-700"
                      >
                        מחק שורה
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-5 rounded border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <label className="block text-base font-semibold text-slate-900">
          הערות
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            className="mt-3 w-full rounded border border-slate-300 px-3 py-2 text-base text-slate-900"
          />
        </label>
      </section>

      <footer className="rounded border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        {!canPublish ? <p className="mb-3 text-sm text-slate-500">{publishHelperText}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => {
              void handleSaveDraft()
            }}
            disabled={isSaving}
            className="min-h-11 rounded bg-slate-900 px-5 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            שמור טיוטה
          </button>
          <button
            type="button"
            onClick={() => {
              void handleTogglePublished()
            }}
            disabled={isSaving || (!published && !canPublish)}
            className="min-h-11 rounded border border-slate-300 px-5 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            {published ? 'החזר לטיוטה' : 'פרסם'}
          </button>
        </div>
      </footer>
    </section>
  )
}
