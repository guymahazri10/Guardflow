import { Fragment } from 'react'
import { formatIsraelShortDateLabel } from '../lib/israelTime'
import { SHIFT_CATEGORIES } from '../constants/shifts'
import type { GridItem, PreviewGrid } from '../lib/scheduleImport/previewGrid'

/**
 * The weekly review table shown after an upload: days across, shift and post
 * down, and in every cell only the name exactly as read from the file and its
 * original hours. Names are never required to be registered users, so nothing
 * here mentions accounts.
 *
 * RTL table (the sticky label column sits at the right edge, so `right-0`),
 * hours isolated left-to-right, sticky headers, horizontal scroll on narrow
 * screens, and a real table structure for keyboards and screen readers.
 */
export function WeeklyPreviewGrid({ grid }: { grid: PreviewGrid }) {
  function renderItem(item: GridItem) {
    return (
      <li key={item.assignmentIndex} className="flex flex-col items-center gap-0.5 leading-tight">
        <span className="font-medium text-text-primary">{item.name}</span>
        <bdi dir="ltr" className="text-[11px] text-text-muted tabular-nums">
          {item.hours}
        </bdi>
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
