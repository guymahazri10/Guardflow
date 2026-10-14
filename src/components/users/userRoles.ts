import type { AppRole } from '../../contexts/AuthContext'
import type { ProfileListItem } from '../../lib/profiles'

export const ROLE_COLORS: Record<AppRole, { bg: string; color: string; border: string }> = {
  מנהל: { bg: '#D4A24A', color: '#0C084A', border: 'transparent' },
  'אחמ"ש': { bg: '#E8EFFF', color: '#0F4FD1', border: 'transparent' },
  מאבטח: { bg: '#EAEFFC', color: '#5A6072', border: 'transparent' },
}

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  מנהל: 'גישה מלאה — ניהול לו״זים, משתמשים, עריכה',
  'אחמ"ש': 'מילוי שמות + צפייה בלו״ז — ללא ניהול',
  מאבטח: 'צפייה בלו״ז בלבד (ברירת מחדל לכל משתמש)',
}

export function displayNameOf(profile: ProfileListItem): string {
  return profile.full_name ?? profile.email ?? '—'
}
