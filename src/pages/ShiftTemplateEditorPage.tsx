import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useShiftTemplate, useUpdateShiftTemplate } from '../hooks/useShiftTemplates'
import type { RosterBoardRow } from '../lib/rosterBoards'
import {
  addColumn,
  addTimeRow,
  ensureRowsHaveAllColumns,
  removeColumn,
  removeTimeRow,
  renameColumn,
  updateCell,
} from '../lib/rosterEditorUtils'
import { getShiftById, getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel } from '../constants/shifts'

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

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="bg-white border-b border-border px-4 pt-5 pb-4 flex items-center justify-between">
      <h1 className="text-xl font-bold text-text-primary">עריכת תבנית</h1>
      <button onClick={onBack} className="text-sm font-medium text-primary flex items-center gap-1 active:opacity-70">
        חזור לרשימה ←
      </button>
    </div>
  )
}

export function ShiftTemplateEditorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const shiftId = searchParams.get('shiftId')
  const shift = shiftId ? getShiftById(shiftId) : undefined

  const templateQuery = useShiftTemplate(shiftId)
  const updateMutation = useUpdateShiftTemplate()

  const [loadedShiftId, setLoadedShiftId] = useState<string | null>(null)
  const [cols, setCols] = useState<string[]>([])
  const [rows, setRows] = useState<RosterBoardRow[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const cellInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const template = templateQuery.data ?? null
  const isSaving = updateMutation.isPending

  // Re-initializes only when the loaded shift actually changes, not on every
  // background refetch — same reasoning as RosterEditorPage's board sync.
  useEffect(() => {
    if (!template || loadedShiftId === template.shift_id) return
    setCols(template.cols)
    setRows(template.rows)
    setLoadedShiftId(template.shift_id)
    setActionError(null)
  }, [template, loadedShiftId])

  function handleAddColumn() {
    const name = `עמדה ${cols.length + 1}`
    const result = addColumn(cols, rows, name)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleRemoveColumn(columnName: string) {
    const result = removeColumn(cols, rows, columnName)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleColumnRenameBlur(oldName: string, value: string, input: HTMLInputElement) {
    const trimmedValue = value.trim()

    if (!trimmedValue || (trimmedValue !== oldName && cols.includes(trimmedValue))) {
      input.value = oldName
      return
    }

    const result = renameColumn(cols, rows, oldName, trimmedValue)
    setCols(result.cols)
    setRows(result.rows)
  }

  function handleAddTimeRow() {
    setRows(addTimeRow(rows, nextTimeSlot(rows)))
  }

  function handleRemoveTimeRow(time: string) {
    setRows(removeTimeRow(rows, time))
  }

  function handleUpdateCell(rowTime: string, columnName: string, value: string) {
    setRows(updateCell(rows, rowTime, columnName, value))
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

  async function handleSave() {
    if (!shiftId) return

    if (cols.length === 0 || rows.length === 0) {
      setActionError('לא ניתן לשמור תבנית ריקה — נדרש לפחות תפקיד אחד ושורה אחת.')
      return
    }

    setActionError(null)

    try {
      const normalizedRows = ensureRowsHaveAllColumns(cols, rows)
      await updateMutation.mutateAsync({ shiftId, input: { cols, rows: normalizedRows, notes: template?.notes ?? null } })
      toast.success('נשמר בהצלחה!')
      navigate('/shift-templates')
    } catch (error) {
      setActionError(getReadableError(error))
    }
  }

  if (!shiftId || !shift) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">חסר מזהה משמרת לעריכה.</div>
        </div>
      </div>
    )
  }

  if (templateQuery.isLoading) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">טוען תבנית...</div>
        </div>
      </div>
    )
  }

  if (templateQuery.isError || !template) {
    return (
      <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
        <TopBar onBack={() => navigate('/shift-templates')} />
        <div className="p-4">
          <div className="card p-6 text-center text-sm text-text-secondary">
            {templateQuery.isError ? 'טעינת התבנית נכשלה.' : 'התבנית לא נמצאה.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
      <TopBar onBack={() => navigate('/shift-templates')} />

      <div className="px-4 pt-4">
        <div className="rounded-card bg-primary text-white p-4">
          <p className="text-base font-bold">{getShiftFullTitle(shift)}</p>
          <p className="text-sm text-white/70 mt-1">
            {getShiftShortLabel(shift)} · {getShiftHoursLabel(shift)}
          </p>
        </div>

        {actionError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
        )}

        <button
          onClick={() => {
            void handleSave()
          }}
          disabled={isSaving}
          className="btn-primary w-full h-14 mt-3 rounded-[14px] text-[15px] disabled:opacity-50"
        >
          {isSaving ? 'שומר...' : 'שמור'}
        </button>
      </div>

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
                    </th>
                  ))}
                  <th className="w-10 p-1.5">
                    <button
                      onClick={handleAddColumn}
                      className="border border-dashed border-white/20 text-white/70 rounded px-2 py-0.5 text-sm leading-none"
                      aria-label="הוסף תפקיד"
                    >
                      +
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
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
                        </td>
                      ))}
                      <td className="text-center p-1 border-b border-border">
                        <button
                          onClick={() => handleRemoveTimeRow(row.time)}
                          className="text-text-muted active:text-danger px-1"
                          aria-label={`מחק שורת ${row.time}`}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  )
                })}
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
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
