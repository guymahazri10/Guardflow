import { useEffect, useMemo, useRef, useState } from 'react'
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
import { findDefaultRosterTemplateByShiftId } from '../lib/defaultRosterTemplates'
import { SHIFT_CATEGORIES, getShiftById, getShiftHoursLabel } from '../constants/shifts'

const publishHelperText = 'כדי לפרסם צריך להוסיף לפחות תפקיד אחד ובלוק זמן אחד.'

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

/** Next half-hour slot after the last row, wrapping past midnight. */
function nextTimeSlot(rows: RosterBoardRow[]): string {
  const lastTime = rows.length > 0 ? rows[rows.length - 1].time : '00:00'
  const [h, m] = lastTime.split(':').map(Number)
  const totalMinutes = (h * 60 + m + 30) % (24 * 60)
  const nh = Math.floor(totalMinutes / 60)
  const nm = totalMinutes % 60
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full lg:max-w-none">{children}</div>
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="bg-white border-b border-border px-4 pt-5 pb-4 flex items-center justify-between">
      <h1 className="text-xl font-bold text-text-primary">עורך לו״ז</h1>
      <button onClick={onBack} className="text-sm font-medium text-primary flex items-center gap-1 active:opacity-70">
        חזור לרשימה ←
      </button>
    </div>
  )
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
  const [isEditing, setIsEditing] = useState(false)
  const [notesOpen, setNotesOpen] = useState(true)
  const [actionError, setActionError] = useState<string | null>(null)
  const cellInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const board = rosterBoardQuery.data ?? null
  const normalizedRows = useMemo(() => ensureRowsHaveAllColumns(cols, rows), [cols, rows])
  const canPublish = canPublishRosterBoard({ cols, rows: normalizedRows })
  const isSaving = updateRosterBoardMutation.isPending || publishRosterBoardMutation.isPending

  const shift = board ? getShiftById(board.shift_id) : undefined
  const template = board ? findDefaultRosterTemplateByShiftId(board.shift_id) : null
  const title = template?.label ?? (shift ? `משמרת ${SHIFT_CATEGORIES[shift.category].label}` : 'לו״ז')
  // Canonical category hours, not the template's real-world hours (which include a 30min handover buffer).
  const hours = shift ? getShiftHoursLabel(shift) : ''
  const subtitle = template ? `${template.subLabel} · ${hours}` : ''
  const typeLabel = shift ? `${SHIFT_CATEGORIES[shift.category].label} – ${template?.subLabel ?? ''}` : ''

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
    setIsEditing(false)
  }, [board, loadedBoardId])

  function handleAddColumn() {
    const name = `עמדה ${cols.length + 1}`
    const result = addColumn(cols, normalizedRows, name)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleRemoveColumn(columnName: string) {
    const result = removeColumn(cols, normalizedRows, columnName)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleColumnRenameBlur(oldName: string, value: string, input: HTMLInputElement) {
    const trimmedValue = value.trim()

    if (!trimmedValue || (trimmedValue !== oldName && cols.includes(trimmedValue))) {
      input.value = oldName
      return
    }

    const result = renameColumn(cols, normalizedRows, oldName, trimmedValue)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleAddTimeRow() {
    setRows(ensureRowsHaveAllColumns(cols, addTimeRow(normalizedRows, nextTimeSlot(normalizedRows))))
  }

  function handleRemoveTimeRow(time: string) {
    setRows(removeTimeRow(normalizedRows, time))
  }

  function handleUpdateCell(rowTime: string, columnName: string, value: string) {
    setRows(updateCell(normalizedRows, rowTime, columnName, value))
  }

  function handleCellKeyDown(event: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number) {
    if (event.key === 'Tab') {
      event.preventDefault()
      const nextCi = ci + 1 < cols.length ? ci + 1 : 0
      const nextRi = ci + 1 < cols.length ? ri : ri + 1
      cellInputRefs.current[`${nextRi}-${nextCi}`]?.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      cellInputRefs.current[`${ri + 1}-${ci}`]?.focus()
    }
  }

  async function handleSaveDraft() {
    if (!boardId) return

    setActionError(null)

    try {
      const rowsToSave = ensureRowsHaveAllColumns(cols, normalizedRows)
      const updatedBoard = await updateRosterBoardMutation.mutateAsync({
        id: boardId,
        input: { cols, rows: rowsToSave, notes: notes.trim() ? notes : null, published },
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
    if (!boardId) return

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
          input: { cols, rows: rowsToSave, notes: notes.trim() ? notes : null, published: false },
        })
      }

      const updatedBoard = await publishRosterBoardMutation.mutateAsync({ id: boardId, published: !published })

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
      <PageShell>
        <TopBar onBack={() => navigate('/admin')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">חסר מזהה לו״ז לעריכה.</div>
        </div>
      </PageShell>
    )
  }

  if (rosterBoardQuery.isLoading) {
    return (
      <PageShell>
        <TopBar onBack={() => navigate('/admin')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">טוען לו״ז...</div>
        </div>
      </PageShell>
    )
  }

  if (rosterBoardQuery.isError || !board) {
    return (
      <PageShell>
        <TopBar onBack={() => navigate('/admin')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">
            {rosterBoardQuery.isError ? 'טעינת הלו״ז נכשלה.' : 'הלו״ז לא נמצא.'}
          </div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <TopBar onBack={() => navigate('/admin')} />

      <div className="px-4 pt-4">
        {/* ── Hero card ── */}
        <div className="rounded-card bg-primary text-white p-4">
          <div className="flex items-start justify-between gap-3">
            <span
              className={`text-[11px] font-bold rounded-badge px-2 py-0.5 shrink-0 ${
                published ? 'bg-good-light text-good' : 'bg-warning-light text-warning'
              }`}
            >
              {published ? 'פורסם' : 'טיוטה'}
            </span>
            <div className="flex-1 text-right min-w-0">
              <div className="flex items-center gap-2 justify-end">
                <p className="text-base font-bold truncate">{title}</p>
              </div>
              {subtitle && <p className="text-sm text-white/70 mt-1">{subtitle}</p>}
            </div>
          </div>

          <div className="mt-3 inline-flex items-center gap-1.5 bg-white/10 rounded-badge px-3 py-1.5 text-xs font-semibold">
            <span className="text-white/70 font-normal">סוג משמרת:</span> {typeLabel}
          </div>
        </div>

        {/* ── Status sentence ── */}
        <p className="text-xs text-text-secondary leading-relaxed mt-3">
          {published
            ? 'הלוח פורסם ומוצג למאבטחים. תוכל לערוך ולפרסם מחדש בכל עת.'
            : 'הלוח בטיוטה — עדיין לא מוצג למאבטחים.'}
        </p>

        {actionError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
        )}

        {/* ── Primary CTA / save-publish bar ── */}
        {!isEditing ? (
          <button onClick={() => setIsEditing(true)} className="btn-primary w-full h-14 mt-3 rounded-[14px] text-[15px]">
            ערוך שיבוצים
          </button>
        ) : (
          <div className="flex flex-col gap-2 mt-3">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  void handleSaveDraft()
                }}
                disabled={isSaving}
                className="btn-primary flex-1 h-12 rounded-xl disabled:opacity-50"
              >
                {isSaving ? 'שומר...' : 'שמור טיוטה'}
              </button>
              <button
                onClick={() => {
                  void handleTogglePublished()
                }}
                disabled={isSaving || (!published && !canPublish)}
                title={!published && !canPublish ? publishHelperText : undefined}
                className="flex-1 h-12 rounded-xl text-sm font-semibold text-primary bg-primary-light border border-primary/20 disabled:opacity-40"
              >
                {published ? 'החזר לטיוטה' : 'פרסם'}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="h-12 px-4 rounded-xl border border-border text-text-secondary text-sm font-medium"
              >
                סיום
              </button>
            </div>
            {!canPublish && <p className="text-xs text-text-muted">{publishHelperText}</p>}
          </div>
        )}
      </div>

      {/* ── Notes ── */}
      {isEditing ? (
        <div className="px-4 mt-4">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="הערות למשמרת (אופציונלי)..."
            rows={2}
            className="input-field w-full resize-none"
          />
        </div>
      ) : notes ? (
        <div className="px-4 mt-4">
          <div className="card px-3.5 py-1">
            <button
              onClick={() => setNotesOpen((prev) => !prev)}
              className="w-full flex items-center justify-between gap-3 py-3 text-right"
            >
              <span className="text-sm font-bold text-text-primary">הערות למשמרת</span>
              <span className="w-[26px] h-[26px] rounded-full bg-primary text-white flex items-center justify-center text-sm shrink-0">
                {notesOpen ? '−' : '+'}
              </span>
            </button>
            {notesOpen && <p className="text-sm text-text-secondary pb-3.5 leading-relaxed">{notes}</p>}
          </div>
        </div>
      ) : null}

      {/* ── Spreadsheet ── */}
      <div className="px-4 mt-4 pb-6">
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '60vh' }} dir="rtl">
            <table className="border-collapse text-xs" style={{ minWidth: '100%' }}>
              <thead>
                <tr className="bg-primary text-white sticky top-0 z-[3]">
                  <th className="w-9 px-1.5 py-2 border-l border-white/10 text-[10px] text-white/50 font-normal sticky right-0 bg-primary z-[4]">
                    #
                  </th>
                  <th className="min-w-[64px] px-2.5 py-2 border-l border-white/10 font-bold text-[11px] text-white/90 sticky right-9 bg-primary z-[4]">
                    שעה
                  </th>
                  {cols.map((col) => (
                    <th key={col} className="min-w-[140px] p-0 border-l border-white/10">
                      {isEditing ? (
                        <div className="flex items-center">
                          <input
                            defaultValue={col}
                            onBlur={(event) => handleColumnRenameBlur(col, event.currentTarget.value, event.currentTarget)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur()
                            }}
                            className="flex-1 min-w-0 bg-transparent border-none outline-none text-white font-bold text-[11px] px-1.5 py-2 text-center"
                          />
                          <button
                            onClick={() => handleRemoveColumn(col)}
                            className="text-white/50 active:text-danger px-1.5 shrink-0"
                            aria-label={`מחק תפקיד ${col}`}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="px-2.5 py-2 text-[11px] font-bold text-center">{col}</div>
                      )}
                    </th>
                  ))}
                  {isEditing && (
                    <th className="w-10 p-1.5">
                      <button
                        onClick={handleAddColumn}
                        className="border border-dashed border-white/20 text-white/70 rounded px-2 py-0.5 text-sm leading-none"
                        aria-label="הוסף תפקיד"
                      >
                        +
                      </button>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {normalizedRows.map((row, ri) => {
                  const stripeBg = ri % 2 === 0 ? 'bg-white' : 'bg-background'

                  return (
                    <tr key={row.time} className={stripeBg}>
                      <td className={`text-center text-[10px] text-text-muted border-l border-b border-border sticky right-0 z-[2] ${stripeBg}`}>
                        {ri + 1}
                      </td>
                      <td className="border-l-2 border-primary/30 border-b border-border sticky right-9 z-[2] bg-primary-light">
                        <div className="text-center font-extrabold text-primary py-1.5 tabular-nums">{row.time}</div>
                      </td>
                      {cols.map((col, ci) => (
                        <td key={col} className="border-l border-b border-border p-0">
                          {isEditing ? (
                            <input
                              ref={(element) => {
                                cellInputRefs.current[`${ri}-${ci}`] = element
                              }}
                              value={row.cells[col] ?? ''}
                              onChange={(event) => handleUpdateCell(row.time, col, event.target.value)}
                              onKeyDown={(event) => handleCellKeyDown(event, ri, ci)}
                              placeholder="—"
                              className="w-full min-w-[140px] px-2 py-1.5 border-none outline-none bg-transparent text-xs focus:bg-yellow-50"
                            />
                          ) : (
                            <div className="px-2 py-1.5 text-xs min-h-[28px]">{row.cells[col] || ''}</div>
                          )}
                        </td>
                      ))}
                      {isEditing && (
                        <td className="text-center p-1 border-b border-border">
                          <button
                            onClick={() => handleRemoveTimeRow(row.time)}
                            className="text-text-muted active:text-danger px-1"
                            aria-label={`מחק שורת ${row.time}`}
                          >
                            🗑
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {isEditing && (
                  <tr>
                    <td colSpan={cols.length + 3} className="p-2">
                      <button
                        onClick={handleAddTimeRow}
                        className="flex items-center gap-1 text-xs text-text-secondary border border-dashed border-border rounded px-3 py-1.5"
                      >
                        + הוסף שורה
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        {normalizedRows.length === 0 && (
          <p className="text-center text-sm text-text-muted mt-3">אין עדיין בלוקי זמן. לחץ "ערוך שיבוצים" כדי להתחיל.</p>
        )}
      </div>
    </PageShell>
  )
}
