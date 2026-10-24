import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  SHIFT_CATEGORIES,
  getShiftHoursLabel,
  getShiftOptionLabel,
  type ShiftCategory,
  type ShiftConfig,
} from '../constants/shifts'
import { nextMenuIndex } from '../lib/menuNavigation'

const CATEGORY_ORDER = Object.keys(SHIFT_CATEGORIES) as ShiftCategory[]
const MENU_MAX_WIDTH = 288

/**
 * Shift selection for the setup screen: the three category buttons (בוקר / צהריים / לילה); a
 * button opens a small menu under it with that category's available shifts (the variants that
 * exist in shift_types, with their hours). Picking one closes the menu and shows a short summary;
 * the category buttons (or "שנה") reopen it. Click outside or Escape closes it without a change.
 * Selection itself (which board is loaded, saved, put on air) stays with the page.
 */
export function ShiftPicker({
  shifts,
  category,
  selectedShiftId,
  liveShiftIds,
  loading,
  onSelect,
}: {
  shifts: ShiftConfig[]
  /** category of the current selection */
  category: ShiftCategory
  selectedShiftId: string | null
  /** shift currently on air, per category (if any) */
  liveShiftIds: Partial<Record<ShiftCategory, string | null>>
  loading: boolean
  onSelect: (shift: ShiftConfig) => void
}) {
  const [openCategory, setOpenCategory] = useState<ShiftCategory | null>(null)
  const [menuLeft, setMenuLeft] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Partial<Record<ShiftCategory, HTMLButtonElement | null>>>({})
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  const options = openCategory ? shifts.filter((s) => s.category === openCategory) : []
  const selected = shifts.find((s) => s.id === selectedShiftId) ?? null

  function close(returnFocus: boolean) {
    const was = openCategory
    setOpenCategory(null)
    if (returnFocus && was) triggerRefs.current[was]?.focus()
  }

  // centre the menu under the button that opened it, kept inside the container
  useLayoutEffect(() => {
    if (!openCategory || !wrapperRef.current) return
    const trigger = triggerRefs.current[openCategory]
    if (!trigger) return
    const wrapperWidth = wrapperRef.current.clientWidth
    const width = Math.min(MENU_MAX_WIDTH, wrapperWidth)
    const centre = trigger.offsetLeft + trigger.offsetWidth / 2
    setMenuLeft(Math.max(0, Math.min(centre - width / 2, wrapperWidth - width)))
  }, [openCategory])

  // keyboard: move focus into the menu on the selected option (or the first)
  useEffect(() => {
    if (!openCategory) return
    const idx = Math.max(0, options.findIndex((o) => o.id === selectedShiftId))
    optionRefs.current[idx]?.focus()
  }, [openCategory]) // eslint-disable-line react-hooks/exhaustive-deps

  // click / touch outside closes without a change
  useEffect(() => {
    if (!openCategory) return
    function onOutside(e: Event) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpenCategory(null)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('touchstart', onOutside)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('touchstart', onOutside)
    }
  }, [openCategory])

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key === 'Tab') {
      setOpenCategory(null)
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      const current = optionRefs.current.findIndex((el) => el === document.activeElement)
      const next = nextMenuIndex(current, e.key, options.length)
      optionRefs.current[next]?.focus()
    }
  }

  function toggle(cat: ShiftCategory) {
    setOpenCategory((cur) => (cur === cat ? null : cat))
  }

  return (
    <div ref={wrapperRef} className="relative px-4 mt-4">
      <div role="group" aria-label="סוג משמרת" className="flex gap-2">
        {CATEGORY_ORDER.map((cat) => {
          const isCurrent = category === cat
          const isOpen = openCategory === cat
          return (
            <button
              key={cat}
              type="button"
              ref={(el) => {
                triggerRefs.current[cat] = el
              }}
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              aria-controls={isOpen ? 'shift-menu' : undefined}
              aria-label={`${SHIFT_CATEGORIES[cat].label}${isCurrent ? ' (נבחרה)' : ''}`}
              onClick={() => toggle(cat)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && isOpen) close(true)
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setOpenCategory(cat)
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-5 min-h-11 text-sm font-bold transition-colors ${
                isCurrent ? 'bg-primary text-white' : 'bg-primary-light text-primary-600'
              } ${isOpen ? 'ring-2 ring-primary/40' : ''}`}
            >
              {SHIFT_CATEGORIES[cat].label}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )
        })}
      </div>

      {openCategory && (
        <div
          id="shift-menu"
          role="listbox"
          aria-label={`משמרות ${SHIFT_CATEGORIES[openCategory].label}`}
          onKeyDown={onMenuKeyDown}
          style={{ left: menuLeft, width: `min(${MENU_MAX_WIDTH}px, calc(100% - 2rem))` }}
          className="absolute top-full z-30 mt-2 flex flex-col gap-1 rounded-2xl border border-black/[0.06] bg-white p-1.5 shadow-card-md"
        >
          {options.length === 0 ? (
            <p className="px-3 py-3 text-sm text-text-secondary">אין משמרות זמינות בקטגוריה הזו.</p>
          ) : (
            options.map((shift, i) => {
              const isSelected = shift.id === selectedShiftId
              const isLive = liveShiftIds[shift.category] === shift.id
              return (
                <button
                  key={shift.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  ref={(el) => {
                    optionRefs.current[i] = el
                  }}
                  onClick={() => {
                    onSelect(shift)
                    setOpenCategory(null)
                    triggerRefs.current[shift.category]?.focus()
                  }}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-right transition-colors hover:bg-primary-light focus-visible:bg-primary-light ${
                    isSelected ? 'bg-primary-light text-primary-600' : 'text-text-primary'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      isSelected ? 'border-primary bg-primary' : 'border-primary-200 bg-white'
                    }`}
                  >
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[15px] font-bold leading-snug">{getShiftOptionLabel(shift)}</span>
                    <span dir="ltr" className="block text-right text-xs tabular-nums text-text-secondary">
                      {getShiftHoursLabel(shift)}
                    </span>
                  </span>
                  {isLive && <span className="shrink-0 text-xs font-bold text-primary-600">● בשידור</span>}
                  {isSelected && <span className="sr-only">נבחרה</span>}
                </button>
              )
            })
          )}
        </div>
      )}

      {/* the chosen shift, at a glance */}
      <div className="mt-3">
        {loading ? (
          <div className="card h-16 animate-pulse" aria-hidden="true" />
        ) : selected ? (
          <div className="card flex items-center justify-between gap-3 px-4 py-3" aria-live="polite">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-text-muted">המשמרת שנבחרה</p>
              <p className="text-[15px] font-extrabold leading-snug">
                {SHIFT_CATEGORIES[selected.category].label} · {getShiftOptionLabel(selected)}
              </p>
              <p className="text-xs tabular-nums text-text-secondary">
                <span dir="ltr">{getShiftHoursLabel(selected)}</span>
                {liveShiftIds[selected.category] === selected.id && <span className="ms-2 font-bold text-primary-600">● בשידור</span>}
              </p>
            </div>
            <button type="button" className="btn-ghost shrink-0 px-4 py-2 text-sm" onClick={() => setOpenCategory(selected.category)}>
              שנה
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
