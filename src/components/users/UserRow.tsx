import { useState, type KeyboardEvent } from 'react'
import type { AppRole } from '../../contexts/AuthContext'
import type { ProfileListItem } from '../../lib/profiles'
import { APP_ROLES, normalizeRole } from '../../lib/userFilters'
import { ROLE_COLORS, ROLE_DESCRIPTIONS, displayNameOf } from './userRoles'

interface UserRowProps {
  profile: ProfileListItem
  isSelf: boolean
  pending: boolean
  onChangeRole: (role: AppRole) => void
  onSaveName: (name: string) => void
  onDelete: () => void
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

const iconButton =
  'w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-text-secondary transition-colors active:scale-[0.95] hover:bg-background-2 disabled:opacity-50'

/**
 * One user. Role and name are edited in place: the role pill opens a three-way picker inside
 * the card, and the pencil turns the name into a field (Enter saves, Esc cancels). Deleting
 * stays a confirmation in a sheet because it can't be undone.
 */
export default function UserRow({ profile, isSelf, pending, onChangeRole, onSaveName, onDelete }: UserRowProps) {
  const role = normalizeRole(profile.app_role)
  const c = ROLE_COLORS[role]
  const name = displayNameOf(profile)

  const [roleOpen, setRoleOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEditing() {
    setDraft(profile.full_name ?? '')
    setRoleOpen(false)
    setEditing(true)
  }

  function commitName() {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== profile.full_name) onSaveName(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitName()
    } else if (event.key === 'Escape') {
      setEditing(false)
    }
  }

  return (
    <div className="card px-3.5 py-3 min-h-[72px]">
      <div className="flex items-center gap-2.5">
        <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shrink-0" aria-hidden="true">
          <span className="text-white font-extrabold text-base">{name[0]?.toUpperCase() ?? '?'}</span>
        </div>

        {editing ? (
          <>
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              aria-label={`שם התצוגה של ${name}`}
              placeholder="שם מלא..."
              autoFocus
              dir="rtl"
              className="input-field flex-1 min-w-0 min-h-11 !py-2"
            />
            <button type="button" onClick={commitName} disabled={!draft.trim()} aria-label="שמור שם" className={`${iconButton} !text-primary`}>
              <svg {...iconProps}>
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </button>
            <button type="button" onClick={() => setEditing(false)} aria-label="בטל עריכה" className={iconButton}>
              <svg {...iconProps}>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-text-primary truncate">{name}</p>
              <p className="text-xs text-text-label truncate" dir="ltr">
                {profile.email ?? '—'}
              </p>
            </div>

            <button type="button" onClick={startEditing} disabled={pending} aria-label={`ערוך שם: ${name}`} className={iconButton}>
              <svg {...iconProps}>
                <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
                <path d="m13.5 6.5 4 4" />
              </svg>
            </button>

            {isSelf ? (
              <span
                className="text-xs font-bold rounded-badge px-3 py-2 shrink-0"
                style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}
                title="לא ניתן לשנות תפקיד לעצמך"
              >
                {role} (אתה)
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setRoleOpen((open) => !open)}
                disabled={pending}
                aria-expanded={roleOpen}
                aria-label={`תפקיד: ${role}. שנה תפקיד`}
                className="flex items-center gap-1 text-xs font-bold rounded-badge px-3 min-h-11 shrink-0 transition-transform active:scale-[0.97] disabled:opacity-50"
                style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}
              >
                {role}
                <svg {...iconProps} width={14} height={14} className={`transition-transform ${roleOpen ? 'rotate-180' : ''}`}>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            )}

            {!isSelf && (
              <button type="button" onClick={onDelete} disabled={pending} aria-label={`מחק משתמש: ${name}`} className={`${iconButton} !text-danger hover:!bg-danger-light`}>
                <svg {...iconProps}>
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

      {roleOpen && !isSelf && !editing && (
        <div className="mt-3 pt-3 border-t border-border">
          <div role="radiogroup" aria-label="בחירת תפקיד" className="flex gap-2">
            {APP_ROLES.map((option) => {
              const selected = option === role
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setRoleOpen(false)
                    if (!selected) onChangeRole(option)
                  }}
                  className={`flex-1 rounded-full min-h-11 text-sm font-bold transition-colors active:scale-[0.97] ${
                    selected ? 'bg-primary text-white' : 'bg-primary-light text-primary-600'
                  }`}
                >
                  {option}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-text-label mt-2">{ROLE_DESCRIPTIONS[role]}</p>
        </div>
      )}
    </div>
  )
}
