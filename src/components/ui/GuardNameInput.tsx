import { useEffect, useRef, useState } from 'react'
import type { ProfileListItem } from '../../lib/profiles'
import type { GuardAssignment } from '../../lib/rosterBoards'

interface GuardNameInputProps {
  value: GuardAssignment
  profiles: ProfileListItem[]
  onChange: (value: GuardAssignment) => void
  readOnly?: boolean
}

/** Free-text name input with an autocomplete dropdown over registered users.
 *  Typing always clears the user_id link; picking a suggestion sets both
 *  name and user_id together. */
export default function GuardNameInput({ value, profiles, onChange, readOnly }: GuardNameInputProps) {
  const [focused, setFocused] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setFocused(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const query = value.name.trim().toLowerCase()
  const suggestions = query
    ? profiles
        .filter((profile) => {
          const name = (profile.full_name ?? '').toLowerCase()
          const email = (profile.email ?? '').toLowerCase()
          return name.includes(query) || email.includes(query)
        })
        .slice(0, 5)
    : []

  function selectProfile(profile: ProfileListItem) {
    onChange({ name: profile.full_name ?? profile.email ?? '', user_id: profile.id })
    setFocused(false)
  }

  return (
    <div ref={wrapperRef} className="relative flex-1 min-w-0 h-full">
      <input
        type="text"
        value={value.name}
        onChange={(event) => onChange({ name: event.target.value, user_id: null })}
        onFocus={() => setFocused(true)}
        placeholder={readOnly ? '—' : 'הקלד שם מאבטח...'}
        readOnly={readOnly}
        className={`w-full px-4 text-sm text-text-primary bg-transparent outline-none h-full placeholder:text-text-muted ${
          readOnly ? 'cursor-default text-text-secondary' : ''
        }`}
        dir="rtl"
        autoCorrect="off"
        autoCapitalize="words"
      />

      {!readOnly && focused && suggestions.length > 0 && (
        <div className="absolute top-[calc(100%+4px)] inset-x-0 bg-white rounded-xl shadow-card-md border border-border z-20 overflow-hidden">
          {suggestions.map((profile) => {
            const name = profile.full_name ?? profile.email ?? '—'

            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => selectProfile(profile)}
                className="flex items-center gap-2.5 w-full px-3 py-2 border-b border-background last:border-b-0 text-right active:bg-background"
              >
                <span className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-[11px] font-extrabold text-white shrink-0">
                  {name[0]}
                </span>
                <span className="text-[13px] font-semibold text-text-primary truncate">{name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
