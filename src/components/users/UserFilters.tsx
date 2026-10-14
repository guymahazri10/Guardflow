import { useState } from 'react'
import { APP_ROLES, type RoleFilter } from '../../lib/userFilters'
import { ROLE_COLORS, ROLE_DESCRIPTIONS } from './userRoles'

interface UserFiltersProps {
  query: string
  onQueryChange: (query: string) => void
  role: RoleFilter
  onRoleChange: (role: RoleFilter) => void
  counts: Record<RoleFilter, number>
  shown: number
}

const FILTERS: RoleFilter[] = ['all', ...APP_ROLES]

/** Live search, role filter chips with counts, and a collapsible "what can each role do" legend. */
export default function UserFilters({ query, onQueryChange, role, onRoleChange, counts, shown }: UserFiltersProps) {
  const [legendOpen, setLegendOpen] = useState(false)
  const filtering = query.trim() !== '' || role !== 'all'

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="חיפוש לפי שם או מייל"
          aria-label="חיפוש משתמש"
          autoComplete="off"
          enterKeyHint="search"
          className="input-field !pr-11 !pl-11 min-h-11 [&::-webkit-search-cancel-button]:hidden"
        />
        {query !== '' && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="נקה חיפוש"
            className="absolute left-0 top-0 h-full w-11 flex items-center justify-center text-text-secondary"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="סינון לפי תפקיד">
        {FILTERS.map((value) => {
          const selected = role === value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => onRoleChange(value)}
              className={`rounded-full px-4 min-h-11 text-sm font-bold transition-colors active:scale-[0.97] ${
                selected ? 'bg-primary text-white' : 'bg-primary-light text-primary-600'
              }`}
            >
              {value === 'all' ? 'הכל' : value} <span className="tabular-nums font-semibold">{counts[value]}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-3 min-h-6">
        <p className="text-xs text-text-label" aria-live="polite">
          {filtering ? `מציג ${shown} מתוך ${counts.all}` : `${counts.all} משתמשים רשומים`}
        </p>
        <button
          type="button"
          onClick={() => setLegendOpen((open) => !open)}
          aria-expanded={legendOpen}
          className="text-xs font-bold text-primary-600 min-h-11 px-1"
        >
          {legendOpen ? 'הסתר הרשאות' : 'מה כל תפקיד יכול?'}
        </button>
      </div>

      {legendOpen && (
        <div className="card p-4 flex flex-col gap-2">
          {APP_ROLES.map((appRole) => {
            const c = ROLE_COLORS[appRole]
            return (
              <div key={appRole} className="flex items-center gap-2">
                <span
                  className="text-xs font-bold rounded-badge px-2 py-0.5 shrink-0"
                  style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}
                >
                  {appRole}
                </span>
                <span className="text-xs text-text-secondary">{ROLE_DESCRIPTIONS[appRole]}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
