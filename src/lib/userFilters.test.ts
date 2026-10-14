import { describe, expect, it } from 'vitest'
import { countByRole, filterProfiles, normalizeRole } from './userFilters'
import type { ProfileListItem } from './profiles'

function profile(partial: Partial<ProfileListItem> & { id: string }): ProfileListItem {
  return {
    email: null,
    full_name: null,
    app_role: 'מאבטח',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

const people = [
  profile({ id: '1', full_name: 'דנה כהן', email: 'dana.cohen@example.com', app_role: 'מנהל' }),
  profile({ id: '2', full_name: 'יוסי לוי', email: 'Yossi@Example.com', app_role: 'אחמ"ש' }),
  profile({ id: '3', full_name: 'מיכל שמש', email: 'michal@example.com', app_role: 'מאבטח' }),
  profile({ id: '4', full_name: null, email: 'noname@example.com', app_role: null }),
]

describe('normalizeRole', () => {
  it('keeps the three known roles and treats anything else as מאבטח', () => {
    expect(normalizeRole('מנהל')).toBe('מנהל')
    expect(normalizeRole('אחמ"ש')).toBe('אחמ"ש')
    expect(normalizeRole('מאבטח')).toBe('מאבטח')
    expect(normalizeRole(null)).toBe('מאבטח')
    expect(normalizeRole('משהו אחר')).toBe('מאבטח')
  })
})

describe('filterProfiles', () => {
  it('returns everyone for an empty query and the "all" filter', () => {
    expect(filterProfiles(people, '', 'all')).toHaveLength(4)
  })

  it('matches part of a name', () => {
    expect(filterProfiles(people, 'כהן', 'all').map((p) => p.id)).toEqual(['1'])
  })

  it('matches an email regardless of letter case', () => {
    expect(filterProfiles(people, 'YOSSI@example', 'all').map((p) => p.id)).toEqual(['2'])
    expect(filterProfiles(people, 'dana.cohen', 'all').map((p) => p.id)).toEqual(['1'])
  })

  it('ignores leading and trailing spaces in the query', () => {
    expect(filterProfiles(people, '  מיכל  ', 'all').map((p) => p.id)).toEqual(['3'])
  })

  it('finds a user who has no name by email', () => {
    expect(filterProfiles(people, 'noname', 'all').map((p) => p.id)).toEqual(['4'])
  })

  it('filters by role, counting an unknown role as מאבטח', () => {
    expect(filterProfiles(people, '', 'מאבטח').map((p) => p.id)).toEqual(['3', '4'])
    expect(filterProfiles(people, '', 'מנהל').map((p) => p.id)).toEqual(['1'])
  })

  it('combines the query and the role filter', () => {
    expect(filterProfiles(people, 'example', 'אחמ"ש').map((p) => p.id)).toEqual(['2'])
    expect(filterProfiles(people, 'כהן', 'מאבטח')).toEqual([])
  })
})

describe('countByRole', () => {
  it('counts everyone and each role', () => {
    expect(countByRole(people)).toEqual({ all: 4, מנהל: 1, 'אחמ"ש': 1, מאבטח: 2 })
  })
})
