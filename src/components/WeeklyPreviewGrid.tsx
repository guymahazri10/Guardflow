import { Fragment, useState } from 'react'
import { formatIsraelShortDateLabel } from '../lib/israelTime'
import { SHIFT_CATEGORIES } from '../constants/shifts'
import type { GridItem, PreviewGrid } from '../lib/scheduleImport/previewGrid'
import { normalizeForMatch } from '../lib/scheduleImport/matchNames'

type Profile = { id: string; full_name: string | null }

/**
 * The weekly review table shown first after an upload: days across, shift and
 * post down, and in every cell the name exactly as read from the file with its
 * original hours. A name with no linked account stays fully visible with a
 * small tag; linking is an optional action next to it, never a replacement of
 * the name and never a condition for the assignment to be there.
 *
 * RTL table (the sticky label column sits at the right edge, so `right-0`),
 * hours isolated left-to-right, sticky headers, horizontal scroll on narrow
 * screens, and a real table structure for keyboards and screen readers.
 */
export function WeeklyPreviewGrid({
  grid,
  profiles,
  nameCounts,
  onLink,
  onConfirmSuggestion,
}: {
  grid: PreviewGrid
  profiles: Profile[]
  /** how many assignments carry each name, to offer "link every shift of this name" */
  nameCounts: Map<string, number>
  onLink: (assignmentIndex: number, userId: string, applyToSameName: boolean) => void
  onConfirmSuggestion: (assignmentIndex: number) => void
}) {
  const [linking, setLinking] = useState<number | null>(null)
  const [applyToAll, setApplyToAll] = useState(true)

  const profileName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name ?? null

  // A plain render function, not a nested component: a nested component gets a
  // new identity on every render and would remount (and lose focus) whenever
  // the link picker opens.
  function renderItem(item: GridItem) {
    const sameName = nameCounts.get(normalizeForMatch(item.name)) ?? 1
    return (
      <li key={item.assignmentIndex} className="flex flex-col items-center gap-0.5 leading-tight">
        <span className="font-medium text-text-primary">{item.name}</span>
        <bdi dir="ltr" className="text-[11px] text-text-muted tabular-nums">
          {item.hours}
        </bdi>
        {item.linkState === 'unlinked' && (
          <span className="text-[10px] font-bold text-text-secondary bg-background-2 rounded-badge px-1.5 py-0.5">
            לא מקושר למשתמש
          </span>
        )}
        {item.linkState === 'suggested' && (
          <span className="flex flex-wrap items-center justify-center gap-1 text-[10px]">
            <span className="font-bold text-text-secondary bg-background-2 rounded-badge px-1.5 py-0.5">
              לא מקושר למשתמש
            </span>
            <span className="text-warning">הצעה: {profileName(item.suggestedUserId) ?? '—'}</span>
            <button
              type="button"
              className="font-bold text-primary underline"
              onClick={() => onConfirmSuggestion(item.assignmentIndex)}
              aria-label={`אשר את ההצעה לשם ${item.name}`}
            >
              אשר הצעה
            </button>
          </span>
        )}
        {item.linkState !== 'linked' && linking !== item.assignmentIndex && (
          <button
            type="button"
            className="text-[10px] font-bold text-primary underline"
            onClick={() => setLinking(item.assignmentIndex)}
            aria-label={`קשר את ${item.name} למשתמש`}
          >
            קשר למשתמש
          </button>
        )}
        {item.linkState === 'linked' && (
          <span className="text-[10px] font-bold text-good">מקושר למשתמש</span>
        )}
        {linking === item.assignmentIndex && (
          <span className="flex flex-col items-center gap-1 mt-0.5">
            <select
              autoFocus
              aria-label={`בחר משתמש לקישור עבור ${item.name}`}
              className="bg-white border border-border rounded-lg px-1.5 py-1 text-[11px] max-w-[140px]"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return
                onLink(item.assignmentIndex, e.target.value, applyToAll)
                setLinking(null)
              }}
            >
              <option value="" disabled>
                בחר משתמש
              </option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
            {sameName > 1 && (
              <label className="flex items-center gap-1 text-[10px] text-text-secondary">
                <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
                כל {sameName} השיבוצים בשם זה
              </label>
            )}
            <button type="button" className="text-[10px] text-text-muted underline" onClick={() => setLinking(null)}>
              ביטול
            </button>
          </span>
        )}
      </li>
    )
  }

  const groupOf = (r: (typeof grid.rows)[number]) =>
    r.kind === 'אחמ"ש' ? 'אחמ"ש' : `מאבטח · ${SHIFT_CATEGORIES[r.category].label}`
  return (
    <div className="card overflow-hidden">
      <div
        role="region"
        aria-label="טבלת שיבוץ שבועית"
        tabIndex={0}
        className="overflow-auto max-h-[78vh] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
      >
        <table className="w-full min-w-[980px] text-sm border-separate border-spacing-0" dir="rtl">
          <caption className="sr-only">
            שיבוצים שנקראו מהקובץ, לפי משמרת ועמדה בשורות וימי השבוע בעמודות. בכל תא השם כפי שמופיע בקובץ והשעות המקוריות.
          </caption>
          <thead>
            <tr className="text-text-secondary text-xs">
              <th
                scope="col"
                className="sticky top-0 right-0 z-30 bg-white px-3 py-2.5 font-bold text-right border-b border-l border-border"
              >
                משמרת / עמדה
              </th>
              {grid.days.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className="sticky top-0 z-20 bg-white px-3 py-2.5 font-bold text-center whitespace-nowrap border-b border-border"
                >
                  {formatIsraelShortDateLabel(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, rowIndex) => {
              const group = groupOf(row)
              const header =
                rowIndex === 0 || group !== groupOf(grid.rows[rowIndex - 1]) ? (
                  <tr key={`g-${group}`}>
                    <th
                      scope="rowgroup"
                      colSpan={grid.days.length + 1}
                      className="bg-background-2 px-3 py-1.5 font-bold text-text-secondary text-xs text-right border-b border-border"
                    >
                      {group}
                    </th>
                  </tr>
                ) : null
              const label = row.kind === 'אחמ"ש' ? SHIFT_CATEGORIES[row.category].label : row.position
              return (
                <Fragment key={row.id}>
                  {header}
                  <tr className="align-top">
                    <th
                      scope="row"
                      className="sticky right-0 z-10 bg-white px-3 py-2 font-medium text-right whitespace-nowrap border-b border-l border-border"
                    >
                      {label}
                    </th>
                    {row.cells.map((cell, i) => (
                      <td key={grid.days[i]} className="px-2 py-2 text-center border-b border-border min-w-[120px]">
                        {cell.length === 0 ? (
                          <span className="text-text-muted" aria-label="אין שיבוץ">
                            —
                          </span>
                        ) : (
                          <ul className="flex flex-col gap-2">
                            {cell.map((item) => renderItem(item))}
                          </ul>
                        )}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
